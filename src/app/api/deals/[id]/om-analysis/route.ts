import { NextRequest, NextResponse } from "next/server";
import { dealQueries, omAnalysisQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * GET /api/deals/:id/om-analysis
 * Returns the latest OM analysis for a deal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const analysis = await omAnalysisQueries.getByDealId(params.id);

    return NextResponse.json({ data: { analysis } });
  } catch (error) {
    console.error("GET /api/deals/[id]/om-analysis error:", error);
    return NextResponse.json({ error: "Failed to fetch analysis" }, { status: 500 });
  }
}
