import { NextRequest, NextResponse } from "next/server";
import { getPool, documentQueries } from "@/lib/db";
import { downloadFile, refreshAccessToken, guessMimeType } from "@/lib/google-drive";
import { classifyDocument } from "@/lib/claude";
import { requireAuth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const { deal_id, file_ids } = await req.json();
    if (!deal_id || !file_ids?.length) return NextResponse.json({ error: "Missing deal_id or file_ids" }, { status: 400 });

    const pool = getPool();
    const row = await pool.query("SELECT access_token, refresh_token FROM google_drive_accounts WHERE id = 'default'");
    if (row.rows.length === 0) return NextResponse.json({ error: "Not connected" }, { status: 401 });

    let { access_token, refresh_token } = row.rows[0];

    // Refresh token if needed
    try {
      await fetch("https://www.googleapis.com/drive/v3/about?fields=user", { headers: { Authorization: `Bearer ${access_token}` } });
    } catch {
      if (refresh_token) {
        const refreshed = await refreshAccessToken(refresh_token);
        access_token = refreshed.access_token;
        await pool.query("UPDATE google_drive_accounts SET access_token = $1, updated_at = NOW() WHERE id = 'default'", [access_token]);
      }
    }

    const results: Array<{ name: string; status: "imported" | "skipped" | "failed" }> = [];

    for (const fileId of file_ids) {
      try {
        const { buffer, name, mimeType } = await downloadFile(access_token, fileId);

        // Dedupe check
        const existing = await pool.query("SELECT id FROM documents WHERE deal_id = $1 AND original_name = $2", [deal_id, name]);
        if (existing.rows.length > 0) { results.push({ name, status: "skipped" }); continue; }

        // Extract text from PDFs
        let contentText = "";
        if (name.toLowerCase().endsWith(".pdf")) {
          try {
            const pdfParse = require("pdf-parse");
            const parsed = await pdfParse(buffer);
            contentText = (parsed.text || "").replace(/\x00/g, "").substring(0, 100000);
          } catch { /* non-text PDF */ }
        }

        // AI classify
        let category = "other", summary = "", tags: string[] = [];
        try {
          const classified = await classifyDocument(name, contentText);
          category = classified.category || "other";
          summary = classified.summary || "";
          tags = classified.tags || [];
        } catch { /* fallback */ }

        // Upload to blob storage
        const ext = name.includes(".") ? "." + name.split(".").pop() : "";
        const blobPath = `${deal_id}/${uuidv4()}${ext}`;
        // Use the same upload pattern as the existing document upload
        const { put } = require("@vercel/blob");
        let fileUrl = blobPath;
        try {
          const blob = await put(blobPath, buffer, { access: "public", contentType: mimeType || guessMimeType(name) });
          fileUrl = blob.url;
        } catch {
          // Fallback: store path only (blob not configured)
          fileUrl = blobPath;
        }

        const docId = uuidv4();
        await pool.query(
          `INSERT INTO documents (id, deal_id, name, original_name, category, file_path, file_size, mime_type, content_text, ai_summary, ai_tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [docId, deal_id, name, name, category, fileUrl, buffer.length, mimeType || guessMimeType(name), contentText, summary, JSON.stringify(tags)]
        );
        results.push({ name, status: "imported" });
      } catch (err) {
        console.error(`Failed to import ${fileId}:`, err);
        results.push({ name: fileId, status: "failed" });
      }
    }

    const imported = results.filter(r => r.status === "imported").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    return NextResponse.json({ data: { imported, skipped, failed: results.filter(r => r.status === "failed").length, results } });
  } catch (error) {
    console.error("Google Drive import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
