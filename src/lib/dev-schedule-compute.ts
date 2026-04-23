import type { DevPhase } from "./types";

// Default duration when a phase has no explicit duration_days set.
// Matches the prior behavior of the forward-only pass.
const DEFAULT_DURATION_DAYS = 30;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00Z").getTime();
  const b = new Date(bISO + "T00:00:00Z").getTime();
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
      if (phase?.start_date) {
        const d = durationOf(phase);
        const start = phase.start_date;
        const finish = addDays(start, Math.max(0, d - 1));
        es.set(phaseId, start);
        ef.set(phaseId, finish);
        return { start, finish };
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
    if (!start && phase.start_date) start = phase.start_date;
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

    return {
      ...p,
      // Populate user-facing start/end from the forward pass when not
      // explicitly pinned. If the user pinned a start_date, respect it.
      start_date: p.start_date ?? startF,
      end_date: p.end_date ?? finishF,
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
    const changed =
      o.start_date !== c.start_date ||
      o.end_date !== c.end_date ||
      o.earliest_start !== c.earliest_start ||
      o.earliest_finish !== c.earliest_finish ||
      o.latest_start !== c.latest_start ||
      o.latest_finish !== c.latest_finish ||
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
