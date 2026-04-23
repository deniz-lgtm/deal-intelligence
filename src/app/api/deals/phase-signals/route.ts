import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Returns a per-deal map of boolean signals used by phase-classification.ts.
// A single round-trip — each signal is one LEFT JOIN + EXISTS-style aggregate
// so the home page doesn't fan out N queries for the triptych panels.

export const dynamic = "force-dynamic";

interface Signals {
  has_ceqa: boolean;
  has_programming: boolean;
  has_predev_costs: boolean;
  has_hardcost_items: boolean;
  has_draws: boolean;
  has_permits: boolean;
  has_vendors: boolean;
  has_progress_reports: boolean;
}

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const pool = getPool();

  // One aggregated query keyed by deal_id. LEFT JOIN LATERAL avoids row
  // multiplication that a naive join-and-group would introduce, and keeps
  // each subquery's cost bounded to that deal's rows.
  const sql = `
    SELECT
      d.id,
      (d.ceqa_data IS NOT NULL AND d.ceqa_data::text <> '{}'::text
         AND d.ceqa_data::text <> 'null')                              AS has_ceqa,
      EXISTS (SELECT 1 FROM underwriting_per_massing upm WHERE upm.deal_id = d.id) AS has_programming,
      EXISTS (SELECT 1 FROM deal_predev_costs     x WHERE x.deal_id = d.id) AS has_predev_costs,
      EXISTS (SELECT 1 FROM deal_hardcost_items   x WHERE x.deal_id = d.id) AS has_hardcost_items,
      EXISTS (SELECT 1 FROM deal_draws            x WHERE x.deal_id = d.id) AS has_draws,
      EXISTS (SELECT 1 FROM deal_permits          x WHERE x.deal_id = d.id) AS has_permits,
      EXISTS (SELECT 1 FROM deal_vendors          x WHERE x.deal_id = d.id) AS has_vendors,
      EXISTS (SELECT 1 FROM progress_reports      x WHERE x.deal_id = d.id) AS has_progress_reports
    FROM deals d
    LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
    WHERE d.owner_id = $1 OR ds.deal_id IS NOT NULL
  `;

  try {
    const res = await pool.query(sql, [userId]);
    const out: Record<string, Signals> = {};
    for (const row of res.rows) {
      out[row.id] = {
        has_ceqa: !!row.has_ceqa,
        has_programming: !!row.has_programming,
        has_predev_costs: !!row.has_predev_costs,
        has_hardcost_items: !!row.has_hardcost_items,
        has_draws: !!row.has_draws,
        has_permits: !!row.has_permits,
        has_vendors: !!row.has_vendors,
        has_progress_reports: !!row.has_progress_reports,
      };
    }
    return NextResponse.json({ data: out });
  } catch (error) {
    console.error("GET /api/deals/phase-signals error:", error);
    return NextResponse.json({ error: "Failed to load phase signals" }, { status: 500 });
  }
}
