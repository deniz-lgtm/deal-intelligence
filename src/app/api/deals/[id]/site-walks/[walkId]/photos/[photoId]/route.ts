import { NextRequest, NextResponse } from "next/server";
import { siteWalkPhotoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { deleteBlob, readFile } from "@/lib/blob-storage";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string; photoId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const photo = await siteWalkPhotoQueries.getById(params.photoId);
    if (!photo || photo.deal_id !== params.id) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    if (searchParams.get("binary") === "1") {
      const buffer = await readFile(photo.file_path);
      if (!buffer) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": photo.mime_type,
          "Content-Disposition": `inline; filename="${encodeURIComponent(photo.original_name)}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    return NextResponse.json({ data: photo });
  } catch (err) {
    console.error("GET walk photo error:", err);
    return NextResponse.json({ error: "Failed to load photo" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string; photoId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const photo = await siteWalkPhotoQueries.getById(params.photoId);
    if (!photo || photo.deal_id !== params.id) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const body = await req.json();
    const updated = await siteWalkPhotoQueries.update(params.photoId, body);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("PATCH walk photo error:", err);
    return NextResponse.json({ error: "Failed to update photo" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string; photoId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const photo = await siteWalkPhotoQueries.getById(params.photoId);
    if (!photo || photo.deal_id !== params.id) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    await siteWalkPhotoQueries.delete(params.photoId);
    if (photo.file_path) {
      await deleteBlob(photo.file_path).catch(() => {});
    }
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("DELETE walk photo error:", err);
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 });
  }
}
