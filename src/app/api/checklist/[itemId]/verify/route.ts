import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import {
  checklistAttachmentQueries,
  checklistQueries,
  warrantyQueries,
  lienWaiverQueries,
  drawQueries,
  getPool,
} from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Verdict {
  verdict: "satisfied" | "partial" | "not_satisfied" | "unrelated";
  summary: string;
  confidence: number;
  // Optional structured extraction. Only populated when the document type
  // matches the checklist item (lien waiver / warranty). The route uses these
  // to populate the warranty register and lien-waiver verifications.
  document_type?: "lien_waiver" | "warranty" | "other" | null;
  lien_waiver?: {
    contractor_name: string | null;
    waiver_type: "conditional_progress" | "unconditional_progress" | "conditional_final" | "unconditional_final" | null;
    through_date: string | null;
    amount: number | null;
  } | null;
  warranty?: {
    vendor: string | null;
    product: string;
    scope: string | null;
    start_date: string | null;
    duration_months: number | null;
    end_date: string | null;
    coverage_summary: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    claim_instructions: string | null;
  } | null;
}

const SYSTEM_PROMPT = `You verify whether an uploaded document satisfies a checklist item AND, when relevant, extract structured fields from it.

Return JSON only, no fences. Be concise (1–2 sentences for summary) and conservative — only return "satisfied" when the document clearly addresses the item.

If the checklist item is about LIEN WAIVERS and the document is a lien waiver, set document_type="lien_waiver" and populate lien_waiver{contractor_name, waiver_type, through_date (YYYY-MM-DD), amount (number, no $/commas)}. waiver_type is one of: conditional_progress, unconditional_progress, conditional_final, unconditional_final. Use null for any field you can't read.

If the checklist item is about WARRANTIES and the document is a warranty, set document_type="warranty" and populate warranty{vendor, product (required, e.g. "Roof membrane"), scope, start_date (YYYY-MM-DD), duration_months (integer), end_date (YYYY-MM-DD), coverage_summary, contact_email, contact_phone, claim_instructions}.

Otherwise set document_type="other" and omit lien_waiver/warranty.

Schema:
{
  "verdict": "satisfied" | "partial" | "not_satisfied" | "unrelated",
  "summary": "<1-2 sentence rationale>",
  "confidence": <0..1>,
  "document_type": "lien_waiver" | "warranty" | "other" | null,
  "lien_waiver": { ... } | null,
  "warranty": { ... } | null
}`;

function categoryHint(category: string, item: string): "lien_waiver" | "warranty" | "other" {
  const text = `${category} ${item}`.toLowerCase();
  if (text.includes("lien") && text.includes("waiv")) return "lien_waiver";
  if (text.includes("warrant")) return "warranty";
  return "other";
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Best-effort match of a parsed lien waiver to one of the deal's draws.
 * The scoring favours waivers whose through_date falls within or near a
 * draw's submitted/approved window, with a tighter margin = higher confidence.
 */
function matchWaiverToDraw(
  waiver: { through_date: string | null; amount: number | null },
  draws: Array<{ id: string; draw_number: number; submitted_date: string | null; approved_date: string | null; amount_approved: number | null; amount_requested: number | null }>,
): { drawId: string | null; matchStatus: string; notes: string } {
  if (!waiver.through_date || draws.length === 0) {
    return { drawId: null, matchStatus: "needs_review", notes: "Couldn't read waiver through-date — match manually." };
  }
  const through = parseDate(waiver.through_date);
  if (!through) {
    return { drawId: null, matchStatus: "needs_review", notes: "Through-date unparseable — match manually." };
  }

  let bestDraw: typeof draws[number] | null = null;
  let bestScore = Number.POSITIVE_INFINITY; // smaller = closer
  for (const d of draws) {
    const ref = parseDate(d.approved_date) ?? parseDate(d.submitted_date);
    if (!ref) continue;
    const days = Math.abs((through.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
    if (days < bestScore) {
      bestScore = days;
      bestDraw = d;
    }
  }
  if (!bestDraw) {
    return { drawId: null, matchStatus: "needs_review", notes: "No draws have submission/approval dates yet." };
  }
  if (bestScore > 35) {
    return {
      drawId: bestDraw.id,
      matchStatus: "needs_review",
      notes: `Closest draw is #${bestDraw.draw_number}, ${Math.round(bestScore)} days off — verify this is the right draw.`,
    };
  }

  // Amount sanity check — typical draw amounts >> a single waiver, but if the
  // waiver amount is wildly larger than the draw, flag it.
  const waiverAmount = Number(waiver.amount) || 0;
  const drawAmount = Number(bestDraw.amount_approved ?? bestDraw.amount_requested) || 0;
  if (waiverAmount > 0 && drawAmount > 0 && waiverAmount > drawAmount * 1.1) {
    return {
      drawId: bestDraw.id,
      matchStatus: "amount_mismatch",
      notes: `Waiver amount (${waiverAmount}) exceeds draw #${bestDraw.draw_number} approved amount (${drawAmount}).`,
    };
  }
  return {
    drawId: bestDraw.id,
    matchStatus: "matched",
    notes: `Matched to draw #${bestDraw.draw_number} (${Math.round(bestScore)} days from through-date).`,
  };
}

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

  // ── Lien waiver matcher ──────────────────────────────────────────────
  // Persist a deal_lien_waivers row when this is a waiver; attempt to match
  // it to a draw for the closeout reconciliation.
  let extraSummary = "";
  const hint = categoryHint(item.category, item.item);
  if ((verdict.document_type === "lien_waiver" || hint === "lien_waiver") && verdict.lien_waiver) {
    const w = verdict.lien_waiver;
    const draws = await drawQueries.getByDealId(item.deal_id);
    const match = matchWaiverToDraw(
      { through_date: w.through_date, amount: w.amount },
      draws.map((d: Record<string, unknown>) => ({
        id: d.id as string,
        draw_number: d.draw_number as number,
        submitted_date: (d.submitted_date as string | null) ?? null,
        approved_date: (d.approved_date as string | null) ?? null,
        amount_approved: d.amount_approved === null || d.amount_approved === undefined ? null : Number(d.amount_approved),
        amount_requested: d.amount_requested === null || d.amount_requested === undefined ? null : Number(d.amount_requested),
      })),
    );
    await lienWaiverQueries.create({
      id: uuidv4(),
      deal_id: item.deal_id,
      contractor_name: w.contractor_name,
      waiver_type: w.waiver_type,
      through_date: w.through_date,
      amount: w.amount,
      draw_id: match.drawId,
      source_document_id: docRow.document_id,
      source_attachment_id: attachmentId,
      match_status: match.matchStatus,
      match_notes: match.notes,
      ai_confidence: verdict.confidence,
    });
    extraSummary = ` Lien waiver registered: ${match.notes}`;
  }

  // ── Warranty extractor ───────────────────────────────────────────────
  if ((verdict.document_type === "warranty" || hint === "warranty") && verdict.warranty) {
    const w = verdict.warranty;
    let endDate = w.end_date;
    if (!endDate && w.start_date && w.duration_months) {
      const d = new Date(`${w.start_date}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + Math.round(w.duration_months));
        endDate = d.toISOString().slice(0, 10);
      }
    }
    await warrantyQueries.create({
      id: uuidv4(),
      deal_id: item.deal_id,
      vendor: w.vendor,
      product: w.product || item.item,
      scope: w.scope,
      start_date: w.start_date,
      duration_months: w.duration_months,
      end_date: endDate,
      coverage_summary: w.coverage_summary,
      contact_email: w.contact_email,
      contact_phone: w.contact_phone,
      claim_instructions: w.claim_instructions,
      source_document_id: docRow.document_id,
      source_attachment_id: attachmentId,
      ai_confidence: verdict.confidence,
    });
    extraSummary = ` Warranty registered: ${w.product} from ${w.vendor ?? "unknown vendor"}.`;
  }

  // If satisfied with high confidence and item is still pending, promote it
  // to 'complete' so the user doesn't have to do the second click.
  if (verdict.verdict === "satisfied" && verdict.confidence >= 0.7 && item.status === "pending") {
    await checklistQueries.updateStatus(params.itemId, "complete", null);
  }

  return NextResponse.json({
    data: { ...verdict, summary: verdict.summary + extraSummary },
  });
}
