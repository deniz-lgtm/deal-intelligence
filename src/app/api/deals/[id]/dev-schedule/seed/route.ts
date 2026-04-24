import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  DEFAULT_ACQ_PHASES,
  DEFAULT_DEV_PHASES,
  DEFAULT_CONSTRUCTION_PHASES,
  type DefaultPhaseSeed,
  type ScheduleTrack,
} from "@/lib/types";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

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
  // Self-healing migrations. Column additions are also applied by the
  // startup migration in src/lib/db.ts, but inlining them here means a
  // pool that came up before the newer migrations landed still satisfies
  // the INSERT in devPhaseQueries.create. Without this, the seed route
  // silently 500s with "column X does not exist" and the user sees "Seed
  // Default Phases does nothing".
  const alters = [
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS parent_phase_id TEXT",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS task_category TEXT",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS task_owner TEXT",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS linked_document_ids JSONB",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS track TEXT",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN NOT NULL DEFAULT false",
  ];
  for (const sql of alters) {
    try { await pool.query(sql); } catch (err) {
      console.warn("dev-phases ALTER skipped:", (err as Error).message?.slice(0, 120));
    }
  }
}

interface SeedPlanRow {
  seed: DefaultPhaseSeed;
  track: ScheduleTrack;
  sort_order: number;

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

    // Optional anchor start date (defaults to today). This anchors the very
    // first phase of the acquisition track; everything else chains off of it.
    let anchorDate = new Date().toISOString().split("T")[0];
    try {
      const body = await req.json();
      if (body?.start_date) anchorDate = body.start_date;
    } catch {}

    // Combine all three tracks into one ordered plan. sort_order is
    // monotonically increasing across tracks so the unified gantt shows
    // Acq → Dev → Construction in natural order.
    const plan: SeedPlanRow[] = [];
    let sort = 0;
    for (const seed of DEFAULT_ACQ_PHASES)          plan.push({ seed, track: "acquisition",  sort_order: sort++ });
    for (const seed of DEFAULT_DEV_PHASES)          plan.push({ seed, track: "development",  sort_order: sort++ });
    for (const seed of DEFAULT_CONSTRUCTION_PHASES) plan.push({ seed, track: "construction", sort_order: sort++ });

    // Two passes: create every phase with a generated id (no predecessor_id
    // yet), then resolve cross-track predecessor_key → predecessor_id.
    const idByKey = new Map<string, string>();

    for (const row of plan) {
      const id = uuidv4();
      idByKey.set(row.seed.phase_key, id);
      await devPhaseQueries.create({
        id,
        deal_id: params.id,
        track: row.track,
        phase_key: row.seed.phase_key,
        label: row.seed.label,
        // Anchor the very first phase with the caller-supplied date; every
        // other phase's start is derived from its predecessor.
        start_date: row.seed.predecessor_key ? null : anchorDate,
        duration_days: row.seed.duration_days,
        predecessor_id: null, // filled in below
        lag_days: 0,
        sort_order: row.sort_order,
        is_milestone: row.seed.is_milestone === true,
      });
    }

    for (const row of plan) {
      if (!row.seed.predecessor_key) continue;
      const selfId = idByKey.get(row.seed.phase_key);
      const predId = idByKey.get(row.seed.predecessor_key);
      if (!selfId || !predId) continue;
      await devPhaseQueries.update(selfId, { predecessor_id: predId });
    }

    // Run the CPM pass so forward/backward fields are populated on first
    // render — no need for the client to wait for a second request.
    const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const computed = computeSchedule(phases);
    const updates = diffComputedDates(phases, computed);
    if (updates.length > 0) {
      await devPhaseQueries.bulkUpdateSchedule(updates);
    }

    const finalPhases = await devPhaseQueries.getByDealId(params.id);
    return NextResponse.json({ data: { phases: finalPhases, seeded: true } });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/seed error:", error);
    return NextResponse.json({ error: "Failed to seed dev schedule" }, { status: 500 });
  }
}
