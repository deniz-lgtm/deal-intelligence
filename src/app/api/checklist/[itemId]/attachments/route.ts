import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { checklistAttachmentQueries, checklistQueries, documentQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { requireAuth, requireDealEditAccess, syncCurrentUser } from "@/lib/auth";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  // Look up the checklist item to get the deal id for access check.
  const item = await checklistQueries.getById(params.itemId) as { deal_id: string } | null;
  if (!item) return NextResponse.json({ error: "checklist item not found" }, { status: 404 });
  const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
  if (accessError) return accessError;
  const rows = await checklistAttachmentQueries.listByItem(params.itemId);
  return NextResponse.json({ data: rows });
}

// Multipart POST: a file attached to a closeout (or diligence) checklist item.
// File goes to R2; a document row is created; the attachment row links them.
// AI verification is intentionally a separate endpoint so the upload can
// succeed even when Claude is rate-limited or down.
export async function POST(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  const item = await checklistQueries.getById(params.itemId) as { deal_id: string; phase?: string } | null;
  if (!item) return NextResponse.json({ error: "checklist item not found" }, { status: 404 });
  const { errorResponse: accessError } = await requireDealEditAccess(item.deal_id, userId);
  if (accessError) return accessError;

  const fd = await req.formData();
  const file = fd.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${(MAX_BYTES / 1024 / 1024) | 0} MB cap.` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || "";
  const docId = uuidv4();
  const phase = item.phase || "diligence";
  const key = `deals/${item.deal_id}/checklist/${phase}/${docId}${ext}`;
  await uploadBlob(key, buf, file.type || "application/octet-stream");

  // Pre-extract PDF text so the verification endpoint doesn't need to refetch.
  let text = "";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    text = await extractPdfText(buf);
  }

  await documentQueries.create({
    id: docId,
    deal_id: item.deal_id,
    name: file.name.slice(0, 200),
    original_name: file.name,
    category: "other",
    file_path: key,
    file_size: buf.length,
    mime_type: file.type || "application/octet-stream",
    content_text: text || null,
    ai_summary: null,
    ai_tags: [phase === "closeout" ? "closeout" : "diligence", "checklist-attachment"],
  });

  const created = await checklistAttachmentQueries.create({
    id: uuidv4(),
    checklist_item_id: params.itemId,
    document_id: docId,
    uploaded_by: userId,
  });

  return NextResponse.json({ data: created });
}
