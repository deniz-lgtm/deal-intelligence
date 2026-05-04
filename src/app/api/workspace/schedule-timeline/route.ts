import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/schedule-timeline?weeks=12
 *
 * Powers the home-page Schedule hero. For each live deal the user can
 * access, returns the deal_dev_phases rows whose date range overlaps a
 * window starting today and extending `weeks` weeks forward. Default
 * 12 weeks; clamped to [1, 104].
 *
 * "Live" excludes terminal stages (dead, archived) — those deals don't
 * need a place on the timeline.
 *
 * One round-trip joining deals to deal_dev_phases. The Today strip's
 * upcoming-milestones endpoint reads similarly but only surfaces
 * end-date hits; this one returns phase ranges so the UI can render
 * proper bars across the window.
 */
export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  const weeksParam = req.nextUrl.searchParams.get("weeks");
  const weeks = Math.max(1, Math.min(104, Number(weeksParam) || 12));
  const days = weeks * 7;

  const pool = getPool();

  try {
    // Two queries because the deal list and the phase list both benefit
    // from being kept compact — the alternative (one big LEFT JOIN
    // returning row-multiplied results) would balloon payload size on
    // deals with many phases.
    const dealsRes = await pool.query(
      `SELECT DISTINCT d.id, d.name, d.status, d.city, d.state,
              d.show_in_development, d.show_in_construction,
              d.updated_at
         FROM deals d
         LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
        WHERE (d.owner_id = $1 OR ds.deal_id IS NOT NULL)
          AND d.status NOT IN ('dead', 'archived')
        ORDER BY d.updated_at DESC`,
      [userId]
    );

    const dealIds = dealsRes.rows.map((r: { id: string }) => r.id);
    if (dealIds.length === 0) {
      return NextResponse.json({ data: { deals: [], phases: [] }, window_days: days });
    }

    // Phase overlap rule: a phase belongs in the window iff its
    // [start_date, end_date] intersects [today, today + days]. Rows
    // missing dates fall through (CPM hasn't run yet) — surface them
    // anyway with start = end = today + 1 so they at least appear as
    // small markers.
    const phasesRes = await pool.query(
      `SELECT id, deal_id, kind, track, label, phase_key,
              start_date, end_date, pct_complete, status,
              is_milestone, parent_phase_id, sort_order
         FROM deal_dev_phases
        WHERE deal_id = ANY($1::text[])
          AND COALESCE(status, 'not_started') <> 'complete'
          AND (
                end_date IS NULL OR
                (end_date >= CURRENT_DATE AND
                 COALESCE(start_date, end_date) <= CURRENT_DATE + ($2 || ' days')::interval)
              )
        ORDER BY deal_id, sort_order, start_date NULLS LAST`,
      [dealIds, String(days)]
    );

    return NextResponse.json({
      data: {
        deals: dealsRes.rows,
        phases: phasesRes.rows,
      },
      window_days: days,
    });
  } catch (error) {
    console.error("GET /api/workspace/schedule-timeline error:", error);
    return NextResponse.json(
      { error: "Failed to load schedule timeline" },
      { status: 500 }
    );
  }
}
