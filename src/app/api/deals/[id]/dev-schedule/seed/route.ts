import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { DEFAULT_DEV_PHASES } from "@/lib/types";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

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
      duration_days INTEGER,
      predecessor_id TEXT,
      lag_days INTEGER NOT NULL DEFAULT 0,
      pct_complete INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC,
      status TEXT NOT NULL DEFAULT 'not_started',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Note: column additions are handled by the startup migration in src/lib/db.ts
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

    // Optional anchor start date (defaults to today)
    let anchorDate = new Date().toISOString().split("T")[0];
    try {
      const body = await req.json();
      if (body?.start_date) anchorDate = body.start_date;
    } catch {}

    // Seed phases with durations + predecessor chain
    // First phase is the anchor (gets a start_date), rest are linked sequentially
    let prevPhaseId: string | null = null;
    for (let i = 0; i < DEFAULT_DEV_PHASES.length; i++) {
      const p = DEFAULT_DEV_PHASES[i];
      const phaseId = uuidv4();
      const durationDays = p.duration_months * 30;
      await devPhaseQueries.create({
        id: phaseId,
        deal_id: params.id,
        phase_key: p.phase_key,
        label: p.label,
        // Only first phase has an anchor start_date; rest are linked
        start_date: i === 0 ? anchorDate : null,
        duration_days: durationDays,
        predecessor_id: prevPhaseId,
        lag_days: 0,
        sort_order: i,
      });
      prevPhaseId = phaseId;
    }

    // Run compute pass to fill in start/end dates from the chain
    const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const computed = computeSchedule(phases);
    const updates = diffComputedDates(phases, computed);
    if (updates.length > 0) {
      await devPhaseQueries.bulkUpdateDates(updates);
    }

    const finalPhases = await devPhaseQueries.getByDealId(params.id);
    return NextResponse.json({ data: { phases: finalPhases, seeded: true } });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/seed error:", error);
    return NextResponse.json({ error: "Failed to seed dev schedule" }, { status: 500 });
  }
}
