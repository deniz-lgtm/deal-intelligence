import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Portfolio-level rollup of hard-cost variance across every construction-phase
// deal the caller can see. EAC matches the per-line logic in HardCostBudget.tsx:
//   incurred/paid → amount + COALESCE(etc, 0)
//   estimated/committed → COALESCE(etc, amount)
// Variance = EAC - amount (budgeted). Positive = forecast overrun.

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const pool = getPool();
  const res = await pool.query(
    `WITH visible_deals AS (
       SELECT DISTINCT d.id, d.name
       FROM deals d
       LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
       WHERE (d.owner_id = $1 OR ds.deal_id IS NOT NULL)
         AND (d.show_in_construction = true OR d.current_phase IN ('construction', 'multi'))
     ),
     line_calc AS (
       SELECT
         h.deal_id,
         h.amount,
         CASE
           WHEN h.status IN ('incurred', 'paid') THEN h.amount + COALESCE(h.etc, 0)
           ELSE COALESCE(h.etc, h.amount)
         END AS eac,
         CASE WHEN h.status IN ('incurred', 'paid') THEN h.amount ELSE 0 END AS incurred
       FROM deal_hardcost_items h
       WHERE h.deal_id IN (SELECT id FROM visible_deals)
     )
     SELECT
       v.id AS deal_id,
       v.name AS deal_name,
       COALESCE(SUM(lc.amount), 0)::numeric AS total_budget,
       COALESCE(SUM(lc.eac), 0)::numeric AS total_eac,
       COALESCE(SUM(lc.incurred), 0)::numeric AS total_incurred,
       (COALESCE(SUM(lc.eac), 0) - COALESCE(SUM(lc.amount), 0))::numeric AS variance,
       COUNT(lc.*)::int AS line_count
     FROM visible_deals v
     LEFT JOIN line_calc lc ON lc.deal_id = v.id
     GROUP BY v.id, v.name
     HAVING COUNT(lc.*) > 0
     ORDER BY ABS(COALESCE(SUM(lc.eac), 0) - COALESCE(SUM(lc.amount), 0)) DESC, v.name`,
    [userId]
  );

  return NextResponse.json({ data: res.rows });
}
