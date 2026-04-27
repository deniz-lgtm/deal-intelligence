import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import { ACQ_PHASE_KEYS, type AcqPhaseKey } from "@/lib/acq-schedule-extract";
import { DEFAULT_ACQ_PHASES } from "@/lib/types";
import type { DevPhase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Step 2 of the Acquisition-doc importer. Each preview row arrives
 * with an explicit decision attached:
 *
 *   - "apply"  → take the proposed values (PATCH existing phase or
 *                CREATE if no existing phase for that key).
 *   - "skip"   → ignore this row entirely.
 *
 * The route never silently overwrites — every conflict was already
 * resolved in the dialog. CPM recompute runs at the end inside its own
 * try/catch so a downstream compute error doesn't undo the user's
 * imported dates.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = (await req.json()) as { rows?: CommitRow[] };
    const rows: CommitRow[] = Array.isArray(body?.rows) ? body.rows : [];
    const applyRows = rows.filter((r) => r.action === "apply");
    if (applyRows.length === 0) {
      return NextResponse.json(
        { error: "No rows selected to apply" },
        { status: 400 }
      );
    }

    const allPhases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const acqByKey = new Map<string, DevPhase>();
    for (const p of allPhases) {
      if ((p.track ?? "development") === "acquisition" && p.phase_key) {
        acqByKey.set(p.phase_key, p);
      }
    }

    let patched = 0;
    let created = 0;

    // Sort canonical Acq rows so siblings later in the chain (closing
    // after escrow, etc.) get inserted in dependency-order — that keeps
    // sort_order tidy when we have to create rows from scratch.
    const canonicalOrder = new Map<string, number>(
      ACQ_PHASE_KEYS.map((k, i) => [k, i])
    );
    applyRows.sort(
      (a, b) =>
        (canonicalOrder.get(a.phase_key) ?? 999) -
        (canonicalOrder.get(b.phase_key) ?? 999)
    );

    // Highest sort_order across the deal → seed new rows below it so we
    // don't collide with existing phases (acq, dev, or construction).
    let nextSort = allPhases.reduce(
      (m, p) => ((p.sort_order ?? 0) > m ? (p.sort_order ?? 0) : m),
      -1
    ) + 1;

    for (const r of applyRows) {
      const existing = acqByKey.get(r.phase_key);
      const updates: Record<string, unknown> = {};
      if (r.start_date !== undefined) updates.start_date = r.start_date;
      if (r.duration_days !== undefined) updates.duration_days = r.duration_days;

      if (existing) {
        if (Object.keys(updates).length > 0) {
          await devPhaseQueries.update(existing.id, updates);
          patched++;
        }
      } else {
        // No existing phase for this key — seed one. For canonical
        // keys we look up the default label / milestone flag; for
        // free-form keys (financing_contingency_expiry, etc.) we use
        // the analyst-provided label as-is.
        const def = DEFAULT_ACQ_PHASES.find((d) => d.phase_key === r.phase_key);
        const isCanonical = ACQ_PHASE_KEYS.includes(r.phase_key as AcqPhaseKey);
        // Predecessor for canonical phases comes from the seed table.
        // If the predecessor row already exists on the deal, link it;
        // otherwise leave null and let the user re-link (or chain via
        // a future seed-defaults click).
        let predecessor_id: string | null = null;
        if (def?.predecessor_key) {
          const pred = acqByKey.get(def.predecessor_key);
          if (pred) predecessor_id = pred.id;
        }
        const id = uuidv4();
        await devPhaseQueries.create({
          id,
          deal_id: params.id,
          track: "acquisition",
          phase_key: r.phase_key,
          label: r.label || def?.label || r.phase_key,
          start_date: r.start_date ?? null,
          duration_days: r.duration_days ?? def?.duration_days ?? 0,
          predecessor_id,
          lag_days: 0,
          sort_order: nextSort++,
          is_milestone: isCanonical
            ? def?.is_milestone === true
            : (r.duration_days ?? 0) === 0,
          notes: r.source_quote ? `Imported from doc: "${r.source_quote}"` : null,
        });
        // Track the freshly-created row so subsequent rows in this
        // batch can resolve their predecessor against it.
        acqByKey.set(r.phase_key, {
          id,
          phase_key: r.phase_key,
          track: "acquisition",
        } as DevPhase);
        created++;
      }
    }

    // Recompute CPM. Isolated try/catch — same pattern as the rest of
    // the schedule mutation routes after #137; a compute failure
    // doesn't undo imported dates.
    try {
      const fresh = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
      const computed = computeSchedule(fresh);
      const updates = diffComputedDates(fresh, computed);
      if (updates.length > 0) await devPhaseQueries.bulkUpdateSchedule(updates);
    } catch (recomputeErr) {
      console.error(
        "POST /api/deals/[id]/acq-schedule/import/commit recompute error:",
        recomputeErr
      );
    }

    return NextResponse.json({
      data: {
        patched,
        created,
        total: patched + created,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/acq-schedule/import/commit error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to commit Acq schedule import", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}

interface CommitRow {
  action: "apply" | "skip";
  phase_key: string;
  label: string;
  start_date?: string | null;
  duration_days?: number;
  source_quote?: string | null;
}
