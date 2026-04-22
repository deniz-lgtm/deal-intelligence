import { NextRequest, NextResponse } from "next/server";
import { compQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { enrichCompPatchWithGeocode } from "@/lib/geocode";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; compId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    // Auto-geocode when an address field changes — removes the need for a
    // dedicated "Geocode" button on individual comps. Merges the incoming
    // patch against the existing row so the geocoder has the full address
    // even when the user only typed the street portion.
    const existing = await compQueries.getById(params.compId);
    const patched = await enrichCompPatchWithGeocode(body, existing ? {
      address: existing.address,
      city: existing.city,
      state: existing.state,
    } : null);
    const row = await compQueries.update(params.compId, patched);
    if (!row) {
      return NextResponse.json({ error: "Comp not found" }, { status: 404 });
    }
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/comps/[compId] error:", error);
    return NextResponse.json({ error: "Failed to update comp" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; compId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await compQueries.delete(params.compId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/comps/[compId] error:", error);
    return NextResponse.json({ error: "Failed to delete comp" }, { status: 500 });
  }
}
