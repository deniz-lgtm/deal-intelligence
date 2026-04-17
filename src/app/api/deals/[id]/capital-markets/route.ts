import { NextRequest, NextResponse } from "next/server";
import { fetchCapitalMarketsSnapshot } from "@/lib/capital-markets";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * GET /api/deals/:id/capital-markets
 *
 * Returns the FRED-sourced capital-markets snapshot (10Y / 5Y UST, SOFR,
 * Fed Funds, 30Y Mortgage + deltas) with computed implied cap-rate bands
 * and construction-loan rate bands, scoped to the deal so the Comps &
 * Market page can render a small strip alongside broker research.
 *
 * Endpoint is deal-scoped (not workspace-scoped) so access control stays
 * consistent with the rest of the Market Intelligence panel. The payload
 * itself is market-wide so downstream it can be cached across deals.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const snapshot = await fetchCapitalMarketsSnapshot();
    return NextResponse.json({ data: snapshot });
  } catch (error) {
    console.error("GET /api/deals/[id]/capital-markets error:", error);
    return NextResponse.json({ error: "Failed to fetch capital markets" }, { status: 500 });
  }
}
