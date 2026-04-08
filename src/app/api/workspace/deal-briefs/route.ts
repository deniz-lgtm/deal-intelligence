import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/deal-briefs?limit=5
 *
 * Returns a compact brief of the user's N most-recently-touched active deals,
 * one line per deal: name, stage, last-updated, top open task (if any),
 * uw_score or om_score. Powers the "Deal Briefs" card in the Today strip.
 *
 * Excludes dead / closed / archived deals — we want what's in-flight.
 */
export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(20, Number(limitParam) || 5));

  const pool = getPool();

  const accessibleDeals = `(
    SELECT DISTINCT d.id FROM deals d
    LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
    WHERE d.owner_id IS NULL OR d.owner_id = $1 OR ds.deal_id IS NOT NULL
  )`;

  try {
    // Most recently touched in-flight deals.
    const dealsRes = await pool.query(
      `SELECT d.id, d.name, d.city, d.state, d.status,
              d.asking_price, d.om_score, d.uw_score, d.updated_at
       FROM deals d
       WHERE d.id IN ${accessibleDeals}
         AND d.status NOT IN ('dead', 'closed', 'archived')
       ORDER BY d.updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    if (dealsRes.rows.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const dealIds = dealsRes.rows.map((r: { id: string }) => r.id);

    // Top open task per deal (soonest due date, highest priority wins ties).
    const tasksRes = await pool.query(
      `SELECT DISTINCT ON (t.deal_id) t.deal_id, t.title, t.due_date, t.priority
       FROM deal_tasks t
       WHERE t.deal_id = ANY($1::text[])
         AND t.status NOT IN ('done')
       ORDER BY t.deal_id,
                CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
                t.due_date ASC,
                CASE t.priority
                  WHEN 'critical' THEN 0
                  WHEN 'high' THEN 1
                  WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3
                  ELSE 4
                END ASC`,
      [dealIds]
    );

    type TaskRow = {
      deal_id: string;
      title: string;
      due_date: string | null;
      priority: string | null;
    };
    const topTaskByDeal: Record<string, TaskRow> = {};
    for (const row of tasksRes.rows as TaskRow[]) {
      topTaskByDeal[row.deal_id] = row;
    }

    type DealRow = {
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      status: string;
      asking_price: number | null;
      om_score: number | null;
      uw_score: number | null;
      updated_at: string;
    };

    const briefs = (dealsRes.rows as DealRow[]).map((d) => ({
      id: d.id,
      name: d.name,
      city: d.city,
      state: d.state,
      status: d.status,
      asking_price: d.asking_price,
      om_score: d.om_score,
      uw_score: d.uw_score,
      updated_at: d.updated_at,
      next_task: topTaskByDeal[d.id]
        ? {
            title: topTaskByDeal[d.id].title,
            due_date: topTaskByDeal[d.id].due_date,
            priority: topTaskByDeal[d.id].priority,
          }
        : null,
    }));

    return NextResponse.json({ data: briefs });
  } catch (error) {
    console.error("GET /api/workspace/deal-briefs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch deal briefs" },
      { status: 500 }
    );
  }
}
