import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import {
  phaseKeyForMilestone,
  phaseToMilestoneShape,
  resolveLegacyPhase,
} from "@/lib/legacy-schedule-compat";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * Compat wrappers around the unified schedule API. The URL
 * [milestoneId] is resolved against deal_dev_phases by id directly
 * (for new rows) or by source_legacy_id (for migrated legacy rows
 * the UI cached before #154). Either way the row must belong to the
 * deal in the URL — that constraint comes from resolveLegacyPhase.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; milestoneId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const phase = await resolveLegacyPhase(params.id, params.milestoneId, "milestone");
    if (!phase) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string") updates.label = body.title;
    if ("stage" in body) updates.phase_key = phaseKeyForMilestone(body.stage);
    if ("target_date" in body) {
      // Keep start_date and end_date in lockstep — milestones are
      // point-in-time and the CPM compute uses end_date as the anchor.
      updates.start_date = body.target_date;
      updates.end_date = body.target_date;
    }
    if ("completed_at" in body) {
      updates.completed_at = body.completed_at;
      // Mirror status when the legacy caller flips completed_at on/off
      // so the kanban and the new schedule view agree.
      updates.status = body.completed_at ? "complete" : "not_started";
    }
    if (typeof body.sort_order === "number") updates.sort_order = body.sort_order;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
    }

    const updated = await devPhaseQueries.updateInDeal(phase.id, params.id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("PATCH /api/deals/[id]/milestones/[milestoneId] recompute error:", err);
    }

    return NextResponse.json({ data: phaseToMilestoneShape(updated as DevPhase) });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/milestones/[milestoneId] error:", error);
    return NextResponse.json({ error: "Failed to update milestone" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; milestoneId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const phase = await resolveLegacyPhase(params.id, params.milestoneId, "milestone");
    if (!phase) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    // Clear children pointing at this milestone before deleting so they
    // don't dangle. Tasks migrated from the legacy table point to the
    // milestone via parent_phase_id.
    const peers = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    for (const p of peers) {
      if (p.parent_phase_id === phase.id) {
        await devPhaseQueries.updateInDeal(p.id, params.id, { parent_phase_id: null });
      }
      if (p.predecessor_id === phase.id) {
        await devPhaseQueries.updateInDeal(p.id, params.id, { predecessor_id: null });
      }
    }

    await devPhaseQueries.deleteInDeal(phase.id, params.id);

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("DELETE /api/deals/[id]/milestones/[milestoneId] recompute error:", err);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/milestones/[milestoneId] error:", error);
    return NextResponse.json({ error: "Failed to delete milestone" }, { status: 500 });
  }
}
