import { devPhaseQueries } from "@/lib/db";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

/**
 * Recompute CPM dates for one deal after a schedule mutation. The
 * caller wraps this in its own try/catch so a recompute failure (bad
 * date math, a missing CPM column on an old deployment) doesn't
 * surface as "your edit didn't land" — the user's mutation is already
 * committed; CPM fields just stay stale until the next successful pass.
 *
 * Lives in src/lib so route handlers in different folders share the
 * same implementation without one importing the other's `route.ts`
 * (which Next.js's route-handler conventions don't love).
 */
export async function recomputeSchedule(dealId: string): Promise<void> {
  const phases = (await devPhaseQueries.getByDealId(dealId)) as DevPhase[];
  const computed = computeSchedule(phases);
  const updates = diffComputedDates(phases, computed);
  if (updates.length > 0) {
    await devPhaseQueries.bulkUpdateSchedule(updates);
  }
}
