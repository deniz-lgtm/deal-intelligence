import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const pool = getPool();
    const res = await pool.query(
      `SELECT DISTINCT d.*,
        COALESCE(hc.total_budget, 0) AS hardcost_total_budget,
        COALESCE(hc.total_committed, 0) AS hardcost_total_committed,
        COALESCE(hc.total_paid, 0) AS hardcost_total_paid,
        COALESCE(dr.total_drawn, 0) AS total_drawn,
        COALESCE(dr.draw_count, 0) AS draw_count,
        COALESCE(pm.permit_count, 0) AS permit_count,
        COALESCE(pm.permits_approved, 0) AS permits_approved
       FROM deals d
       LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
       LEFT JOIN LATERAL (
         SELECT
           SUM(amount) AS total_budget,
           SUM(CASE WHEN status IN ('committed','incurred','paid') THEN amount ELSE 0 END) AS total_committed,
           SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS total_paid
         FROM deal_hardcost_items WHERE deal_id = d.id
       ) hc ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS draw_count,
           SUM(CASE WHEN status = 'funded' THEN COALESCE(amount_approved, amount_requested) ELSE 0 END) AS total_drawn
         FROM deal_draws WHERE deal_id = d.id
       ) dr ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS permit_count,
           SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)::int AS permits_approved
         FROM deal_permits WHERE deal_id = d.id
       ) pm ON true
       WHERE d.execution_phase IS NOT NULL
         AND (d.owner_id = $1 OR ds.deal_id IS NOT NULL)
       ORDER BY d.updated_at DESC`,
      [userId]
    );

    return NextResponse.json({ data: res.rows });
  } catch (error) {
    console.error("GET /api/execution error:", error);
    // Tables may not exist yet — return empty
    return NextResponse.json({ data: [] });
  }
}
