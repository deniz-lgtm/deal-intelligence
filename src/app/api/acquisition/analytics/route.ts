import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Pipeline analytics. All metrics scoped to deals the caller can see
// (owner OR shared) and to a configurable rolling window.
//
// Returns:
//   - funnel:       count by status across visible deals
//   - conversions:  pct moving from each stage to the next
//   - timeInStage:  median days a deal spent in each stage (closed
//                   intervals only — open ones are not yet "complete")
//   - deadReasons:  count by dead_reason for deals killed in the window
//   - sourcedTrend: weekly count of new deals (sourced) in the window

const STAGES = [
  "sourcing",
  "screening",
  "loi",
  "under_contract",
  "diligence",
  "closing",
  "closed",
] as const;

export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { searchParams } = new URL(req.url);
  const months = Math.max(1, Math.min(60, parseInt(searchParams.get("months") || "12", 10) || 12));
  const sinceClause = `AND h.changed_at >= NOW() - INTERVAL '${months} months'`;

  const pool = getPool();

  // Visible deals (owner OR shared)
  const visibleDealsCte = `
    visible_deals AS (
      SELECT DISTINCT d.id, d.created_at, d.status, d.dead_reason
      FROM deals d
      LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
      WHERE d.owner_id = $1 OR ds.deal_id IS NOT NULL
    )
  `;

  // Funnel: every visible deal that EVER reached each stage in the window.
  // Uses status_history so a deal that closed last month still counts toward
  // 'closing' even though its current status is 'closed'.
  const funnelRes = await pool.query(
    `WITH ${visibleDealsCte}
     SELECT h.to_status AS status, COUNT(DISTINCT h.deal_id)::int AS count
     FROM deal_status_history h
     JOIN visible_deals vd ON vd.id = h.deal_id
     WHERE 1=1 ${sinceClause}
     GROUP BY h.to_status`,
    [userId]
  );
  const funnelMap: Record<string, number> = {};
  for (const r of funnelRes.rows) funnelMap[r.status] = Number(r.count);
  const funnel = STAGES.map((s) => ({ status: s, count: funnelMap[s] ?? 0 }));

  // Time-in-stage: for every transition out of a stage, the days spent.
  // Window paired transitions: each (from_status, changed_at) row pairs
  // with the previous transition for the same deal. Median per from_status.
  const tisRes = await pool.query(
    `WITH ${visibleDealsCte},
     transitions AS (
       SELECT
         h.deal_id,
         h.from_status,
         h.to_status,
         h.changed_at,
         LAG(h.changed_at) OVER (PARTITION BY h.deal_id ORDER BY h.changed_at) AS prev_at
       FROM deal_status_history h
       JOIN visible_deals vd ON vd.id = h.deal_id
       WHERE 1=1 ${sinceClause}
     )
     SELECT
       from_status AS status,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (changed_at - prev_at)) / 86400.0) AS median_days,
       COUNT(*)::int AS samples
     FROM transitions
     WHERE prev_at IS NOT NULL AND from_status IS NOT NULL
     GROUP BY from_status`,
    [userId]
  );
  const tisMap: Record<string, { median_days: number; samples: number }> = {};
  for (const r of tisRes.rows) {
    tisMap[r.status] = { median_days: Number(r.median_days) || 0, samples: r.samples };
  }
  const timeInStage = STAGES.slice(0, -1).map((s) => ({
    status: s,
    median_days: Math.round(tisMap[s]?.median_days ?? 0),
    samples: tisMap[s]?.samples ?? 0,
  }));

  // Dead reason breakdown
  const deadRes = await pool.query(
    `WITH ${visibleDealsCte}
     SELECT
       COALESCE(d.dead_reason, 'unspecified') AS reason,
       COUNT(*)::int AS count
     FROM visible_deals d
     WHERE d.status = 'dead'
     GROUP BY COALESCE(d.dead_reason, 'unspecified')
     ORDER BY count DESC`,
    [userId]
  );

  // Sourced trend (weekly buckets across the window)
  const trendRes = await pool.query(
    `WITH ${visibleDealsCte}
     SELECT
       date_trunc('week', d.created_at) AS week,
       COUNT(*)::int AS count
     FROM visible_deals d
     WHERE d.created_at >= NOW() - INTERVAL '${months} months'
     GROUP BY 1
     ORDER BY 1`,
    [userId]
  );

  // Conversion %: count of (deals that hit each stage) / (deals that hit the prior stage).
  // Uses funnel as the denominator. Skips when prior count == 0 to avoid division by zero.
  const conversions = STAGES.slice(1).map((s, i) => {
    const fromStage = STAGES[i];
    const fromCount = funnelMap[fromStage] ?? 0;
    const toCount = funnelMap[s] ?? 0;
    return {
      from: fromStage,
      to: s,
      pct: fromCount > 0 ? (toCount / fromCount) * 100 : null,
    };
  });

  return NextResponse.json({
    data: {
      window_months: months,
      funnel,
      conversions,
      time_in_stage: timeInStage,
      dead_reasons: deadRes.rows,
      sourced_trend: trendRes.rows.map((r: { week: string; count: number }) => ({
        week: r.week,
        count: Number(r.count),
      })),
    },
  });
}
