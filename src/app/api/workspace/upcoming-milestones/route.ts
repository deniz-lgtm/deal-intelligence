import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/upcoming-milestones?days=14
 *
 * Returns milestones + tasks + multi-day phases ending in the next N
 * days across all deals the signed-in user has access to. Powers the
 * "Upcoming" card in the Today strip on the root landing page.
 *
 * Reads exclusively from `deal_dev_phases` now that the legacy
 * `deal_milestones` and `deal_tasks` rows have been migrated in
 * (see the ensureColumns migration). Reading from one table also
 * eliminates the de-dup problem we'd otherwise have during the
 * transition window: legacy rows + their migrated counterparts would
 * both surface from a unioned read.
 */
export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.max(1, Math.min(90, Number(daysParam) || 14));

  const pool = getPool();

  // Reuses the same accessible-deals pattern as /api/activity.
  const accessibleDeals = `(
    SELECT DISTINCT d.id FROM deals d
    LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
    WHERE d.owner_id = $1 OR ds.deal_id IS NOT NULL
  )`;

  try {
    // Single source of truth: every schedule item — phase, milestone,
    // or task — lives on deal_dev_phases. We surface anything ending
    // in the window that isn't yet complete, ordered by the closest
    // due date so the analyst sees what's about to land first.
    //
    // task_owner is the right "assignee" surface here — for migrated
    // legacy tasks it carries the assignee free-text, and for ad-hoc
    // schedule rows it's the optional owner the user set in the Gantt.
    const phaseRows = await pool.query(
      `SELECT p.id, p.deal_id, d.name as deal_name, d.status as deal_status,
              p.label as title, p.end_date, p.start_date, p.pct_complete,
              p.status as phase_status, p.is_milestone, p.kind, p.track,
              p.task_owner
       FROM deal_dev_phases p
       JOIN deals d ON d.id = p.deal_id
       WHERE p.deal_id IN ${accessibleDeals}
         AND p.end_date IS NOT NULL
         AND p.end_date <= CURRENT_DATE + ($2 || ' days')::interval
         AND COALESCE(p.pct_complete, 0) < 100
         AND COALESCE(p.status, 'not_started') <> 'complete'
       ORDER BY p.end_date ASC
       LIMIT 75`,
      [userId, String(days)]
    );

    type Row = {
      id: string;
      deal_id: string;
      deal_name: string;
      deal_status: string;
      title: string;
      end_date: string | null;
      start_date: string | null;
      pct_complete: number | null;
      phase_status: string | null;
      is_milestone: boolean | null;
      kind: "phase" | "milestone" | "task" | null;
      track: string | null;
      task_owner: string | null;
    };

    // Map every row to the same shape the Today strip already
    // consumes. `kind` becomes the row classifier so the UI can
    // distinguish a milestone glyph from a phase bar from a task
    // checkbox without inferring from is_milestone alone.
    const items = phaseRows.rows.map((r: Row) => {
      const resolvedKind: "milestone" | "task" | "phase" =
        r.kind === "task"
          ? "task"
          : r.kind === "milestone" || r.is_milestone
            ? "milestone"
            : "phase";
      return {
        kind: resolvedKind,
        id: r.id,
        deal_id: r.deal_id,
        deal_name: r.deal_name,
        deal_status: r.deal_status,
        title: r.title,
        due_date: r.end_date,
        // Priority isn't tracked on the unified model; the unified
        // model uses sort_order + critical-path for ordering instead.
        priority: null as string | null,
        assignee: r.task_owner ?? null,
        // Track tag lets the UI color-code Acq vs Dev vs Construction.
        track: r.track ?? null,
      };
    });

    return NextResponse.json({ data: items, window_days: days });
  } catch (error) {
    console.error("GET /api/workspace/upcoming-milestones error:", error);
    return NextResponse.json(
      { error: "Failed to fetch upcoming milestones" },
      { status: 500 }
    );
  }
}
