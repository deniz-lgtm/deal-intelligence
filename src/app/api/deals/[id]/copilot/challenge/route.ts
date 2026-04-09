import { NextRequest, NextResponse } from "next/server";
import {
  dealQueries,
  underwritingQueries,
  submarketMetricsQueries,
} from "@/lib/db";
import { challengeUnderwriting } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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

    const [deal, uwRow, market] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      submarketMetricsQueries.getByDealId(params.id),
    ]);

    if (!uwRow?.data) {
      return NextResponse.json(
        { error: "No underwriting data to challenge yet. Fill in the model first." },
        { status: 400 }
      );
    }

    const uw =
      typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;

    const challenges = await challengeUnderwriting(uw, {
      deal,
      market,
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
