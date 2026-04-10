import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { siteWalkQueries, siteWalkPhotoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";
import { uploadBlob } from "@/lib/blob-storage";
import { SITE_WALK_AREA_LABELS, type SiteWalkAreaTag } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const photos = await siteWalkPhotoQueries.getByWalkId(params.walkId);
    return NextResponse.json({ data: photos });
  } catch (err) {
    console.error("GET walk photos error:", err);
    return NextResponse.json({ error: "Failed to fetch photos" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    await syncCurrentUser(userId);
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const rawAreaTag = (formData.get("area_tag") as string) || "general";
    const unitLabel = (formData.get("unit_label") as string) || null;
    const areaTag = (rawAreaTag in SITE_WALK_AREA_LABELS
      ? rawAreaTag
      : "general") as SiteWalkAreaTag;

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const saved = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;

      const id = uuidv4();
      const ext = file.name.split(".").pop() || "jpg";
      const safeName = `${id}.${ext}`;
      const blobPath = `${params.id}/site-walks/${params.walkId}/photos/${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileUrl = await uploadBlob(blobPath, buffer, file.type);

      const photo = await siteWalkPhotoQueries.create({
        id,
        site_walk_id: params.walkId,
        deal_id: params.id,
        area_tag: areaTag,
        unit_label: unitLabel,
        name: safeName,
        original_name: file.name,
        file_path: fileUrl,
        file_size: buffer.length,
        mime_type: file.type,
      });

      saved.push(photo);
    }

    return NextResponse.json({ data: saved });
  } catch (err) {
    console.error("POST walk photos error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
