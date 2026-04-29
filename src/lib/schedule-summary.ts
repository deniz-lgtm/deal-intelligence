/**
 * Schedule summary for prose generators.
 *
 * Compresses the deal's full `deal_dev_phases` set (potentially 60+ rows
 * across three tracks) into a structured, narrative-friendly snapshot
 * the IC prose generator can reference: track-level start/end + duration
 * + budget + % complete, plus a short list of root phases per track.
 *
 * Numbers come from the same DevPhase rows the schedule UI renders.
 * Children fold into their parent for the per-track headline numbers
 * (rolled-up budget, weighted % complete) so the LLM doesn't see noise.
 */
import {
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type ScheduleTrack,
} from "./types";

export interface ScheduleTrackSummary {
  /** Slug identifier for the track. */
  track: ScheduleTrack;
  /** Human label, e.g. "Acquisition". */
  label: string;
  /** Number of root phases in the track (children fold into parents). */
  phaseCount: number;
  /** Earliest start_date across all phases on this track. */
  startDate: string | null;
  /** Latest end_date across all phases on this track. */
  endDate: string | null;
  /** Calendar days between startDate and endDate. Null if either bound missing. */
  durationDays: number | null;
  /** Sum of budget across all rows (roots + children) on this track. */
  totalBudget: number;
  /** Duration-weighted average % complete, rounded to nearest int. */
  pctComplete: number;
  /**
   * Root-phase milestones. Up to ~12 entries — enough for prose to cite
   * specific milestones without overwhelming the prompt.
   */
  milestones: Array<{
    label: string;
    startDate: string | null;
    endDate: string | null;
    durationDays: number | null;
    pctComplete: number;
    budget: number | null;
  }>;
}

export interface ScheduleSummary {
  totalBudget: number;
  /** Earliest start across all tracks. */
  earliestStart: string | null;
  /** Latest end across all tracks. */
  latestEnd: string | null;
  /** One entry per track that has phases. Tracks with zero phases are omitted. */
  tracks: ScheduleTrackSummary[];
}

const MILESTONE_LIMIT = 12;

/**
 * Summarize the supplied phases. Pass the full phase list for the deal
 * (across tracks). Empty / missing phases yield an empty summary that
 * the prose generator handles gracefully.
 */
export function summarizeSchedule(
  phases: ReadonlyArray<DevPhase>
): ScheduleSummary {
  const empty: ScheduleSummary = {
    totalBudget: 0,
    earliestStart: null,
    latestEnd: null,
    tracks: [],
  };
  if (!phases || phases.length === 0) return empty;

  const tracks: ScheduleTrack[] = ["acquisition", "development", "construction"];
  const trackSummaries: ScheduleTrackSummary[] = [];
  let earliestStart: string | null = null;
  let latestEnd: string | null = null;
  let totalBudget = 0;

  for (const t of tracks) {
    const slice = phases.filter((p) => (p.track ?? "development") === t);
    if (slice.length === 0) continue;

    const dates = slice
      .map((p) => p.start_date)
      .filter((d): d is string => Boolean(d));
    const ends = slice
      .map((p) => p.end_date)
      .filter((d): d is string => Boolean(d));
    const startDate = dates.length > 0 ? dates.sort()[0] : null;
    const endDate = ends.length > 0 ? ends.sort()[ends.length - 1] : null;
    const durationDays =
      startDate && endDate
        ? Math.max(
            0,
            Math.round(
              (new Date(endDate).getTime() - new Date(startDate).getTime()) /
                86400000
            )
          )
        : null;

    const trackBudget = slice.reduce(
      (s, p) => s + (p.budget != null ? Number(p.budget) : 0),
      0
    );
    totalBudget += trackBudget;

    // Duration-weighted % complete. Phases without a duration contribute
    // nothing; if no phase has a duration we fall back to the simple
    // mean so the metric isn't NaN.
    let weightSum = 0;
    let weightedSum = 0;
    for (const p of slice) {
      const w = p.duration_days || 0;
      if (w > 0) {
        weightSum += w;
        weightedSum += w * (p.pct_complete ?? 0);
      }
    }
    const pctComplete =
      weightSum > 0
        ? Math.round(weightedSum / weightSum)
        : Math.round(
            slice.reduce((s, p) => s + (p.pct_complete ?? 0), 0) / slice.length
          );

    if (startDate && (!earliestStart || startDate < earliestStart)) {
      earliestStart = startDate;
    }
    if (endDate && (!latestEnd || endDate > latestEnd)) {
      latestEnd = endDate;
    }

    const roots = slice
      .filter((p) => !p.parent_phase_id)
      .sort((a, b) => a.sort_order - b.sort_order);

    const milestones = roots.slice(0, MILESTONE_LIMIT).map((p) => ({
      label: p.label,
      startDate: p.start_date ?? null,
      endDate: p.end_date ?? null,
      durationDays: p.duration_days ?? null,
      pctComplete: p.pct_complete ?? 0,
      budget: p.budget != null ? Number(p.budget) : null,
    }));

    trackSummaries.push({
      track: t,
      label: SCHEDULE_TRACK_LABELS[t],
      phaseCount: roots.length,
      startDate,
      endDate,
      durationDays,
      totalBudget: trackBudget,
      pctComplete,
      milestones,
    });
  }

  return {
    totalBudget,
    earliestStart,
    latestEnd,
    tracks: trackSummaries,
  };
}
