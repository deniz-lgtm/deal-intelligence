import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { dealQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Decisions and draws coming due across every deal the user can see.
// Drives the "Decisions due" strip on the Command Center.
//
// Horizon: items already overdue + everything in the next 14 days.

interface DueRow {
  kind: "decision" | "draw";
  id: string;
  deal_id: string;
  deal_name: string;
  title: string;
  due_date: string | null;
  status: string | null;
  assigned_to: string | null;
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

    const decisions = await pool.query<DueRow>(
      `SELECT
         'decision'::text AS kind,
         d.id,
         d.deal_id,
         deals.name AS deal_name,
         d.title,
         d.due_date::text AS due_date,
         d.status,
         d.assigned_to
       FROM deal_decisions d
       JOIN deals ON deals.id = d.deal_id
       WHERE d.deal_id = ANY($1::text[])
         AND d.status = 'open'
         AND (d.due_date IS NULL OR d.due_date <= (CURRENT_DATE + INTERVAL '14 days'))
       ORDER BY d.due_date ASC NULLS LAST, d.created_at ASC
       LIMIT 50`,
      [ids]
    );

    // Pending draws — surface count per deal as a single row each.
    const draws = await pool.query<{
      deal_id: string;
      deal_name: string;
      pending: number;
    }>(
      `SELECT
         dr.deal_id,
         deals.name AS deal_name,
         COUNT(*)::int AS pending
       FROM deal_draws dr
       JOIN deals ON deals.id = dr.deal_id
       WHERE dr.deal_id = ANY($1::text[])
         AND dr.status = 'submitted'
       GROUP BY dr.deal_id, deals.name
       ORDER BY pending DESC
       LIMIT 20`,
      [ids]
    ).catch(() => ({ rows: [] as Array<{ deal_id: string; deal_name: string; pending: number }> }));

    const drawRows: DueRow[] = draws.rows.map((row) => ({
      kind: "draw",
      id: `draw-${row.deal_id}`,
      deal_id: row.deal_id,
      deal_name: row.deal_name,
      title: `${row.pending} draw${row.pending === 1 ? "" : "s"} pending`,
      due_date: null,
      status: "open",
      assigned_to: null,
    }));

    return NextResponse.json({ data: [...decisions.rows, ...drawRows] });
  } catch (error) {
    console.error("GET /api/home/decisions-due error:", error);
    return NextResponse.json({ error: "Failed to load due items" }, { status: 500 });
  }
}
