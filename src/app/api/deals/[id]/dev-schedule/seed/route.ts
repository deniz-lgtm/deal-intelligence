import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { DEFAULT_DEV_PHASES } from "@/lib/types";

async function ensureDevPhasesTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_dev_phases (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      phase_key TEXT NOT NULL,
      label TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      pct_complete INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC,
      status TEXT NOT NULL DEFAULT 'not_started',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await ensureDevPhasesTable();

    const existing = await devPhaseQueries.getByDealId(params.id);
    if (existing.length > 0) {
      return NextResponse.json({ data: { phases: existing, seeded: false } });
    }

    // Optional start date from request body (defaults to today)
    let startDate = new Date();
    try {
      const body = await req.json();
      if (body?.start_date) startDate = new Date(body.start_date);
    } catch {}

    let cursor = startDate;
    for (let i = 0; i < DEFAULT_DEV_PHASES.length; i++) {
      const p = DEFAULT_DEV_PHASES[i];
      const phaseStart = new Date(cursor);
      const phaseEnd = addMonths(cursor, p.duration_months);

      await devPhaseQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        phase_key: p.phase_key,
        label: p.label,
        start_date: phaseStart.toISOString().split("T")[0],
        end_date: phaseEnd.toISOString().split("T")[0],
        sort_order: i,
      });

      cursor = phaseEnd;
    }

    const phases = await devPhaseQueries.getByDealId(params.id);
    return NextResponse.json({ data: { phases, seeded: true } });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/seed error:", error);
    return NextResponse.json({ error: "Failed to seed dev schedule" }, { status: 500 });
  }
}
