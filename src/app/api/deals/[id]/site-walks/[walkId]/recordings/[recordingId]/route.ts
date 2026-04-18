import { NextRequest, NextResponse } from "next/server";
import { siteWalkRecordingQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { deleteBlob, readFile } from "@/lib/blob-storage";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string; recordingId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const recording = await siteWalkRecordingQueries.getById(params.recordingId);
    if (!recording || recording.deal_id !== params.id) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    // If ?binary=1, stream the underlying media file; otherwise return metadata JSON.
    const { searchParams } = new URL(req.url);
    if (searchParams.get("binary") === "1") {
      const buffer = await readFile(recording.file_path);
      if (!buffer) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": recording.mime_type,
          "Content-Disposition": `inline; filename="${encodeURIComponent(recording.original_name)}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    return NextResponse.json({ data: recording });
  } catch (err) {
    console.error("GET recording error:", err);
    return NextResponse.json({ error: "Failed to load recording" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string; recordingId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const recording = await siteWalkRecordingQueries.getById(params.recordingId);
    if (!recording || recording.deal_id !== params.id) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    await siteWalkRecordingQueries.delete(params.recordingId);
    if (recording.file_path) {
      await deleteBlob(recording.file_path).catch(() => {});
    }

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("DELETE recording error:", err);
    return NextResponse.json({ error: "Failed to delete recording" }, { status: 500 });
  }
}
