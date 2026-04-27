import type { DevPhase } from "./types";

// Default duration when a phase has no explicit duration_days set.
// Matches the prior behavior of the forward-only pass.
const DEFAULT_DURATION_DAYS = 30;

/**
 * Coerce whatever pg/JSON.parse handed us into a YYYY-MM-DD string.
 *
 * node-postgres returns DATE columns as JavaScript Date objects by
 * default. Concatenating those with "T00:00:00Z" coerces via
 * Date.toString() ("Thu Apr 23 2026 00:00:00 GMT+0000 (UTC)") which
 * is unparseable, so addDays would throw on .toISOString() and a
 * recompute try/catch in the route handler would swallow the error.
 * Net effect: phases got patched start_dates but never gained
 * end_dates, so the gantt rendered no bars and "Invalid Date"
 * headers from undefined min/max.
 *
 * Also tolerates ISO strings ("2026-04-23T00:00:00.000Z") that come
 * back through JSON round-trips, and pre-trimmed YYYY-MM-DD strings
 * which we pass through unchanged.
 */
export function normalizeDateString(input: unknown): string | null {
  if (input == null) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  if (typeof input === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    const m = input.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return null;
}

export function addDays(input: string | Date | null | undefined, days: number): string {
  const dateStr = normalizeDateString(input);
  if (!dateStr) throw new Error(`addDays: unparseable date input ${String(input)}`);
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function durationOf(p: DevPhase): number {
  // Milestones are zero-length; everything else uses duration_days or the
  // 30-day default.
  if (p.is_milestone) return 0;
  return p.duration_days ?? DEFAULT_DURATION_DAYS;
}

/**
 * Forward-pass schedule computation. Walks predecessor chains and
 * sets each phase's start_date and end_date from the chain.
 *
 * Backward pass / slack / critical-path math used to live here too,
 * but those fields were never rendered (the UI used a local heuristic
 * that didn't match the DB) so they were pure dead weight + a source
 * of bugs. Removed in favor of forward-only — sufficient for
 * feasibility scheduling, way fewer moving parts.
 *
 * Rules:
 *  - If a phase has a predecessor on the deal, its start = predecessor.end + lag + 1.
 *  - Otherwise, if the phase has its own start_date, that's the anchor.
 *  - Otherwise the phase is left without dates (caller decides what to do).
 *  - end = start + max(0, duration - 1). Milestones (duration 0) collapse start = end.
 *
 * Cycle handling: if we recursively visit the same phase, we stop and
 * fall back to that phase's own start_date (anchor), so a circular chain
 * just degrades to "first one wins" without throwing.
 */
export function computeSchedule(phases: DevPhase[]): DevPhase[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const startMap = new Map<string, string>();
  const endMap = new Map<string, string>();

  function forward(phaseId: string, visiting: Set<string>): { start: string; end: string } | null {
    const cached = startMap.get(phaseId);
    if (cached) return { start: cached, end: endMap.get(phaseId)! };
    const phase = byId.get(phaseId);
    if (!phase) return null;

    if (visiting.has(phaseId)) {
      // Cycle — fall back to the phase's own anchor date.
      const anchor = normalizeDateString(phase.start_date);
      if (!anchor) return null;
      const d = durationOf(phase);
      const end = addDays(anchor, Math.max(0, d - 1));
      startMap.set(phaseId, anchor);
      endMap.set(phaseId, end);
      return { start: anchor, end };
    }

    visiting.add(phaseId);
    let start: string | null = null;
    if (phase.predecessor_id) {
      const pred = forward(phase.predecessor_id, visiting);
      if (pred) start = addDays(pred.end, (phase.lag_days ?? 0) + 1);
    }
    if (!start) {
      const anchor = normalizeDateString(phase.start_date);
      if (anchor) start = anchor;
    }
    visiting.delete(phaseId);

    if (!start) return null;
    const d = durationOf(phase);
    const end = addDays(start, Math.max(0, d - 1));
    startMap.set(phaseId, start);
    endMap.set(phaseId, end);
    return { start, end };
  }

  for (const p of phases) forward(p.id, new Set());

  return phases.map((p) => {
    const start = startMap.get(p.id) ?? normalizeDateString(p.start_date);
    const end = endMap.get(p.id) ?? normalizeDateString(p.end_date);
    return {
      ...p,
      start_date: start,
      end_date: end,
    };
  });
}

/**
 * Detect whether setting `predecessorId` as predecessor of `phaseId` would
 * create a cycle. Cross-track predecessor chains are fine — this only
 * blocks true circular dependencies.
 */
export function detectCycle(
  phases: DevPhase[],
  phaseId: string,
  predecessorId: string
): boolean {
  if (phaseId === predecessorId) return true;
  const byId = new Map(phases.map((p) => [p.id, p]));
  let current: string | null = predecessorId;
  const visited = new Set<string>();
  while (current) {
    if (current === phaseId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    const p = byId.get(current);
    current = p?.predecessor_id ?? null;
  }
  return false;
}

/** Row emitted per phase that needs its schedule fields updated. */
export interface ScheduleUpdate {
  id: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Returns one update row per phase whose dates have changed.
 * Callers pass the result to devPhaseQueries.bulkUpdateSchedule.
 */
export function diffComputedDates(
  original: DevPhase[],
  computed: DevPhase[]
): ScheduleUpdate[] {
  const origById = new Map(original.map((p) => [p.id, p]));
  const updates: ScheduleUpdate[] = [];
  for (const c of computed) {
    const o = origById.get(c.id);
    if (!o) continue;
    const changed =
      normalizeDateString(o.start_date) !== normalizeDateString(c.start_date) ||
      normalizeDateString(o.end_date) !== normalizeDateString(c.end_date);
    if (changed) {
      updates.push({
        id: c.id,
        start_date: c.start_date,
        end_date: c.end_date,
      });
    }
  }
  return updates;
}
