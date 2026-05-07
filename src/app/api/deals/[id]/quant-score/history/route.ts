import { NextRequest, NextResponse } from "next/server";
import { dealScoreQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/deals/:id/quant-score/history — full timeline of every recompute. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const rows = await dealScoreQueries.getHistory(params.id);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/quant-score/history error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
