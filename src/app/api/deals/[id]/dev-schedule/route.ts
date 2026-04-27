import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { computeSchedule, diffComputedDates, normalizeDateString } from "@/lib/dev-schedule-compute";
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
  // Note: column additions are handled by the startup migration in src/lib/db.ts
}

async function recomputeSchedule(dealId: string) {
  const phases = (await devPhaseQueries.getByDealId(dealId)) as DevPhase[];
  const computed = computeSchedule(phases);
  const updates = diffComputedDates(phases, computed);
  if (updates.length > 0) {
    await devPhaseQueries.bulkUpdateSchedule(updates);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    let phases;
    try {
      phases = await devPhaseQueries.getByDealId(params.id);
    } catch {
      await ensureDevPhasesTable();
      phases = await devPhaseQueries.getByDealId(params.id);
    }

    // Optional ?track= filter. Client passes its current view so it
    // doesn't have to filter on every render.
    const track = req.nextUrl.searchParams.get("track");
    if (track) {
      phases = phases.filter((p: { track?: string }) => (p.track ?? "development") === track);
    }

    // node-postgres returns DATE columns as Date objects; coerce to
    // YYYY-MM-DD strings before sending so the client doesn't have to
    // care about either shape. JSON.stringify on a Date would serialize
    // as a full ISO timestamp ("2026-04-23T00:00:00.000Z") which works
    // for new Date() but breaks the gantt's `dateStr + "T00:00:00"`
    // header formatter.
    const normalized = (phases as Array<Record<string, unknown>>).map((p) => ({
      ...p,
      start_date: normalizeDateString(p.start_date),
      end_date: normalizeDateString(p.end_date),
      earliest_start: normalizeDateString(p.earliest_start),
      earliest_finish: normalizeDateString(p.earliest_finish),
      latest_start: normalizeDateString(p.latest_start),
      latest_finish: normalizeDateString(p.latest_finish),
    }));

    return NextResponse.json({ data: normalized });
  } catch (error) {
    console.error("GET /api/deals/[id]/dev-schedule error:", error);
    return NextResponse.json({ error: "Failed to fetch phases" }, { status: 500 });
  }
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

    const body = await req.json();
    const { phase_key, label, start_date, end_date, duration_days, predecessor_id, lag_days, parent_phase_id, task_category, task_owner, linked_document_ids, pct_complete, budget, status, notes, sort_order, track, is_milestone } = body;

    if (!label?.trim()) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      track: track || "development",
      phase_key: phase_key || label.trim().toLowerCase().replace(/\s+/g, "_"),
      label: label.trim(),
      start_date: start_date || null,
      end_date: end_date || null,
      duration_days: duration_days ?? null,
      predecessor_id: predecessor_id || null,
      lag_days: lag_days ?? 0,
      parent_phase_id: parent_phase_id || null,
      task_category: task_category || null,
      task_owner: task_owner || null,
      linked_document_ids: Array.isArray(linked_document_ids) && linked_document_ids.length > 0
        ? linked_document_ids
        : null,
      pct_complete: pct_complete ?? 0,
      budget: budget ?? null,
      status: status || "not_started",
      notes: notes || null,
      sort_order: sort_order ?? 0,
      is_milestone: is_milestone === true,
    };

    let phase;
    try {
      phase = await devPhaseQueries.create(payload);
    } catch {
      await ensureDevPhasesTable();
      phase = await devPhaseQueries.create(payload);
    }

    // Recompute schedule for the whole deal so dependent phases shift.
    // Isolated from the create — a CPM compute failure shouldn't roll
    // back the row the user just added.
    try {
      await recomputeSchedule(params.id);
    } catch (recomputeErr) {
      console.error("POST /api/deals/[id]/dev-schedule recompute error:", recomputeErr);
    }

    return NextResponse.json({ data: phase });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create phase", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
