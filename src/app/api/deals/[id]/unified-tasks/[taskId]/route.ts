import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM deal_dev_phases WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL`,
      [params.taskId, params.id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ data: res.rows[0] });
  } catch (error) {
    console.error("GET /api/deals/[id]/unified-tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    // Coerce due_date alias → end_date for clarity from the client side.
    if (body.due_date !== undefined && body.end_date === undefined) {
      body.end_date = body.due_date;
      delete body.due_date;
    }
    // "Convert to scheduled task" — when start_date arrives without an
    // explicit end_date we mirror it so the task gets a one-day window
    // on the gantt. The schedule recompute will widen it once the user
    // sets a duration.
    if (body.start_date !== undefined && body.end_date === undefined) {
      body.end_date = body.start_date;
    }

    const updated = await devPhaseQueries.update(params.taskId, body);
    if (!updated) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/unified-tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const pool = getPool();
    const res = await pool.query(
      `UPDATE deal_dev_phases SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL RETURNING id`,
      [params.taskId, params.id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ data: { id: res.rows[0].id } });
  } catch (error) {
    console.error("DELETE /api/deals/[id]/unified-tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
