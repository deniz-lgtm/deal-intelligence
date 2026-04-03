import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { documentQueries, dealQueries } from "@/lib/db";
import { classifyDocument, extractRentRollSummary } from "@/lib/claude";
import { uploadBlob } from "@/lib/blob-storage";

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      return data.text || "";
    } catch {
      return "";
    }
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.includes("xml")
  ) {
    return buffer.toString("utf-8");
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const dealId = formData.get("deal_id") as string;
    const files = formData.getAll("files") as File[];

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const deal = await dealQueries.getById(dealId);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploaded = [];

    for (const file of files) {
      const id = uuidv4();
      const ext = path.extname(file.name);
      const safeName = `${id}${ext}`;
      const blobPath = `${dealId}/${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileUrl = await uploadBlob(blobPath, buffer, file.type || "application/octet-stream");

      const rawText = await extractText(buffer, file.type);
      // Strip null bytes and non-UTF8 characters that Postgres rejects
      const contentText = rawText.replace(/\x00/g, "").replace(/[\uFFFD]/g, "");

      let category = "other";
      let summary = "";
      let tags: string[] = [];

      if (contentText || file.name) {
        try {
          const result = await classifyDocument(file.name, contentText);
          category = result.category;
          summary = result.summary;
          tags = result.tags;
        } catch (err) {
          console.error("AI classification failed for", file.name, ":", err instanceof Error ? err.message : err);
        }
      }

      const doc = await documentQueries.create({
        id,
        deal_id: dealId,
        name: file.name.replace(ext, "").slice(0, 200),
        original_name: file.name,
        category,
        file_path: fileUrl,
        file_size: buffer.length,
        mime_type: file.type || "application/octet-stream",
        content_text: contentText || null,
        ai_summary: summary || null,
        ai_tags: tags.length > 0 ? tags : null,
      });

      // If this looks like a rent roll, extract units/SF/rents and update the deal
      const isRentRoll = /rent.?roll/i.test(file.name) || tags.some(t => /rent.?roll/i.test(t));
      if (isRentRoll && (contentText || file.type === "application/pdf")) {
        const pdfBuf = file.type === "application/pdf" ? buffer : undefined;
        extractRentRollSummary(contentText, pdfBuf).then(async (rrSummary) => {
          if (!rrSummary) return;
          const updates: Record<string, unknown> = {};
          if (rrSummary.total_units) updates.units = rrSummary.total_units;
          if (rrSummary.total_sf) updates.square_footage = rrSummary.total_sf;
          if (Object.keys(updates).length > 0) {
            await dealQueries.update(dealId, updates);
          }
        }).catch(err => console.error("Rent roll extraction failed:", err));
      }

      uploaded.push(doc);
    }

    return NextResponse.json({ data: uploaded }, { status: 201 });
  } catch (error) {
    console.error("POST /api/documents/upload error:", error);
    return NextResponse.json({ error: "Failed to upload documents" }, { status: 500 });
  }
}
