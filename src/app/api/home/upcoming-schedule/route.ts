import { NextResponse } from "next/server";
import { getPool, dealQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface UpcomingRow {
  id: string;
  deal_id: string;
  deal_name: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  kind: string;
  track: string;
}

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  try {
    const accessible = await dealQueries.getAll(userId);
    if (accessible.length === 0) return NextResponse.json({ data: [] });
    const ids = accessible.map((d) => d.id);

    const pool = getPool();
    const res = await pool.query<UpcomingRow>(
      `SELECT
         p.id,
         p.deal_id,
         deals.name AS deal_name,
         p.label,
         p.start_date::text AS start_date,
         p.end_date::text AS end_date,
         p.status,
         COALESCE(p.kind, 'phase') AS kind,
         p.track
       FROM deal_dev_phases p
       JOIN deals ON deals.id = p.deal_id
       WHERE p.deal_id = ANY($1::text[])
         AND p.deleted_at IS NULL
         AND p.status <> 'complete'
         AND COALESCE(p.kind, 'phase') IN ('phase','milestone')
         AND p.start_date IS NOT NULL
         AND p.start_date <= (CURRENT_DATE + INTERVAL '30 days')
       ORDER BY p.start_date ASC
       LIMIT 50`,
      [ids],
    );

    return NextResponse.json({ data: res.rows });
  } catch (error) {
    console.error("GET /api/home/upcoming-schedule error:", error);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}
