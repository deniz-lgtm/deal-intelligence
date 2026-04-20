import { NextRequest, NextResponse } from "next/server";
import {
  siteWalkQueries,
  siteWalkRecordingQueries,
  siteWalkPhotoQueries,
  siteWalkDeficiencyQueries,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { deleteBlob } from "@/lib/blob-storage";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const [recordings, photos, deficiencies] = await Promise.all([
      siteWalkRecordingQueries.getByWalkId(params.walkId),
      siteWalkPhotoQueries.getByWalkId(params.walkId),
      siteWalkDeficiencyQueries.getByWalkId(params.walkId),
    ]);

    return NextResponse.json({
      data: { walk, recordings, photos, deficiencies },
    });
  } catch (err) {
    console.error("GET /api/deals/[id]/site-walks/[walkId] error:", err);
    return NextResponse.json({ error: "Failed to fetch site walk" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const body = await req.json();
    const updated = await siteWalkQueries.update(params.walkId, body);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("PATCH /api/deals/[id]/site-walks/[walkId] error:", err);
    return NextResponse.json({ error: "Failed to update site walk" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    // Clean up associated blobs
    const [recordings, photos] = await Promise.all([
      siteWalkRecordingQueries.getByWalkId(params.walkId),
      siteWalkPhotoQueries.getByWalkId(params.walkId),
    ]);
    await Promise.all([
      ...recordings.map((r: { file_path: string }) => deleteBlob(r.file_path).catch(() => {})),
      ...photos.map((p: { file_path: string }) => deleteBlob(p.file_path).catch(() => {})),
    ]);

    await siteWalkQueries.delete(params.walkId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("DELETE /api/deals/[id]/site-walks/[walkId] error:", err);
    return NextResponse.json({ error: "Failed to delete site walk" }, { status: 500 });
  }
}
