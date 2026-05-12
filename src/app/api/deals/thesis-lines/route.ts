import { NextResponse } from "next/server";
import { dealQueries, getPool } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * One-row-per-deal latest thesis + next open decision. Used by the
 * Command Center to render a thesis line + next-decision chip on every
 * deal row without fanning out N requests.
 */
export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const accessible = await dealQueries.getAll(userId);
    if (accessible.length === 0) return NextResponse.json({ data: {} });
    const ids = accessible.map((d) => d.id);
    const pool = getPool();

    const thesis = await pool.query<{ deal_id: string; text: string }>(
      `SELECT DISTINCT ON (deal_id) deal_id, text
       FROM deal_notes
       WHERE deal_id = ANY($1::text[])
         AND category = 'thesis'
       ORDER BY deal_id, created_at DESC`,
      [ids]
    );

    const decisions = await pool.query<{
      deal_id: string;
      title: string;
      due_date: string | null;
    }>(
      `SELECT DISTINCT ON (deal_id) deal_id, title, due_date::text
       FROM deal_decisions
       WHERE deal_id = ANY($1::text[])
         AND status = 'open'
       ORDER BY deal_id, due_date ASC NULLS LAST, created_at ASC`,
      [ids]
    );

    const result: Record<
      string,
      { thesis: string | null; next_decision: { title: string; due_date: string | null } | null }
    > = {};
    for (const id of ids) {
      result[id] = { thesis: null, next_decision: null };
    }
    for (const row of thesis.rows) result[row.deal_id].thesis = row.text;
    for (const row of decisions.rows) {
      result[row.deal_id].next_decision = { title: row.title, due_date: row.due_date };
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("GET /api/deals/thesis-lines error:", error);
    return NextResponse.json({ error: "Failed to load thesis lines" }, { status: 500 });
  }
}
