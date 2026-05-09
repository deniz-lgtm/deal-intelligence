import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { checklistAttachmentQueries, checklistQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Verdict {
  verdict: "satisfied" | "partial" | "not_satisfied" | "unrelated";
  summary: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You verify whether an uploaded document satisfies a checklist item.
Return JSON only, no fences. Be concise (1–2 sentences for summary) and conservative —
only return "satisfied" when the document clearly addresses the item.

Schema:
{
  "verdict": "satisfied" | "partial" | "not_satisfied" | "unrelated",
  "summary": "<1-2 sentence rationale>",
  "confidence": <0..1>
}`;

export async function POST(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const item = await checklistQueries.getById(params.itemId) as {
    deal_id: string; item: string; category: string; status: string;
  } | null;
  if (!item) return NextResponse.json({ error: "checklist item not found" }, { status: 404 });
  const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
  if (accessError) return accessError;

  const body = await req.json().catch(() => ({}));
  const attachmentId = (body.attachment_id as string) || null;
  if (!attachmentId) {
    return NextResponse.json({ error: "attachment_id is required" }, { status: 400 });
  }

  // Fetch attachment + linked document text.
  const pool = getPool();
  const docRes = await pool.query(
    `SELECT a.id AS attachment_id, d.id AS document_id, d.original_name, d.content_text
     FROM deal_checklist_attachments a
     JOIN documents d ON d.id = a.document_id
     WHERE a.id = $1`,
    [attachmentId]
  );
  const docRow = docRes.rows[0];
  if (!docRow) {
    return NextResponse.json({ error: "attachment not found" }, { status: 404 });
  }

  const text = (docRow.content_text as string | null) || "";
  if (!text || text.length < 30) {
    // Nothing to verify — treat as inconclusive.
    await checklistAttachmentQueries.setVerification(
      attachmentId,
      "unrelated",
      "Document has no extractable text — manual review required.",
      0.1,
    );
    return NextResponse.json({
      data: { verdict: "unrelated", summary: "Document has no extractable text — manual review required.", confidence: 0.1 },
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userPrompt = `Checklist category: ${item.category}
Checklist item: ${item.item}

Document filename: ${docRow.original_name}
Document text (truncated):
${text.slice(0, 10000)}`;

  let verdict: Verdict = { verdict: "unrelated", summary: "Verification failed.", confidence: 0 };
  try {
    const response = await client.messages.create({
      model: await getActiveModel(),
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const out = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = out.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as Verdict;
    if (["satisfied", "partial", "not_satisfied", "unrelated"].includes(parsed.verdict)) {
      verdict = parsed;
    }
  } catch (err) {
    console.warn("checklist verify failed:", err);
  }

  await checklistAttachmentQueries.setVerification(
    attachmentId,
    verdict.verdict,
    verdict.summary,
    Math.max(0, Math.min(1, Number(verdict.confidence) || 0)),
  );

  // If satisfied with high confidence and item is still pending, promote it
  // to 'complete' so the user doesn't have to do the second click.
  if (verdict.verdict === "satisfied" && verdict.confidence >= 0.7 && item.status === "pending") {
    await checklistQueries.updateStatus(params.itemId, "complete", null);
  }

  return NextResponse.json({ data: verdict });
}
