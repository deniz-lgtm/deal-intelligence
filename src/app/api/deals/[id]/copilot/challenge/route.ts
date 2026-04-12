import { NextRequest, NextResponse } from "next/server";
import {
  dealQueries,
  underwritingQueries,
  submarketMetricsQueries,
  locationIntelligenceQueries,
} from "@/lib/db";
import { challengeUnderwriting } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { formatLocationIntelContext } from "@/lib/location-intel-context";

/**
 * POST /api/deals/[id]/copilot/challenge
 * Body: { metrics?: Record<string, unknown> }
 *
 * Reads the deal + current underwriting + submarket metrics, optionally
 * accepts pre-computed metrics from the client (so we don't duplicate the
 * calc function server-side), and returns a structured list of concerns
 * from Claude. No database writes.
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

    const body = await req.json().catch(() => ({}));
    const metrics: Record<string, unknown> | null = body.metrics ?? null;

    const [deal, uwRow, market, locationIntelRows] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      submarketMetricsQueries.getByDealId(params.id),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
    ]);

    if (!uwRow?.data) {
      return NextResponse.json(
        { error: "No underwriting data to challenge yet. Fill in the model first." },
        { status: 400 }
      );
    }

    const uw =
      typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;

    // Enrich market context with location intelligence demographics
    const locationContext = formatLocationIntelContext(locationIntelRows);
    const enrichedMarket = market
      ? { ...market, _locationIntel: locationContext }
      : locationContext
      ? { _locationIntel: locationContext }
      : null;

    const challenges = await challengeUnderwriting(uw, {
      deal,
      market: enrichedMarket,
      metrics,
    });

    return NextResponse.json({ data: challenges });
  } catch (error) {
    console.error("POST /api/deals/[id]/copilot/challenge error:", error);
    return NextResponse.json(
      { error: "Failed to challenge underwriting" },
      { status: 500 }
    );
  }
}
