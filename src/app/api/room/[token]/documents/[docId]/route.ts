import { NextRequest, NextResponse } from "next/server";
import { dealRoomQueries, watermarkPdf } from "@/lib/deal-room";
import { getPool } from "@/lib/db";
import { readFile } from "@/lib/blob-storage";

/**
 * GET /api/room/[token]/documents/[docId]
 *
 * Public document streamer. Validates that:
 *  1. The token resolves to a valid, unrevoked, unexpired invite
 *  2. NDA is accepted (if required)
 *  3. The doc is actually in this room's document list
 *
 * Logs a `document_viewed` event and streams the file back. Intended to
 * be loaded inside an iframe on the /room/[token] viewer page. Content-
 * Disposition is `inline` so PDFs open in the browser viewer; there is
 * no download button in the UI, though a determined guest could still
 * save via the browser. Watermarking is deferred.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string; docId: string } }
) {
  const lookup = await dealRoomQueries.findInviteByToken(params.token);
  if (!lookup) {
    return new NextResponse("Invalid or expired link", { status: 404 });
  }
  const { invite, room } = lookup;

  if (room.nda_required && !invite.nda_accepted_at) {
    return new NextResponse("NDA not accepted", { status: 403 });
  }

  // Confirm the doc is in this room
  const pool = getPool();
  const res = await pool.query(
    `SELECT d.* FROM deal_room_documents rd
     JOIN documents d ON d.id = rd.document_id
     WHERE rd.room_id = $1 AND rd.document_id = $2
     LIMIT 1`,
    [room.id, params.docId]
  );
  if (res.rows.length === 0) {
    return new NextResponse("Document not in this room", { status: 404 });
  }
  const doc = res.rows[0];

  // Log the view
  await dealRoomQueries.logActivity({
    room_id: room.id,
    invite_id: invite.id,
    email: invite.email,
    event: "document_viewed",
    document_id: params.docId,
    ip: getIp(req),
    user_agent: req.headers.get("user-agent") || null,
  });

  // Stream the file from blob storage
  let buffer = await readFile(doc.file_path);
  if (!buffer) {
    return new NextResponse("File not found in storage", { status: 404 });
  }

  // Watermark PDFs with the viewer's email (server-side, tamper-resistant)
  const isPdf =
    (doc.mime_type as string) === "application/pdf" ||
    (doc.original_name as string)?.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    try {
      buffer = await watermarkPdf(buffer, invite.email);
    } catch (err) {
      console.warn("PDF watermarking failed, serving original:", err);
      // Fall through — serve the un-watermarked version rather than 500
    }
  }

  // ?download=1 → Content-Disposition: attachment (download button)
  const isDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition = isDownload ? "attachment" : "inline";

  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type": doc.mime_type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(
        doc.original_name || doc.name || "document"
      )}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function getIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}
