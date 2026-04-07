import type { DevPhase } from "./types";

/**
 * Add days to a date string (YYYY-MM-DD), returning a new date string.
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Compute start/end dates for all phases based on:
 *   - Anchor phases (no predecessor): use their manually set start_date
 *   - Linked phases (with predecessor): start = predecessor.end + lag_days + 1
 *   - duration_days drives end date: end = start + duration_days - 1
 *
 * Walks the dependency graph topologically. Detects cycles (treats as anchor on cycle).
 *
 * Returns the list of phases with updated start_date and end_date fields.
 * Phases that cannot be computed (no anchor and no valid predecessor chain) are
 * returned with their original dates unchanged.
 */
export function computeSchedule(phases: DevPhase[]): DevPhase[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const computed = new Map<string, { start: string; end: string }>();

  function computeOne(phaseId: string, visiting: Set<string>): { start: string; end: string } | null {
    if (computed.has(phaseId)) {
      return computed.get(phaseId)!;
    }

    if (visiting.has(phaseId)) {
      // Cycle detected — treat as anchor (use its own start_date if any)
      const phase = byId.get(phaseId);
      if (phase?.start_date) {
        const duration = phase.duration_days ?? 30;
        const result = {
          start: phase.start_date,
          end: addDays(phase.start_date, Math.max(0, duration - 1)),
        };
        computed.set(phaseId, result);
        return result;
      }
      return null;
    }

    const phase = byId.get(phaseId);
    if (!phase) return null;

    visiting.add(phaseId);

    let start: string | null = null;

    // Linked to predecessor: start = predecessor.end + lag_days + 1
    if (phase.predecessor_id) {
      const pred = computeOne(phase.predecessor_id, visiting);
      if (pred) {
        start = addDays(pred.end, (phase.lag_days ?? 0) + 1);
      }
    }

    // Fall back to manually anchored start_date
    if (!start && phase.start_date) {
      start = phase.start_date;
    }

    visiting.delete(phaseId);

    if (!start) {
      // Cannot compute — leave existing dates alone
      return null;
    }

    const duration = phase.duration_days ?? 30;
    const end = addDays(start, Math.max(0, duration - 1));

    const result = { start, end };
    computed.set(phaseId, result);
    return result;
  }

  // Compute every phase
  for (const phase of phases) {
    computeOne(phase.id, new Set());
  }

  // Apply computed dates to phase records
  return phases.map((p) => {
    const c = computed.get(p.id);
    if (!c) return p;
    return { ...p, start_date: c.start, end_date: c.end };
  });
}

/**
 * Returns the list of phase IDs that would form a cycle if `predecessorId` were
 * set as the predecessor of `phaseId`. Returns empty array if no cycle.
 */
export function detectCycle(
  phases: DevPhase[],
  phaseId: string,
  predecessorId: string
): boolean {
  if (phaseId === predecessorId) return true;
  const byId = new Map(phases.map((p) => [p.id, p]));
  // Walk up from predecessor — if we hit phaseId, it's a cycle
  let current: string | null = predecessorId;
  const visited = new Set<string>();
  while (current) {
    if (current === phaseId) return true;
    if (visited.has(current)) return true; // pre-existing cycle
    visited.add(current);
    const p = byId.get(current);
    current = p?.predecessor_id ?? null;
  }
  return false;
}

/**
 * Compute and persist the schedule. Diffs the computed dates against current
 * dates and only writes the ones that changed.
 */
export function diffComputedDates(
  original: DevPhase[],
  computed: DevPhase[]
): Array<{ id: string; start_date: string | null; end_date: string | null }> {
  const origById = new Map(original.map((p) => [p.id, p]));
  const updates: Array<{ id: string; start_date: string | null; end_date: string | null }> = [];
  for (const c of computed) {
    const o = origById.get(c.id);
    if (!o) continue;
    if (o.start_date !== c.start_date || o.end_date !== c.end_date) {
      updates.push({ id: c.id, start_date: c.start_date, end_date: c.end_date });
    }
  }
  return updates;
}
