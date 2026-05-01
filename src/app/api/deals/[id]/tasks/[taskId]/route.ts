import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import {
  phaseToTaskShape,
  resolveLegacyPhase,
  taskStatusToPhaseStatus,
} from "@/lib/legacy-schedule-compat";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * Compat wrappers around the unified schedule API. URL [taskId] is
 * resolved against deal_dev_phases by id directly OR by source_legacy_id
 * (for tasks the UI cached before #154's migration). Either lookup
 * is constrained to the URL's deal id by resolveLegacyPhase.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const phase = await resolveLegacyPhase(params.id, params.taskId, "task");
    if (!phase) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string") updates.label = body.title;
    if ("description" in body) updates.notes = body.description;
    if ("assignee" in body) updates.task_owner = body.assignee;
    if ("due_date" in body) {
      updates.start_date = body.due_date;
      updates.end_date = body.due_date;
    }
    if ("status" in body) updates.status = taskStatusToPhaseStatus(body.status);
    if ("milestone_id" in body) {
      // Resolve against the unified table the same way POST does.
      let parentPhaseId: string | null = null;
      if (body.milestone_id) {
        const parent = await resolveLegacyPhase(params.id, body.milestone_id, "milestone");
        parentPhaseId = parent?.id ?? null;
      }
      updates.parent_phase_id = parentPhaseId;
    }
    if (typeof body.sort_order === "number") updates.sort_order = body.sort_order;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
    }

    const updated = await devPhaseQueries.updateInDeal(phase.id, params.id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("PATCH /api/deals/[id]/tasks/[taskId] recompute error:", err);
    }

    return NextResponse.json({ data: phaseToTaskShape(updated as DevPhase) });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const phase = await resolveLegacyPhase(params.id, params.taskId, "task");
    if (!phase) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await devPhaseQueries.deleteInDeal(phase.id, params.id);

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("DELETE /api/deals/[id]/tasks/[taskId] recompute error:", err);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
