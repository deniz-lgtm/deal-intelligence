import { NextResponse } from "next/server";
import { getPool, dealQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Cross-deal due task feed. Reads task-shaped rows on deal_dev_phases
 * (kinds task | diligence | decision | general) that are not yet
 * complete and either past due or due within the next 14 days.
 *
 * Replaces the older /api/home/decisions-due now that decisions live
 * on the unified tasks model.
 */

interface DueRow {
  id: string;
  deal_id: string;
  deal_name: string;
  title: string;
  due_date: string | null;
  status: string;
  kind: string;
  priority: string | null;
  assignee_user_id: string | null;
}

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const accessible = await dealQueries.getAll(userId);
    if (accessible.length === 0) {
      return NextResponse.json({ data: [] });
    }
    const ids = accessible.map((d) => d.id);
    const pool = getPool();

    const res = await pool.query<DueRow>(
      `SELECT
         p.id,
         p.deal_id,
         deals.name AS deal_name,
         p.label AS title,
         p.end_date::text AS due_date,
         p.status,
         COALESCE(p.kind, 'task') AS kind,
         p.priority,
         p.assignee_user_id
       FROM deal_dev_phases p
       JOIN deals ON deals.id = p.deal_id
       WHERE p.deal_id = ANY($1::text[])
         AND p.deleted_at IS NULL
         AND p.status <> 'complete'
         AND COALESCE(p.kind, 'task') IN ('task','diligence','decision','general')
         AND (p.end_date IS NULL OR p.end_date <= (CURRENT_DATE + INTERVAL '14 days'))
       ORDER BY p.end_date ASC NULLS LAST, p.created_at ASC
       LIMIT 100`,
      [ids],
    );

    return NextResponse.json({ data: res.rows });
  } catch (error) {
    console.error("GET /api/home/tasks-due error:", error);
    return NextResponse.json({ error: "Failed to load due tasks" }, { status: 500 });
  }
}
