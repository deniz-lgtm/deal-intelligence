import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { dropboxQueries, dealQueries, documentQueries } from "@/lib/db";
import { downloadFile, refreshAccessToken, guessMimeType } from "@/lib/dropbox";
import { classifyDocument } from "@/lib/claude";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

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
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return buffer.toString("utf-8");
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deal_id, paths } = body as { deal_id: string; paths: string[] };

    if (!deal_id || !paths?.length) {
      return NextResponse.json({ error: "deal_id and paths are required" }, { status: 400 });
    }

    const [deal, account] = await Promise.all([
      dealQueries.getById(deal_id),
      dropboxQueries.get(),
    ]);

    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    if (!account) return NextResponse.json({ error: "Not connected to Dropbox" }, { status: 401 });

    let accessToken = account.access_token;

    // Save chosen folder path to deal for convenience (use first file's parent)
    const firstFolder = paths[0].split("/").slice(0, -1).join("/") || "/";
    if (firstFolder !== "/") {
      await dealQueries.update(deal_id, { dropbox_folder_path: firstFolder });
    }

    const dealUploadDir = path.join(UPLOAD_DIR, deal_id);
    await fs.mkdir(dealUploadDir, { recursive: true });

    // Fetch existing document names to skip duplicates
    const existing = await documentQueries.getByDealId(deal_id) as Array<{ original_name: string }>;
    const existingNames = new Set(existing.map((d) => d.original_name.toLowerCase()));

    const imported = [];
    const skipped = [];
    const failed: string[] = [];

    for (const dropboxPath of paths) {
      const fileName = dropboxPath.split("/").pop() ?? dropboxPath;

      if (existingNames.has(fileName.toLowerCase())) {
        skipped.push(fileName);
        continue;
      }

      try {
        let result;
        try {
          result = await downloadFile(accessToken, dropboxPath);
        } catch {
          // Token may be expired — refresh and retry
          if (account.refresh_token) {
            const refreshed = await refreshAccessToken(account.refresh_token);
            accessToken = refreshed.access_token;
            await dropboxQueries.updateToken(accessToken);
            result = await downloadFile(accessToken, dropboxPath);
          } else {
            throw new Error("Token expired");
          }
        }

        const { buffer, metadata } = result;
        const id = uuidv4();
        const ext = path.extname(metadata.name);
        const safeName = `${id}${ext}`;
        const filePath = path.join(dealUploadDir, safeName);

        await fs.writeFile(filePath, buffer);

        const mimeType = guessMimeType(metadata.name);
        const rawText = await extractText(buffer, mimeType);
        const contentText = rawText.replace(/\x00/g, "").replace(/[\uFFFD]/g, "");

        let category = "other";
        let summary = "";
        let tags: string[] = [];

        try {
          const classification = await classifyDocument(metadata.name, contentText);
          category = classification.category;
          summary = classification.summary;
          tags = classification.tags;
        } catch (err) {
          console.error("AI classification failed for", metadata.name, ":", err);
        }

        const baseName = metadata.name.replace(ext, "").slice(0, 200);
        const doc = await documentQueries.create({
          id,
          deal_id,
          name: baseName,
          original_name: metadata.name,
          category,
          file_path: filePath,
          file_size: buffer.length,
          mime_type: mimeType,
          content_text: contentText || null,
          ai_summary: summary || null,
          ai_tags: tags.length > 0 ? tags : null,
        });

        imported.push(doc);
      } catch (err) {
        console.error(`Failed to import ${dropboxPath}:`, err);
        failed.push(fileName);
      }
    }

    return NextResponse.json({
      data: { imported: imported.length, skipped: skipped.length, failed, documents: imported },
    });
  } catch (error) {
    console.error("POST /api/dropbox/import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
