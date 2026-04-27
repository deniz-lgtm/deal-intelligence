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
 * Two import modes:
 *
 *   - "replace" (default) — wipe the acq track first, auto-seed the
 *     seven canonical defaults, then apply extracted dates. Clean
 *     state every time. Best for first-time imports and for healing
 *     deals that have accumulated cruft from earlier attempts.
 *
 *   - "merge" — keep existing acq phases. PATCH where keys match,
 *     CREATE where they don't, and heal any null predecessors as we
 *     go. Useful when the analyst has hand-tuned the schedule and
 *     just wants to layer in dates from a new doc.
 *
 * For non-canonical free-form events the doc surfaced (financing
 * contingency expiry, lender deadlines, etc.) we walk back the
 * canonical Acq chain to find the closest existing predecessor so
 * the row chains naturally instead of floating loose.
 *
 * CPM recompute runs at the end inside its own try/catch so a
 * downstream compute error doesn't undo the user's imported dates.
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

    const body = (await req.json()) as { rows?: CommitRow[]; mode?: "replace" | "merge" };
    const rows: CommitRow[] = Array.isArray(body?.rows) ? body.rows : [];
    const mode: "replace" | "merge" = body?.mode === "merge" ? "merge" : "replace";
    const applyRows = rows.filter((r) => r.action === "apply");
    if (applyRows.length === 0) {
      return NextResponse.json(
        { error: "No rows selected to apply" },
        { status: 400 }
      );
    }

    let allPhases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];

    // ── Replace mode: wipe acq track first ────────────────────────
    // Delete every acquisition-track phase on the deal. Cross-track
    // dependencies (Dev or Construction phases pointing into Acq —
    // typically an `acq_closing` predecessor) get their predecessor
    // nulled out first so the foreign key lookup doesn't dangle.
    if (mode === "replace") {
      const acqPhases = allPhases.filter(
        (p) => (p.track ?? "development") === "acquisition"
      );
      const acqIds = new Set(acqPhases.map((p) => p.id));
      for (const p of allPhases) {
        if (p.predecessor_id && acqIds.has(p.predecessor_id)) {
          await devPhaseQueries.update(p.id, { predecessor_id: null });
        }
      }
      for (const p of acqPhases) {
        await devPhaseQueries.delete(p.id);
      }
      allPhases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    }

    let acqByKey = buildAcqByKey(allPhases);

    // ── Auto-seed canonical defaults if the acq track is empty ────
    // After replace this is always true. In merge mode it fires only
    // for fresh deals. Either way, every patch lands on a row that
    // already has its predecessor wired up.
    let autoSeeded = false;
    if (acqByKey.size === 0) {
      const nextSort = allPhases.reduce(
        (m, p) => ((p.sort_order ?? 0) > m ? (p.sort_order ?? 0) : m),
        -1
      ) + 1;
      await seedAcqDefaults(params.id, nextSort);
      allPhases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
      acqByKey = buildAcqByKey(allPhases);
      autoSeeded = true;
    }

    let patched = 0;
    let created = 0;

    // Dedup applyRows by phase_key. If the extractor surfaced the same
    // event twice (we saw "Appraisal Period × 2" in the wild) we keep
    // the first and drop the rest — preserving the higher-confidence
    // one when they happen to be in confidence-desc order.
    const seenKeys = new Set<string>();
    const uniqueApplyRows = applyRows.filter((r) => {
      if (seenKeys.has(r.phase_key)) return false;
      seenKeys.add(r.phase_key);
      return true;
    });

    // Sort canonical Acq rows in dependency-order so freshly-created
    // free-form rows can resolve their predecessor against earlier
    // rows in this batch.
    const canonicalOrder = new Map<string, number>(
      ACQ_PHASE_KEYS.map((k, i) => [k, i])
    );
    uniqueApplyRows.sort(
      (a, b) =>
        (canonicalOrder.get(a.phase_key) ?? 999) -
        (canonicalOrder.get(b.phase_key) ?? 999)
    );

    let nextSort = allPhases.reduce(
      (m, p) => ((p.sort_order ?? 0) > m ? (p.sort_order ?? 0) : m),
      -1
    ) + 1;

    for (const r of uniqueApplyRows) {
      const existing = acqByKey.get(r.phase_key);
      const updates: Record<string, unknown> = {};
      if (r.start_date !== undefined) updates.start_date = r.start_date;
      if (r.duration_days !== undefined) updates.duration_days = r.duration_days;

      // Heal broken predecessor chains from earlier import attempts.
      // If the existing row has no predecessor_id and we can resolve
      // a sensible one (canonical chain → closest existing), patch it
      // along with the dates so the row drops back into the gantt
      // instead of floating at the project anchor.
      if (existing && !existing.predecessor_id) {
        const def = DEFAULT_ACQ_PHASES.find((d) => d.phase_key === r.phase_key);
        const predId = pickPredecessor(r.phase_key, def?.predecessor_key, acqByKey, existing.id);
        if (predId) updates.predecessor_id = predId;
      }

      if (existing) {
        if (Object.keys(updates).length > 0) {
          await devPhaseQueries.update(existing.id, updates);
          patched++;
        }
      } else {
        // No existing phase for this key — seed one.
        const def = DEFAULT_ACQ_PHASES.find((d) => d.phase_key === r.phase_key);
        const isCanonical = ACQ_PHASE_KEYS.includes(r.phase_key as AcqPhaseKey);
        const predecessor_id = pickPredecessor(r.phase_key, def?.predecessor_key, acqByKey, null);
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
        // Track freshly-created rows so subsequent rows in this batch
        // can resolve their predecessor against them.
        acqByKey.set(r.phase_key, {
          id,
          phase_key: r.phase_key,
          track: "acquisition",
        } as DevPhase);
        created++;
      }
    }

    // ── Recompute CPM ─────────────────────────────────────────────
    // Isolated try/catch — a compute failure doesn't undo imported
    // dates. Same isolation pattern as #137.
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
        auto_seeded: autoSeeded,
        mode,
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

function buildAcqByKey(phases: DevPhase[]): Map<string, DevPhase> {
  const m = new Map<string, DevPhase>();
  for (const p of phases) {
    if ((p.track ?? "development") === "acquisition" && p.phase_key) {
      m.set(p.phase_key, p);
    }
  }
  return m;
}

/**
 * Find the best predecessor for a phase being created on the acq track.
 *
 * Canonical phases use their default predecessor when it exists on the
 * deal; free-form phases (or canonical phases whose default predecessor
 * isn't on the deal yet) walk back the canonical chain looking for the
 * closest existing predecessor. That keeps imported rows connected to
 * the chain instead of floating loose.
 */
function pickPredecessor(
  phaseKey: string,
  defaultPredecessorKey: string | null | undefined,
  acqByKey: Map<string, DevPhase>,
  /** Self-id when called from a PATCH path. We never link a row to
   *  itself — that's a degenerate cycle. */
  selfId: string | null
): string | null {
  // Default predecessor present on the deal? Use it.
  if (defaultPredecessorKey) {
    const direct = acqByKey.get(defaultPredecessorKey);
    if (direct && direct.id !== selfId) return direct.id;
  }

  // Walk back the canonical chain. For canonical keys we step through
  // ACQ_PHASE_KEYS in order; for free-form keys we use the chain as-is
  // (a free-form event imported with no anchor will hang off the latest
  // canonical phase that exists on the deal — typically a sensible
  // chronological ordering).
  const idx = ACQ_PHASE_KEYS.indexOf(phaseKey as AcqPhaseKey);
  const startIdx = idx > 0 ? idx - 1 : ACQ_PHASE_KEYS.length - 1;
  for (let i = startIdx; i >= 0; i--) {
    const candidate = acqByKey.get(ACQ_PHASE_KEYS[i]);
    if (candidate && candidate.id !== selfId) return candidate.id;
  }
  return null;
}

/**
 * Inline copy of the seed route's per-track logic. Creates the seven
 * canonical Acq phases with predecessor chains wired up. We don't anchor
 * a start_date on any phase — the import that triggered this seed will
 * patch real dates onto these rows in the next step. CPM will compute
 * end_dates from the chain once everything's in place.
 */
async function seedAcqDefaults(dealId: string, startSort: number): Promise<void> {
  const idByKey = new Map<string, string>();
  let sort = startSort;
  // First pass: insert each phase with no predecessor_id.
  for (const seed of DEFAULT_ACQ_PHASES) {
    const id = uuidv4();
    idByKey.set(seed.phase_key, id);
    await devPhaseQueries.create({
      id,
      deal_id: dealId,
      track: "acquisition",
      phase_key: seed.phase_key,
      label: seed.label,
      start_date: null,
      duration_days: seed.duration_days,
      predecessor_id: null,
      lag_days: 0,
      sort_order: sort++,
      is_milestone: seed.is_milestone === true,
    });
  }
  // Second pass: resolve predecessor_key → predecessor_id.
  for (const seed of DEFAULT_ACQ_PHASES) {
    if (!seed.predecessor_key) continue;
    const selfId = idByKey.get(seed.phase_key);
    const predId = idByKey.get(seed.predecessor_key);
    if (!selfId || !predId) continue;
    await devPhaseQueries.update(selfId, { predecessor_id: predId });
  }
}
