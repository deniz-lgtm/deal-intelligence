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
 * is unparseable, so addDays would throw on .toISOString() and the
 * recompute try/catch in the route handler would swallow the error.
 * Net effect: phases got patched start_dates but never gained
 * end_dates, so the gantt rendered no bars and "Invalid Date"
 * headers from undefined min/max.
 *
 * Also tolerates ISO strings ("2026-04-23T00:00:00.000Z") that come
 * back through JSON round-trips, and pre-trimmed YYYY-MM-DD strings
 * which we pass through unchanged.
 */
function normalizeDateString(input: unknown): string | null {
  if (input == null) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  if (typeof input === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    // Tolerate ISO strings; trim to the date part.
    const m = input.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // Last-ditch parse for things like "Thu Apr 23 2026".
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return null;
}

function addDays(input: string | Date | null | undefined, days: number): string {
  const dateStr = normalizeDateString(input);
  if (!dateStr) throw new Error(`addDays: unparseable date input ${String(input)}`);
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function daysBetween(aISO: string | Date, bISO: string | Date): number {
  const aStr = normalizeDateString(aISO);
  const bStr = normalizeDateString(bISO);
  if (!aStr || !bStr) return 0;
  const a = new Date(aStr + "T00:00:00Z").getTime();
  const b = new Date(bStr + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

function durationOf(p: DevPhase): number {
  // Milestones are zero-length; everything else uses duration_days or the
  // 30-day default.
  if (p.is_milestone) return 0;
  return p.duration_days ?? DEFAULT_DURATION_DAYS;
}

/**
 * Compute start/end/CPM fields for every phase.
 *
 * Two passes:
 *  1. Forward — earliest_start / earliest_finish using predecessor chains
 *     (cross-track chains are handled automatically since every track lives
 *     in the same table).
 *  2. Backward — latest_start / latest_finish off the overall project
 *     finish, yielding total_slack_days and is_critical (slack == 0).
 *
 * start_date / end_date are set from the forward-pass results when the user
 * hasn't explicitly pinned them. Phases whose start can't be determined
 * (no predecessor, no anchor date) are left untouched and excluded from
 * the backward pass — they won't have CPM fields.
 */
export function computeSchedule(phases: DevPhase[]): DevPhase[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  // Forward-pass outputs
  const es = new Map<string, string>();
  const ef = new Map<string, string>();

  function forward(phaseId: string, visiting: Set<string>): { start: string; finish: string } | null {
    if (es.has(phaseId)) return { start: es.get(phaseId)!, finish: ef.get(phaseId)! };
    if (visiting.has(phaseId)) {
      // Cycle — fall back to the phase's own anchor date.
      const phase = byId.get(phaseId);
      const anchor = phase ? normalizeDateString(phase.start_date) : null;
      if (anchor) {
        const d = durationOf(phase!);
        const finish = addDays(anchor, Math.max(0, d - 1));
        es.set(phaseId, anchor);
        ef.set(phaseId, finish);
        return { start: anchor, finish };
      }
      return null;
    }
    const phase = byId.get(phaseId);
    if (!phase) return null;

    visiting.add(phaseId);
    let start: string | null = null;
    if (phase.predecessor_id) {
      const pred = forward(phase.predecessor_id, visiting);
      if (pred) start = addDays(pred.finish, (phase.lag_days ?? 0) + 1);
    }
    if (!start) {
      // Anchor date can come back from pg as a Date object — normalize.
      const anchor = normalizeDateString(phase.start_date);
      if (anchor) start = anchor;
    }
    visiting.delete(phaseId);

    if (!start) return null;
    const d = durationOf(phase);
    const finish = addDays(start, Math.max(0, d - 1));
    es.set(phaseId, start);
    ef.set(phaseId, finish);
    return { start, finish };
  }

  for (const p of phases) forward(p.id, new Set());

  // Backward pass: for every phase with a forward-pass result, its LF is
  // the min(LS of successors) - 1; if it has no successors, LF = project
  // finish (the max EF across the graph). Work in reverse topological
  // order by iterating until nothing changes (small graphs, so cheap).
  const successorsOf = new Map<string, string[]>();
  for (const p of phases) {
    if (p.predecessor_id) {
      const arr = successorsOf.get(p.predecessor_id) ?? [];
      arr.push(p.id);
      successorsOf.set(p.predecessor_id, arr);
    }
  }

  const projectFinish = Array.from(ef.values()).reduce<string | null>((acc, d) => {
    if (!acc) return d;
    return d > acc ? d : acc;
  }, null);

  const lf = new Map<string, string>();
  const ls = new Map<string, string>();

  if (projectFinish) {
    // Seed: every phase's LF starts at projectFinish; we'll tighten it
    // from successors.
    for (const id of Array.from(ef.keys())) lf.set(id, projectFinish);

    let changed = true;
    let iterations = 0;
    const maxIterations = phases.length * 4 + 8;
    while (changed && iterations++ < maxIterations) {
      changed = false;
      for (const [id, succs] of Array.from(successorsOf.entries())) {
        if (!ef.has(id)) continue;
        // LF = min over successors of (successor.LS - 1 - lag)
        let tight: string | null = null;
        for (const sid of succs) {
          const succ = byId.get(sid);
          if (!succ) continue;
          if (!ls.has(sid) && !lf.has(sid)) continue;
          // Compute successor LS from its current LF
          const sLF = lf.get(sid);
          if (!sLF) continue;
          const sDur = durationOf(succ);
          const sLS = addDays(sLF, -Math.max(0, sDur - 1));
          const candidate = addDays(sLS, -((succ.lag_days ?? 0) + 1));
          if (tight === null || candidate < tight) tight = candidate;
        }
        if (tight && tight !== lf.get(id)) {
          lf.set(id, tight);
          changed = true;
        }
      }
      // Refresh LS for every phase based on current LF
      for (const [id, lfVal] of Array.from(lf.entries())) {
        const phase = byId.get(id);
        if (!phase) continue;
        const d = durationOf(phase);
        const lsVal = addDays(lfVal, -Math.max(0, d - 1));
        if (ls.get(id) !== lsVal) {
          ls.set(id, lsVal);
          changed = true;
        }
      }
    }
  }

  return phases.map((p) => {
    const startF = es.get(p.id) ?? null;
    const finishF = ef.get(p.id) ?? null;
    const startL = ls.get(p.id) ?? null;
    const finishL = lf.get(p.id) ?? null;

    const slack =
      startF && startL ? Math.max(0, daysBetween(startF, startL)) : null;
    const isCritical = slack === 0;

    // pg returns DATE columns as Date objects unless a custom parser
    // is registered; coerce to YYYY-MM-DD strings here so downstream
    // consumers (UI, JSON, diffComputedDates equality checks) all
    // work against a consistent type.
    const pinnedStart = normalizeDateString(p.start_date);
    const pinnedEnd = normalizeDateString(p.end_date);
    return {
      ...p,
      // Populate user-facing start/end from the forward pass when not
      // explicitly pinned. If the user pinned a start_date, respect it.
      start_date: pinnedStart ?? startF,
      end_date: pinnedEnd ?? finishF,
      earliest_start: startF,
      earliest_finish: finishF,
      latest_start: startL,
      latest_finish: finishL,
      total_slack_days: slack,
      is_critical: isCritical,
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

/** Row emitted per phase that needs its schedule/CPM fields updated. */
export interface ScheduleUpdate {
  id: string;
  start_date: string | null;
  end_date: string | null;
  earliest_start: string | null;
  earliest_finish: string | null;
  latest_start: string | null;
  latest_finish: string | null;
  total_slack_days: number | null;
  is_critical: boolean;
}

/**
 * Returns one update row per phase whose dates or CPM flags have changed.
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
    // Normalize before comparing — a Date object stored in `o` and a
    // YYYY-MM-DD string in `c` would always !== each other, producing
    // spurious bulkUpdateSchedule writes (and missing the no-op fast
    // path).
    const changed =
      normalizeDateString(o.start_date) !== normalizeDateString(c.start_date) ||
      normalizeDateString(o.end_date) !== normalizeDateString(c.end_date) ||
      normalizeDateString(o.earliest_start) !== normalizeDateString(c.earliest_start) ||
      normalizeDateString(o.earliest_finish) !== normalizeDateString(c.earliest_finish) ||
      normalizeDateString(o.latest_start) !== normalizeDateString(c.latest_start) ||
      normalizeDateString(o.latest_finish) !== normalizeDateString(c.latest_finish) ||
      o.total_slack_days !== c.total_slack_days ||
      o.is_critical !== c.is_critical;
    if (changed) {
      updates.push({
        id: c.id,
        start_date: c.start_date,
        end_date: c.end_date,
        earliest_start: c.earliest_start,
        earliest_finish: c.earliest_finish,
        latest_start: c.latest_start,
        latest_finish: c.latest_finish,
        total_slack_days: c.total_slack_days,
        is_critical: c.is_critical,
      });
    }
  }
  return updates;
}
