import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { gcBidQueries, documentQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { requireAuth, requireDealEditAccess, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Multipart bid creation: contractor metadata + a PDF file. The PDF gets
// stored in R2 like any other deal document, then text-extracted server-side
// so AI leveling can run against it without re-fetching the file. The bid's
// `source_document_id` is set to the new document's id so the leveler can
// drill back into the source if needed.

const MAX_BYTES = 50 * 1024 * 1024; // bids rarely exceed 50 MB

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch (err) {
    console.warn("pdf-parse failed for bid upload:", err);
    return "";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const fd = await req.formData();
  const file = fd.get("file");
  const contractor_name = (fd.get("contractor_name") as string | null)?.trim() || "";
  const contractor_company = (fd.get("contractor_company") as string | null) || null;
  const contractor_email = (fd.get("contractor_email") as string | null) || null;
  const bid_date = (fd.get("bid_date") as string | null) || null;
  const total_amount_raw = fd.get("total_amount") as string | null;
  const total_amount = total_amount_raw && total_amount_raw !== "" ? Number(total_amount_raw) : null;
  const notes = (fd.get("notes") as string | null) || null;

  if (!contractor_name) {
    return NextResponse.json({ error: "contractor_name is required" }, { status: 400 });
  }

  let documentId: string | null = null;
  let rawText = (fd.get("raw_text") as string | null) || "";

  if (file && file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File exceeds ${(MAX_BYTES / 1024 / 1024) | 0} MB cap.` }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name) || ".pdf";
    const docId = uuidv4();
    const key = `deals/${params.id}/gc-bids/${docId}${ext}`;
    await uploadBlob(key, buf, file.type || "application/pdf");

    // Extract text first so it can be saved on the document row too.
    let text = "";
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      text = await extractPdfText(buf);
      rawText = rawText ? `${rawText}\n\n=== PDF: ${file.name} ===\n${text}` : text;
    }

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
      ai_summary: `GC bid from ${contractor_name}${contractor_company ? ` (${contractor_company})` : ""}.`,
      ai_tags: ["gc-bid", "bid"],
    });
    documentId = (doc?.id as string) ?? docId;
  }

  const bid = await gcBidQueries.createBid({
    id: uuidv4(),
    deal_id: params.id,
    contractor_name,
    contractor_company,
    contractor_email,
    bid_date,
    total_amount,
    status: "received",
    source_document_id: documentId,
    raw_text: rawText || null,
    notes,
  });

  return NextResponse.json({ data: bid });
}
