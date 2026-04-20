import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/om-score
 * Accept OM extraction payload and write it to the deal record.
 *
 * Body:
 * {
 *   om_score: number (1-10),
 *   om_extracted: {
 *     asking_price?: number,
 *     sf?: number,
 *     units?: number,
 *     rent_per_sf?: number,
 *     cap_rate?: number,
 *     year_built?: number,
 *     noi?: number,
 *     occupancy?: number,
 *   }
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const body = await req.json();
    const { om_score, om_extracted } = body;

    if (om_score !== undefined && (typeof om_score !== "number" || om_score < 1 || om_score > 10)) {
      return NextResponse.json(
        { error: "om_score must be a number between 1 and 10" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (om_score !== undefined) updates.om_score = Math.round(om_score);
    if (om_extracted !== undefined) updates.om_extracted = om_extracted;

    // Also sync top-level deal fields if extracted values are provided
    if (om_extracted) {
      if (om_extracted.asking_price) updates.asking_price = om_extracted.asking_price;
      if (om_extracted.sf) updates.square_footage = om_extracted.sf;
      if (om_extracted.units) updates.units = om_extracted.units;
      if (om_extracted.year_built) updates.year_built = om_extracted.year_built;
    }

    const updated = await dealQueries.update(params.id, updates);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("POST /api/deals/[id]/om-score error:", error);
    return NextResponse.json({ error: "Failed to update OM score" }, { status: 500 });
  }
}
