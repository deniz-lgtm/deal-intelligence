import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { progressReportPhotoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { uploadBlob, deleteBlob } from "@/lib/blob-storage";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const photos = await progressReportPhotoQueries.getByReportId(params.reportId);
    return NextResponse.json({ data: photos });
  } catch (err) {
    console.error("GET progress report photos error:", err);
    return NextResponse.json({ error: "Failed to fetch photos" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const category = (formData.get("category") as string) || null;

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const saved = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;

      const id = uuidv4();
      const ext = file.name.split(".").pop() || "jpg";
      const safeName = `${id}.${ext}`;
      const blobPath = `${params.id}/progress-reports/${params.reportId}/photos/${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileUrl = await uploadBlob(blobPath, buffer, file.type);

      const photo = await progressReportPhotoQueries.create({
        id,
        report_id: params.reportId,
        deal_id: params.id,
        name: safeName,
        original_name: file.name,
        file_path: fileUrl,
        file_size: buffer.length,
        mime_type: file.type,
        caption: null,
        category,
      });

      saved.push(photo);
    }

    return NextResponse.json({ data: saved });
  } catch (err) {
    console.error("POST progress report photos error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    if (!body.photoId) {
      return NextResponse.json({ error: "photoId is required" }, { status: 400 });
    }

    const deleted = await progressReportPhotoQueries.delete(body.photoId);
    if (deleted?.file_path) {
      await deleteBlob(deleted.file_path).catch(() => {});
    }

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("DELETE progress report photo error:", err);
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 });
  }
}
