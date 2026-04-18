import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { geocodeAddress, buildCompAddress } from "@/lib/geocode";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[id]/geocode
 *
 * Geocodes the deal's address via the Census.gov geocoder and writes the
 * resulting lat/lng back to the deals table. Used as the "subject origin"
 * for the per-deal Comps tab's distance-from-subject filter.
 *
 * No body. Returns the updated deal.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const addr = buildCompAddress({
      address: deal.address,
      city: deal.city,
      state: deal.state,
    });
    if (!addr) {
      return NextResponse.json(
        { error: "Deal has no address to geocode" },
        { status: 400 }
      );
    }

    const result = await geocodeAddress(addr);
    if (!result) {
      return NextResponse.json(
        { error: "Geocoder couldn't resolve the address" },
        { status: 422 }
      );
    }

    const updated = await dealQueries.update(params.id, {
      lat: result.lat,
      lng: result.lng,
    });
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("POST /api/deals/[id]/geocode error:", error);
    return NextResponse.json(
      { error: "Failed to geocode deal" },
      { status: 500 }
    );
  }
}
