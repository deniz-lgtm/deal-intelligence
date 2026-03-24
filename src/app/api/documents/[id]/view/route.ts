import { NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import fs from "fs";
import path from "path";
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

    const filePath = path.isAbsolute(doc.file_path)
      ? doc.file_path
      : path.join(process.cwd(), doc.file_path);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer, {
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
