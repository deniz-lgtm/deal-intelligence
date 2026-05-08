import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { constructionRfiQueries, documentQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { requireAuth, requireDealAccess, requireDealEditAccess, syncCurrentUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveModel } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch {
    return "";
  }
}

interface RfiMetadata {
  rfi_number: string | null;
  subject: string | null;
  submitted_by: string | null;
  submitted_date: string | null;
  response_required_by: string | null;
  discipline: string | null;
  cost_impact: number | null;
  schedule_impact_days: number | null;
}

// Best-effort metadata extraction from RFI body text. Returns nulls for any
// field that's missing or unclear. Cheap single Claude call (small max_tokens)
// because RFIs are very structured.
async function extractRfiMetadata(text: string, fileName: string): Promise<RfiMetadata | null> {
  if (!text || text.length < 50) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Extract metadata from this construction RFI. Return JSON only, no fences, no prose.

Filename: ${fileName}

RFI TEXT:
${text.slice(0, 8000)}

Schema:
{
  "rfi_number": "<RFI number as on doc, e.g. 'RFI-024' or null>",
  "subject": "<short subject line>",
  "submitted_by": "<contractor / firm / individual that filed it, or null>",
  "submitted_date": "<YYYY-MM-DD if visible, else null>",
  "response_required_by": "<YYYY-MM-DD if visible, else null>",
  "discipline": "<architectural | structural | mep | civil | electrical | plumbing | hvac | fire_life_safety | other | null>",
  "cost_impact": <number or null>,
  "schedule_impact_days": <integer or null>
}`;
  try {
    const response = await client.messages.create({
      model: await getActiveModel(),
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const out = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = out.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned) as RfiMetadata;
  } catch (err) {
    console.warn("RFI metadata extraction failed:", err);
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;
  const items = await constructionRfiQueries.listByDeal(params.id);
  return NextResponse.json({ data: items });
}

// Multipart POST: a contractor RFI PDF + optional manual metadata. The PDF is
// stored in R2 and text-extracted; AI fills in the metadata fields the user
// didn't explicitly provide. Inserting a manual RFI without a file is also
// supported by sending application/json instead.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const contentType = req.headers.get("content-type") || "";
  let payload: Record<string, unknown> = {};
  let documentId: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    if (file && file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: `File exceeds ${(MAX_BYTES / 1024 / 1024) | 0} MB cap.` }, { status: 413 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = path.extname(file.name) || ".pdf";
      const docId = uuidv4();
      const key = `deals/${params.id}/rfis/${docId}${ext}`;
      await uploadBlob(key, buf, file.type || "application/pdf");
      const text = await extractPdfText(buf);

      // Best-effort metadata extraction; failures fall back to whatever the
      // user provided in the form.
      const ai = await extractRfiMetadata(text, file.name);

      const doc = await documentQueries.create({
        id: docId,
        deal_id: params.id,
        name: file.name.replace(ext, "").slice(0, 200),
        original_name: file.name,
        category: "other",
        file_path: key,
        file_size: buf.length,
        mime_type: file.type || "application/pdf",
        content_text: text || null,
        ai_summary: `Construction RFI${ai?.rfi_number ? ` ${ai.rfi_number}` : ""}${ai?.subject ? ` — ${ai.subject}` : ""}.`,
        ai_tags: ["construction-rfi", "rfi"],
      });
      documentId = (doc?.id as string) ?? docId;

      payload = {
        rfi_number: (fd.get("rfi_number") as string | null) || ai?.rfi_number || null,
        subject: (fd.get("subject") as string | null) || ai?.subject || file.name,
        submitted_by: (fd.get("submitted_by") as string | null) || ai?.submitted_by || null,
        submitted_date: (fd.get("submitted_date") as string | null) || ai?.submitted_date || null,
        response_required_by: (fd.get("response_required_by") as string | null) || ai?.response_required_by || null,
        discipline: (fd.get("discipline") as string | null) || ai?.discipline || null,
        cost_impact: (() => {
          const v = fd.get("cost_impact") as string | null;
          return v && v !== "" ? Number(v) : ai?.cost_impact ?? null;
        })(),
        schedule_impact_days: (() => {
          const v = fd.get("schedule_impact_days") as string | null;
          return v && v !== "" ? Number(v) : ai?.schedule_impact_days ?? null;
        })(),
        notes: (fd.get("notes") as string | null) || null,
        source_document_id: documentId,
      };
    } else {
      // Multipart with no file = treat like JSON.
      payload = {
        rfi_number: fd.get("rfi_number") || null,
        subject: fd.get("subject") || "Untitled RFI",
        submitted_by: fd.get("submitted_by") || null,
        submitted_date: fd.get("submitted_date") || null,
        response_required_by: fd.get("response_required_by") || null,
        discipline: fd.get("discipline") || null,
        notes: fd.get("notes") || null,
      };
    }
  } else {
    payload = await req.json();
  }

  if (!payload.subject || (typeof payload.subject === "string" && !payload.subject.trim())) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }

  const created = await constructionRfiQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    ...payload,
  });
  return NextResponse.json({ data: created });
}
