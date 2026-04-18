import { NextRequest, NextResponse } from "next/server";
import { photoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const photos = await photoQueries.getByDealId(params.id);
    return NextResponse.json({ data: photos });
  } catch (err) {
    console.error("Error fetching photos:", err);
    return NextResponse.json({ error: "Failed to fetch photos" }, { status: 500 });
  }
}

// PATCH { cover_photo_id } — mark a photo as the cover for this deal.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const photoId = body?.cover_photo_id;
    if (!photoId || typeof photoId !== "string") {
      return NextResponse.json({ error: "cover_photo_id is required" }, { status: 400 });
    }

    const existing = await photoQueries.getById(photoId) as { deal_id: string } | null;
    if (!existing || existing.deal_id !== params.id) {
      return NextResponse.json({ error: "Photo not found for this deal" }, { status: 404 });
    }

    const updated = await photoQueries.setCover(params.id, photoId);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Error setting cover photo:", err);
    return NextResponse.json({ error: "Failed to set cover photo" }, { status: 500 });
  }
}
