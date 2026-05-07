import { NextRequest, NextResponse } from "next/server";
import { dealScoreQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { recomputeQuantScore } from "@/lib/quant-score/recompute";
import type { Stage } from "@/lib/quant-score/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/quant-score
 *
 * Body: { stage: "om" | "uw" | "final", runMc?: boolean, mcSeed?: number, massing_id?: string }
 *
 * Computes the deterministic factor score, runs Monte Carlo (when stage in
 * {uw, final} and runMc !== false), generates a Claude narrative grounded
 * in both, and persists one row in `deal_scores`.
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

    const body = (await req.json().catch(() => ({}))) as {
      stage?: Stage;
      runMc?: boolean;
      mcSeed?: number;
      massing_id?: string;
    };
    const stage: Stage = body.stage && ["om", "uw", "final"].includes(body.stage) ? body.stage : "uw";

    await recomputeQuantScore(params.id, {
      stage,
      runMc: body.runMc !== false,
      massingId: body.massing_id,
      mcSeed: body.mcSeed,
    });

    // Reload the row we just wrote so the response carries the
    // post-narrative state.
    const row = await dealScoreQueries.getLatest(params.id, stage);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/deals/[id]/quant-score error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to compute quant score: ${message}` },
      { status: 500 }
    );
  }
}

/** GET /api/deals/:id/quant-score?stage=uw — latest row for that stage. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const stageParam = req.nextUrl.searchParams.get("stage");
    const stage: Stage | null =
      stageParam && ["om", "uw", "final"].includes(stageParam) ? (stageParam as Stage) : null;
    if (stage) {
      const row = await dealScoreQueries.getLatest(params.id, stage);
      return NextResponse.json({ data: row });
    }
    const rows = await dealScoreQueries.getLatestAll(params.id);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/quant-score error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
