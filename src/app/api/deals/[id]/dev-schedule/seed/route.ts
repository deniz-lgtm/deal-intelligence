import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  DEFAULT_PHASES_BY_TRACK,
  type DefaultPhaseSeed,
  type ScheduleTrack,
} from "@/lib/types";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

const ALL_TRACKS: ScheduleTrack[] = ["acquisition", "development", "construction"];

function isValidTrack(v: unknown): v is ScheduleTrack {
  return typeof v === "string" && (ALL_TRACKS as string[]).includes(v);
}

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

    // Parse body once: anchor date + optional track scope.
    let anchorDate = new Date().toISOString().split("T")[0];
    let requestedTrack: ScheduleTrack | null = null;
    try {
      const body = await req.json();
      if (body?.start_date) anchorDate = body.start_date;
      if (isValidTrack(body?.track)) requestedTrack = body.track;
    } catch {}

    // Track scope: if the caller passed a specific track, seed only that
    // track and only if that track is currently empty. Without a track
    // we preserve the legacy "seed all three when deal is empty" behavior
    // so any older caller keeps working.
    const tracksToSeed: ScheduleTrack[] = requestedTrack ? [requestedTrack] : ALL_TRACKS;

    const existingAll = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const existingByTrack = new Map<ScheduleTrack, DevPhase[]>();
    for (const t of ALL_TRACKS) existingByTrack.set(t, []);
    for (const p of existingAll) {
      const t = (p.track ?? "development") as ScheduleTrack;
      if (existingByTrack.has(t)) existingByTrack.get(t)!.push(p);
    }

    const skippedTracks: ScheduleTrack[] = [];
    const tracksActuallySeeded: ScheduleTrack[] = [];
    for (const t of tracksToSeed) {
      if ((existingByTrack.get(t) ?? []).length > 0) skippedTracks.push(t);
      else tracksActuallySeeded.push(t);
    }

    if (tracksActuallySeeded.length === 0) {
      return NextResponse.json({
        data: {
          phases: existingAll,
          seeded: false,
          tracks_seeded: [],
          tracks_skipped: skippedTracks,
        },
      });
    }

    // sort_order continues after whatever's already in the deal so a single-
    // track reseed slots in after existing phases on other tracks.
    let sort = existingAll.reduce((m, p) => Math.max(m, p.sort_order ?? 0), -1) + 1;
    const plan: SeedPlanRow[] = [];
    for (const track of tracksActuallySeeded) {
      for (const seed of DEFAULT_PHASES_BY_TRACK[track]) {
        plan.push({ seed, track, sort_order: sort++ });
      }
    }

    // Two passes: create every phase with a generated id (no predecessor_id
    // yet), then resolve cross-track predecessor_key → predecessor_id.
    // Cross-track predecessors may point at phases that already exist on a
    // track we're not seeding, so seed idByKey from those too.
    const idByKey = new Map<string, string>();
    for (const p of existingAll) {
      if (p.phase_key) idByKey.set(p.phase_key, p.id);
    }

    for (const row of plan) {
      const id = uuidv4();
      idByKey.set(row.seed.phase_key, id);
      await devPhaseQueries.create({
        id,
        deal_id: params.id,
        track: row.track,
        phase_key: row.seed.phase_key,
        label: row.seed.label,
        // Anchor any phase whose predecessor isn't resolvable (either the
        // first phase of acquisition on a fresh deal, or the first phase of
        // a later track seeded in isolation with no prior phases to chain
        // from). CPM will recompute everything below.
        start_date: row.seed.predecessor_key && idByKey.has(row.seed.predecessor_key) ? null : anchorDate,
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
    return NextResponse.json({
      data: {
        phases: finalPhases,
        seeded: true,
        tracks_seeded: tracksActuallySeeded,
        tracks_skipped: skippedTracks,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/seed error:", error);
    return NextResponse.json({ error: "Failed to seed dev schedule" }, { status: 500 });
  }
}
