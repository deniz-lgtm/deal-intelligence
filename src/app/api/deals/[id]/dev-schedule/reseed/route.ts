import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { DEFAULT_DEV_PHASES } from "@/lib/types";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

export const dynamic = "force-dynamic";

// Known renames from the legacy 7-phase seed to the expanded seed. Used to
// rewire construction predecessors (e.g. con_mobilization → dev_ntp) without
// clobbering rows whose predecessor has a direct replacement.
const LEGACY_KEY_REMAP: Record<string, string> = {
  dev_pre_dev: "dev_feasibility_study",
  dev_design: "dev_schematic_design",
  dev_gc_selection: "dev_ntp",
};

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

/**
 * Destructively replaces every development-track phase on a deal with the
 * current DEFAULT_DEV_PHASES. Acquisition and construction tracks are left
 * in place, but any construction row whose predecessor pointed at a
 * now-deleted dev phase is rewired to the equivalent new phase (via
 * LEGACY_KEY_REMAP, falling back to the same phase_key if it still exists,
 * or null if there's no equivalent).
 *
 * Intentionally destructive: user-entered budgets / notes / owners / linked
 * docs / pct_complete / custom-added dev phases are lost. Callers should
 * gate this behind confirmation.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    await ensureDevPhasesTable();

    const existing = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];

    // Map every old id → phase_key so we can rewire cross-track predecessor
    // references after we drop the dev rows.
    const oldIdToKey = new Map<string, string>();
    const oldIdToTrack = new Map<string, string>();
    for (const p of existing) {
      oldIdToKey.set(p.id, p.phase_key);
      oldIdToTrack.set(p.id, p.track);
    }

    const devRows = existing.filter((p) => p.track === "development");
    const nonDevRows = existing.filter((p) => p.track !== "development");

    // Record non-dev rows whose predecessor currently points into the dev
    // track — these need rewiring after the delete+reseed.
    const rewireTargets = nonDevRows
      .filter((p) => p.predecessor_id && oldIdToTrack.get(p.predecessor_id) === "development")
      .map((p) => ({
        id: p.id,
        oldPredKey: oldIdToKey.get(p.predecessor_id!)!,
      }));

    // Drop every dev row. The FK from deal_dev_phases.predecessor_id isn't
    // enforced at the DB level (plain TEXT column), so deletes won't cascade
    // — we'll null/rewire stale predecessor refs explicitly below.
    for (const p of devRows) {
      await devPhaseQueries.delete(p.id);
    }

    // Fresh keyToId starts with every surviving non-dev phase so new dev
    // rows can resolve their predecessor_key — including cross-track refs
    // like dev_feasibility_study → acq_closing.
    const keyToId = new Map<string, string>();
    for (const p of nonDevRows) {
      keyToId.set(p.phase_key, p.id);
    }

    // Figure out where dev phases should slot into the unified sort order.
    // Place them right after the last acquisition phase; construction rows
    // get bumped below.
    const maxAcqSort = Math.max(
      -1,
      ...nonDevRows.filter((p) => p.track === "acquisition").map((p) => p.sort_order ?? 0)
    );

    // Pass 1: insert every new dev phase with predecessor_id null so the
    // create ordering doesn't matter.
    let sortCursor = maxAcqSort + 1;
    for (const seed of DEFAULT_DEV_PHASES) {
      const id = uuidv4();
      keyToId.set(seed.phase_key, id);
      await devPhaseQueries.create({
        id,
        deal_id: params.id,
        track: "development",
        phase_key: seed.phase_key,
        label: seed.label,
        start_date: null,
        duration_days: seed.duration_days,
        predecessor_id: null,
        lag_days: 0,
        sort_order: sortCursor++,
        is_milestone: seed.is_milestone === true,
      });
    }

    // Pass 2: resolve predecessor_key → predecessor_id on the new dev rows.
    for (const seed of DEFAULT_DEV_PHASES) {
      if (!seed.predecessor_key) continue;
      const selfId = keyToId.get(seed.phase_key);
      const predId = keyToId.get(seed.predecessor_key);
      if (!selfId || !predId) continue;
      await devPhaseQueries.update(selfId, { predecessor_id: predId });
    }

    // Bump every construction row's sort_order so it stays after the new
    // dev block.
    const constructionRows = nonDevRows
      .filter((p) => p.track === "construction")
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (const p of constructionRows) {
      await devPhaseQueries.update(p.id, { sort_order: sortCursor++ });
    }

    // Rewire construction predecessors that used to point at now-deleted
    // dev rows. Prefer the explicit remap; fall back to same key if it
    // survived the reseed; null out if there's no equivalent.
    for (const target of rewireTargets) {
      const newKey = LEGACY_KEY_REMAP[target.oldPredKey] ?? target.oldPredKey;
      const newPredId = keyToId.get(newKey) ?? null;
      await devPhaseQueries.update(target.id, { predecessor_id: newPredId });
    }

    // Recompute CPM so start/end dates and critical-path flags land before
    // the client re-fetches.
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
        deleted_dev_count: devRows.length,
        inserted_dev_count: DEFAULT_DEV_PHASES.length,
        rewired_construction_count: rewireTargets.length,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/reseed error:", error);
    return NextResponse.json({ error: "Failed to reseed dev schedule" }, { status: 500 });
  }
}
