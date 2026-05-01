import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
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
 * Compatibility wrapper around the unified schedule API. Reads/writes
 * deal_dev_phases (kind='task') so new tasks created through the
 * existing UI flow into the unified model and surface in the
 * Today-strip "Upcoming" feed. Response shape stays the legacy
 * DealTask so ProjectManagement.tsx keeps working.
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

    const phases = (await devPhaseQueries.getFiltered({
      deal_id: params.id,
      kind: "task",
    })) as DevPhase[];
    return NextResponse.json({ data: phases.map(phaseToTaskShape) });
  } catch (error) {
    console.error("GET /api/deals/[id]/tasks error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { title, description, assignee, due_date, status, milestone_id, sort_order } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // milestone_id may be either a dev_phase id (rows created via the
    // compat wrapper after this PR) or a legacy milestone id (rows the
    // UI cached pre-migration). Resolve via the compat helper so we
    // store the unified id in parent_phase_id.
    let parentPhaseId: string | null = null;
    if (milestone_id) {
      const parent = await resolveLegacyPhase(params.id, milestone_id, "milestone");
      parentPhaseId = parent?.id ?? null;
    }

    const phase = await devPhaseQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      track: "development",
      kind: "task",
      phase_key: "legacy_task",
      label: title.trim(),
      notes: description || null,
      task_owner: assignee || null,
      // Tasks are single-day by default — start = end = due_date so
      // the CPM compute treats them as a one-day window. duration=1
      // matches the migrated legacy rows.
      start_date: due_date || null,
      end_date: due_date || null,
      duration_days: 1,
      status: taskStatusToPhaseStatus(status),
      parent_phase_id: parentPhaseId,
      sort_order: sort_order ?? 0,
      is_milestone: false,
    });

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("POST /api/deals/[id]/tasks recompute error:", err);
    }

    return NextResponse.json({ data: phaseToTaskShape(phase as DevPhase) });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
