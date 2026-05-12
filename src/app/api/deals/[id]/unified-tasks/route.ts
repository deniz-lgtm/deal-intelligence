import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { TASK_KINDS, type DevPhase, type DevPhaseKind } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Unified Tasks API. Reads/writes the task-shaped rows on
 * deal_dev_phases — kinds 'task' | 'general' | 'diligence' | 'decision'.
 * Schedule rows (kind='phase' | 'milestone') stay on the schedule API
 * even though they live in the same table.
 *
 * Query params:
 *   ?kind=diligence,decision   Filter to specific kinds
 *   ?status=open               Maps to status<>'complete' for "open" tasks
 *   ?include_scheduled=1       Include kind='phase'/'milestone' rows too
 */

const TASK_KIND_SET = new Set<DevPhaseKind>(TASK_KINDS);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const url = new URL(req.url);
    const kindParam = url.searchParams.get("kind");
    const includeScheduled = url.searchParams.get("include_scheduled") === "1";

    const requestedKinds = kindParam
      ? (kindParam.split(",").map((k) => k.trim()).filter(Boolean) as DevPhaseKind[])
      : null;

    const all = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const filtered = all.filter((p) => {
      if (requestedKinds) return requestedKinds.includes((p.kind ?? "task") as DevPhaseKind);
      // Default: just task-shaped rows.
      if (includeScheduled) return true;
      const k = (p.kind ?? "task") as DevPhaseKind;
      return TASK_KIND_SET.has(k);
    });

    return NextResponse.json({ data: filtered });
  } catch (error) {
    console.error("GET /api/deals/[id]/unified-tasks error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const kind: DevPhaseKind = TASK_KIND_SET.has(body.kind) ? body.kind : "general";
    const status = typeof body.status === "string" ? body.status : "not_started";
    const dueDate = typeof body.due_date === "string" && body.due_date ? body.due_date : null;
    // Tasks that arrive with only a due_date stay un-scheduled (no
    // start_date) so the schedule gantt doesn't pick them up. When the
    // caller wants the task on the timeline they pass start_date too —
    // see the "convert to scheduled task" action.
    const startDate = typeof body.start_date === "string" && body.start_date ? body.start_date : null;

    const phase = await devPhaseQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      track: body.track ?? "development",
      kind,
      phase_key: `${kind}_${Date.now().toString(36)}`,
      label: title,
      description: typeof body.description === "string" ? body.description : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      priority: typeof body.priority === "string" ? body.priority : null,
      assignee_user_id: typeof body.assignee_user_id === "string" ? body.assignee_user_id : null,
      task_owner: typeof body.task_owner === "string" ? body.task_owner : null,
      task_category: typeof body.task_category === "string" ? body.task_category : null,
      start_date: startDate,
      end_date: dueDate ?? startDate,
      duration_days: startDate && dueDate ? null : 1,
      status,
      parent_phase_id: typeof body.parent_phase_id === "string" ? body.parent_phase_id : null,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      is_milestone: false,
      decision_options: Array.isArray(body.decision_options) ? body.decision_options : null,
      decision_choice: typeof body.decision_choice === "string" ? body.decision_choice : null,
    });

    return NextResponse.json({ data: phase });
  } catch (error) {
    console.error("POST /api/deals/[id]/unified-tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

// Bulk PATCH for sort_order updates (drag-reorder).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const orderUpdates: { id: string; sort_order: number }[] = Array.isArray(body.order) ? body.order : [];
    if (orderUpdates.length === 0) {
      return NextResponse.json({ data: { updated: 0 } });
    }

    const pool = getPool();
    for (const u of orderUpdates) {
      await pool.query(
        `UPDATE deal_dev_phases SET sort_order = $1, updated_at = NOW()
         WHERE id = $2 AND deal_id = $3 AND deleted_at IS NULL`,
        [u.sort_order, u.id, params.id],
      );
    }
    return NextResponse.json({ data: { updated: orderUpdates.length } });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/unified-tasks error:", error);
    return NextResponse.json({ error: "Failed to reorder tasks" }, { status: 500 });
  }
}
