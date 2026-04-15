import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { lookupParcelApn } from "@/lib/claude";

/**
 * POST /api/deals/[id]/parcel-lookup
 *
 * Best-effort APN / parcel-number lookup for the deal's address. Uses
 * Claude's knowledge of county assessor formats to propose an APN and a
 * link to the county parcel page. Returns nulls when confidence is low —
 * the Site & Zoning UI surfaces that as "Couldn't auto-fill; check the
 * county assessor's site."
 *
 * No body. Returns { data: { apn, source_url, confidence, notes } }.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { deal: rawDeal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const deal = rawDeal as any;

    if (!deal?.address && !deal?.city) {
      return NextResponse.json(
        { error: "Deal must have an address to look up a parcel number" },
        { status: 400 }
      );
    }

    const result = await lookupParcelApn(
      deal.address || "",
      deal.city || "",
      deal.state || "",
      deal.county || null
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("POST /api/deals/[id]/parcel-lookup error:", error);
    return NextResponse.json(
      { error: "Parcel lookup failed" },
      { status: 500 }
    );
  }
}
