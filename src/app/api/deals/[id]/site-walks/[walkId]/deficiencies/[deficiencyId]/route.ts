import { NextRequest, NextResponse } from "next/server";
import { siteWalkDeficiencyQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string; deficiencyId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deficiency = await siteWalkDeficiencyQueries.getById(params.deficiencyId);
    if (!deficiency || deficiency.deal_id !== params.id) {
      return NextResponse.json({ error: "Deficiency not found" }, { status: 404 });
    }

    const body = await req.json();
    const updated = await siteWalkDeficiencyQueries.update(params.deficiencyId, body);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("PATCH deficiency error:", err);
    return NextResponse.json({ error: "Failed to update deficiency" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string; deficiencyId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deficiency = await siteWalkDeficiencyQueries.getById(params.deficiencyId);
    if (!deficiency || deficiency.deal_id !== params.id) {
      return NextResponse.json({ error: "Deficiency not found" }, { status: 404 });
    }

    await siteWalkDeficiencyQueries.delete(params.deficiencyId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error("DELETE deficiency error:", err);
    return NextResponse.json({ error: "Failed to delete deficiency" }, { status: 500 });
  }
}
