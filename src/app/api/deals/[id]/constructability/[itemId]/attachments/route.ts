import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { constructabilityQueries, documentQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { requireAuth, requireDealAccess, requireDealEditAccess, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per image — generous for screenshots

// GET → list attachments for a constructability item.
// POST → multipart/form-data with one or more `file` parts (and optional
// `caption`) creates a documents row + attachment row per file. Designed
// for both drag-drop selection and clipboard paste of screenshots, where
// the browser passes the pasted image as a Blob in formData.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  // Confirm the constructability item belongs to this deal before exposing
  // attachments — guards against id-tampering.
  const item = await constructabilityQueries.getById(params.itemId) as { deal_id: string } | null;
  if (!item || item.deal_id !== params.id) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  const rows = await constructabilityQueries.listAttachments(params.itemId);
  return NextResponse.json({ data: rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const item = await constructabilityQueries.getById(params.itemId) as { deal_id: string } | null;
  if (!item || item.deal_id !== params.id) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const fd = await req.formData();
  const files = fd.getAll("file");
  const caption = (fd.get("caption") as string | null) || null;
  if (files.length === 0) {
    return NextResponse.json({ error: "At least one file is required" }, { status: 400 });
  }

  // Find current max sort_order so new uploads append to the end.
  const existing = await constructabilityQueries.listAttachments(params.itemId);
  let nextSort = existing.length > 0
    ? Math.max(...existing.map((a: { sort_order: number }) => Number(a.sort_order))) + 1
    : 0;

  const created: Record<string, unknown>[] = [];
  for (const f of files) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: `File "${f.name}" exceeds ${(MAX_BYTES / 1024 / 1024) | 0} MB cap.` }, { status: 413 });
    }
    const buf = Buffer.from(await f.arrayBuffer());
    // Pasted clipboard images often arrive as "image.png" with no real name —
    // synthesize a unique filename so storage keys don't collide.
    const baseName = f.name && f.name !== "blob" ? f.name : `paste-${Date.now()}.png`;
    const ext = path.extname(baseName) || ".png";
    const docId = uuidv4();
    const key = `deals/${params.id}/constructability/${params.itemId}/${docId}${ext}`;
    await uploadBlob(key, buf, f.type || "image/png");

    await documentQueries.create({
      id: docId,
      deal_id: params.id,
      name: baseName.replace(ext, "").slice(0, 200),
      original_name: baseName,
      category: "other",
      file_path: key,
      file_size: buf.length,
      mime_type: f.type || "image/png",
      content_text: null,
      ai_summary: null,
      ai_tags: ["constructability", "snippet"],
    });

    const attachment = await constructabilityQueries.createAttachment({
      id: uuidv4(),
      item_id: params.itemId,
      document_id: docId,
      caption,
      sort_order: nextSort++,
      uploaded_by: userId,
    });
    created.push(attachment);
  }

  return NextResponse.json({ data: created });
}
