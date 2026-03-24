import { NextRequest, NextResponse } from "next/server";
import { dealQueries, omAnalysisQueries } from "@/lib/db";

/**
 * GET /api/deals/:id/om-analysis
 * Returns the latest OM analysis for a deal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const analysis = await omAnalysisQueries.getByDealId(params.id);

    return NextResponse.json({ data: { analysis } });
  } catch (error) {
    console.error("GET /api/deals/[id]/om-analysis error:", error);
    return NextResponse.json({ error: "Failed to fetch analysis" }, { status: 500 });
  }
}
