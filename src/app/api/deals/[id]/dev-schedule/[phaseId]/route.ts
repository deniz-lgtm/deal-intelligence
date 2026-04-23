import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { computeSchedule, diffComputedDates, detectCycle } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

async function recomputeSchedule(dealId: string) {
  const phases = (await devPhaseQueries.getByDealId(dealId)) as DevPhase[];
  const computed = computeSchedule(phases);
  const updates = diffComputedDates(phases, computed);
  if (updates.length > 0) {
    await devPhaseQueries.bulkUpdateSchedule(updates);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();

    // Cycle check: if predecessor_id is being set, ensure it doesn't create a cycle
    if (body.predecessor_id) {
      const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
      if (detectCycle(phases, params.phaseId, body.predecessor_id)) {
        return NextResponse.json(
          { error: "Cannot set predecessor: would create a cycle in the dependency graph." },
          { status: 400 }
        );
      }
    }

    const phase = await devPhaseQueries.update(params.phaseId, body);
    if (!phase) {
      return NextResponse.json({ error: "Phase not found or no updates" }, { status: 404 });
    }

    // Recompute the whole schedule so changes cascade downstream
    await recomputeSchedule(params.id);

    return NextResponse.json({ data: phase });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/dev-schedule/[phaseId] error:", error);
    return NextResponse.json({ error: "Failed to update phase" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    // Clear predecessor links + parent links pointing to this phase
    // before deleting. Orphaned children float up to the top level so
    // the analyst can decide whether to keep or remove them.
    const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    for (const p of phases) {
      if (p.predecessor_id === params.phaseId) {
        await devPhaseQueries.update(p.id, { predecessor_id: null });
      }
      if (p.parent_phase_id === params.phaseId) {
        await devPhaseQueries.update(p.id, { parent_phase_id: null });
      }
    }

    await devPhaseQueries.delete(params.phaseId);

    // Recompute after deletion since downstream phases may need to fall back to anchors
    await recomputeSchedule(params.id);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/dev-schedule/[phaseId] error:", error);
    return NextResponse.json({ error: "Failed to delete phase" }, { status: 500 });
  }
}
