import { NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { readFile } from "@/lib/blob-storage";
import type { Document } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const doc = (await documentQueries.getById(params.id)) as Document | undefined;
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Always stream through our API. R2 buckets are private, so a redirect
    // to the raw object URL would 403 in the browser.
    const fileBuffer = await readFile(doc.file_path);
    if (!fileBuffer) {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.original_name)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Error serving document:", err);
    return NextResponse.json({ error: "Failed to serve document" }, { status: 500 });
  }
}
