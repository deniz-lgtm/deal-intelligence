import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/upcoming-milestones?days=14
 *
 * Returns milestones + tasks due in the next N days across all deals the
 * signed-in user has access to. Powers the "Upcoming" card in the Today
 * strip on the root landing page.
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
    const [milestoneRows, taskRows, phaseRows] = await Promise.all([
      pool.query(
        `SELECT m.id, m.deal_id, d.name as deal_name, d.status as deal_status,
                m.title, m.target_date, m.completed_at
         FROM deal_milestones m
         JOIN deals d ON d.id = m.deal_id
         WHERE m.deal_id IN ${accessibleDeals}
           AND m.completed_at IS NULL
           AND m.target_date IS NOT NULL
           AND m.target_date <= CURRENT_DATE + ($2 || ' days')::interval
         ORDER BY m.target_date ASC
         LIMIT 25`,
        [userId, String(days)]
      ),
      pool.query(
        `SELECT t.id, t.deal_id, d.name as deal_name, d.status as deal_status,
                t.title, t.due_date, t.priority, t.status, t.assignee
         FROM deal_tasks t
         JOIN deals d ON d.id = t.deal_id
         WHERE t.deal_id IN ${accessibleDeals}
           AND t.status NOT IN ('done')
           AND t.due_date IS NOT NULL
           AND t.due_date <= CURRENT_DATE + ($2 || ' days')::interval
         ORDER BY t.due_date ASC, t.priority DESC
         LIMIT 25`,
        [userId, String(days)]
      ),
      // Schedule phases (Acq / Dev / Construction). The "due" date for a
      // phase is its end_date — when the deliverable lands. We surface
      // anything ending in the window and not already 100% complete, so
      // analyst-imported LOI / GC schedule milestones land in the same
      // place as ad-hoc tasks.
      pool.query(
        `SELECT p.id, p.deal_id, d.name as deal_name, d.status as deal_status,
                p.label as title, p.end_date, p.start_date, p.pct_complete,
                p.status as phase_status, p.is_milestone, p.track
         FROM deal_dev_phases p
         JOIN deals d ON d.id = p.deal_id
         WHERE p.deal_id IN ${accessibleDeals}
           AND p.end_date IS NOT NULL
           AND p.end_date <= CURRENT_DATE + ($2 || ' days')::interval
           AND COALESCE(p.pct_complete, 0) < 100
           AND COALESCE(p.status, 'not_started') <> 'complete'
         ORDER BY p.end_date ASC
         LIMIT 25`,
        [userId, String(days)]
      ),
    ]);

    type Row = {
      id: string;
      deal_id: string;
      deal_name: string;
      deal_status: string;
      title: string;
      target_date?: string;
      due_date?: string;
      end_date?: string;
      start_date?: string;
      priority?: string;
      completed_at?: string | null;
      assignee?: string | null;
      status?: string;
      phase_status?: string;
      is_milestone?: boolean;
      pct_complete?: number;
      track?: string;
    };

    const items = [
      ...milestoneRows.rows.map((r: Row) => ({
        kind: "milestone" as const,
        id: r.id,
        deal_id: r.deal_id,
        deal_name: r.deal_name,
        deal_status: r.deal_status,
        title: r.title,
        due_date: r.target_date,
        priority: null as string | null,
        assignee: null as string | null,
        track: null as string | null,
      })),
      ...taskRows.rows.map((r: Row) => ({
        kind: "task" as const,
        id: r.id,
        deal_id: r.deal_id,
        deal_name: r.deal_name,
        deal_status: r.deal_status,
        title: r.title,
        due_date: r.due_date,
        priority: r.priority ?? null,
        assignee: r.assignee ?? null,
        track: null as string | null,
      })),
      ...phaseRows.rows.map((r: Row) => ({
        // is_milestone phases (Closing, LOI Signed) render with the
        // milestone glyph; multi-day phases (Diligence, Escrow) get
        // the phase glyph so the user can tell apart at a glance.
        kind: r.is_milestone ? ("milestone" as const) : ("phase" as const),
        id: r.id,
        deal_id: r.deal_id,
        deal_name: r.deal_name,
        deal_status: r.deal_status,
        title: r.title,
        due_date: r.end_date,
        priority: null as string | null,
        assignee: null as string | null,
        // Track tag lets the UI color-code Acq vs Dev vs Construction.
        track: r.track ?? null,
      })),
    ].sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : 0;
      const bd = b.due_date ? new Date(b.due_date).getTime() : 0;
      return ad - bd;
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
