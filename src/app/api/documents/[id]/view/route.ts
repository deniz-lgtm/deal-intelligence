import { NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { readFile, readFileStream } from "@/lib/blob-storage";
import type { Document } from "@/lib/types";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const doc = (await documentQueries.getById(params.id)) as Document | undefined;
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Stream the bytes straight through the response without buffering.
    // Previously this route did readFile() and handed the whole thing
    // to NextResponse as a Uint8Array — which worked, but loaded every
    // byte of every viewed document into the Node heap, so 10 users
    // viewing 50 MB OMs would put ~500 MB of pressure on a Railway
    // container capped at 512 MB.
    const stream = await readFileStream(doc.file_path);
    if (stream) {
      const headers: Record<string, string> = {
        "Content-Type": doc.mime_type || stream.contentType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.original_name)}"`,
        "Cache-Control": "private, max-age=3600",
      };
      if (stream.contentLength) headers["Content-Length"] = String(stream.contentLength);
      return new Response(stream.stream, { headers });
    }

    // Streaming path couldn't resolve the object (very small / legacy
    // storage adapters); fall back to the buffered read so the viewer
    // still works.
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
