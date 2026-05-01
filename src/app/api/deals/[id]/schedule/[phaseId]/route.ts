import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { detectCycle } from "@/lib/dev-schedule-compute";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * PATCH /api/deals/[id]/schedule/[phaseId]
 *
 * Update one schedule item. Allowlisted columns only — see
 * devPhaseQueries.updateInDeal for the set. Same deal-scoped query
 * pattern as the rest of the unified API: the row's deal_id must
 * match the URL's deal id, otherwise 404.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();

    // Cycle check on predecessor changes — same as the legacy dev-schedule
    // route. We compute against the full set of phases for the deal so
    // cross-track dependencies (Acq closing → Dev pre-dev) still validate.
    if (body.predecessor_id) {
      const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
      if (detectCycle(phases, params.phaseId, body.predecessor_id)) {
        return NextResponse.json(
          { error: "Cannot set predecessor: would create a cycle in the dependency graph." },
          { status: 400 }
        );
      }
    }

    const updated = await devPhaseQueries.updateInDeal(params.phaseId, params.id, body);
    if (!updated) {
      return NextResponse.json({ error: "Schedule item not found or no updates" }, { status: 404 });
    }

    // Recompute is wrapped in its own try/catch so a CPM failure
    // doesn't surface as "your edit didn't land" — the user's change
    // already committed; CPM fields just stay stale.
    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("PATCH /api/deals/[id]/schedule/[phaseId] recompute error:", err);
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/schedule/[phaseId] error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to update schedule item", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/deals/[id]/schedule/[phaseId]
 *
 * Remove one schedule item. Predecessor and parent links pointing at
 * this row get cleared first so orphaned children float up to the top
 * level — the analyst can then decide whether to keep or remove them.
 * Mirrors the behavior of the legacy /dev-schedule/[phaseId] DELETE.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const target = phases.find((p) => p.id === params.phaseId);
    if (!target) {
      return NextResponse.json({ error: "Schedule item not found" }, { status: 404 });
    }
    for (const p of phases) {
      if (p.predecessor_id === params.phaseId) {
        await devPhaseQueries.updateInDeal(p.id, params.id, { predecessor_id: null });
      }
      if (p.parent_phase_id === params.phaseId) {
        await devPhaseQueries.updateInDeal(p.id, params.id, { parent_phase_id: null });
      }
    }

    await devPhaseQueries.deleteInDeal(params.phaseId, params.id);

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("DELETE /api/deals/[id]/schedule/[phaseId] recompute error:", err);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/schedule/[phaseId] error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to delete schedule item", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
