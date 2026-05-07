// Numeric mappers: turn a raw input value into a 0–100 subscore.
//
// Two primitives:
//   - `piecewise`: anchored thresholds with linear interpolation between them.
//     Each anchor is `[rawValue, score]`. Anchors must be sorted ascending by
//     rawValue. Values below the first anchor clamp to the first score, above
//     the last anchor clamp to the last score.
//   - `bucket`: discrete enum → score table.
//
// Designed so factor definitions can declare a mapper in one line and the
// engine never has to embed scoring logic itself.

export type Anchor = readonly [raw: number, score: number];

/**
 * Linearly interpolate `raw` against an ordered list of (rawValue, score)
 * anchors. Out-of-range values clamp to the nearest anchor.
 */
export function piecewise(anchors: readonly Anchor[]): (raw: number) => number {
  if (anchors.length === 0) throw new Error("piecewise: need at least one anchor");
  // Defensive copy so callers can pass `as const` literals safely.
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  return (raw: number) => {
    if (!isFinite(raw)) return sorted[0][1];
    if (raw <= sorted[0][0]) return clamp(sorted[0][1]);
    const last = sorted[sorted.length - 1];
    if (raw >= last[0]) return clamp(last[1]);
    for (let i = 1; i < sorted.length; i++) {
      const [rPrev, sPrev] = sorted[i - 1];
      const [rNext, sNext] = sorted[i];
      if (raw <= rNext) {
        const t = rNext === rPrev ? 0 : (raw - rPrev) / (rNext - rPrev);
        return clamp(sPrev + t * (sNext - sPrev));
      }
    }
    return clamp(last[1]);
  };
}

/**
 * Discrete bucket mapper: lookup `key` in `table`. Returns `defaultScore`
 * (default 50) when the key isn't present.
 */
export function bucket<K extends string>(
  table: Record<K, number>,
  defaultScore = 50
): (key: K | string | null | undefined) => number {
  return (key) => {
    if (key == null) return defaultScore;
    const v = (table as Record<string, number>)[key];
    return v == null ? defaultScore : clamp(v);
  };
}

export function clamp(score: number, lo = 0, hi = 100): number {
  if (!isFinite(score)) return lo;
  return Math.max(lo, Math.min(hi, score));
}

/**
 * Inverse mapper: lower raw values are better (e.g. premium-to-market rent).
 * Wraps `piecewise` with descending semantics — anchors still listed ascending
 * by raw, but score should also be ascending if "lower raw = lower score".
 * Provided as a convenience so factor authors don't have to remember which
 * direction is "good" — they just spell out the curve.
 */
export const linear = piecewise;
