// Random sampling primitives for the Monte Carlo module.
//
// Everything is built on a single seeded PRNG (mulberry32) so a given seed
// produces identical draws across runs — required for reproducibility of
// stored MC summaries.
//
// We sample everything in standard-normal space first (so we can apply a
// Cholesky transform for correlation), then transform each marginal to its
// target distribution.

export type Rng = () => number;

/** Mulberry32 — small, fast, good enough for MC; seedable. */
export function mulberry32(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw via Box-Muller. */
export function stdNormal(rng: Rng): number {
  const u1 = Math.max(rng(), 1e-300);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Cumulative distribution function for a standard normal (Abramowitz & Stegun 7.1.26). */
export function stdNormalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Transform a standard-normal `z` to a Normal(mu, sigma) clamped to [lo, hi].
 * Hard truncation keeps the math simple — for σ values used in real-estate
 * contexts the truncation correction is negligible (<2% of mass).
 */
export function truncatedNormalFromZ(z: number, mu: number, sigma: number, lo: number, hi: number): number {
  const x = mu + sigma * z;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Triangular distribution given a uniform u ∈ [0,1). Used for vacancy:
 * asymmetric, anchored at `mode` between `low` and `high`. Higher upside in
 * vacancy maps to a longer right tail (mode closer to low).
 */
export function triangularFromU(u: number, low: number, mode: number, high: number): number {
  const span = high - low;
  if (span <= 0) return mode;
  const c = (mode - low) / span;
  if (u < c) return low + Math.sqrt(u * span * (mode - low));
  return high - Math.sqrt((1 - u) * span * (high - mode));
}

/** Map a standard normal to a uniform via its CDF, then to a triangular. */
export function triangularFromZ(z: number, low: number, mode: number, high: number): number {
  const u = stdNormalCdf(z);
  return triangularFromU(u, low, mode, high);
}

// ─── Default distribution parameters (v1) ────────────────────────────────────
//
// These are the calibration starting points referenced in the plan. The
// engine accepts overrides per call, so callers can tighten σ when they have
// stronger market data (e.g. richer LI rent comps).

export interface InputCalibration {
  rentGrowth: { mu: number; sigma: number; lo: number; hi: number };
  vacancy: { lowOffset: number; highOffset: number; mode: number };
  exitCap: { mu: number; sigma: number; loOffset: number; hiOffset: number };
  rate: { mu: number; sigma: number; lo: number; hi: number };
}

export function defaultCalibration(uw: {
  rent_growth_pct?: number;
  vacancy_rate?: number;
  exit_cap_rate?: number;
  acq_interest_rate?: number;
}): InputCalibration {
  const rg = uw.rent_growth_pct ?? 3;
  const v = uw.vacancy_rate ?? 5;
  const ec = uw.exit_cap_rate ?? 5.5;
  const r = uw.acq_interest_rate ?? 6.5;
  return {
    // Rent growth: σ=1.5pp, truncated [-5%, +10%] (annual %)
    rentGrowth: { mu: rg, sigma: 1.5, lo: -5, hi: 10 },
    // Vacancy: triangular with mode at uw value, range [uw-3pp, uw+8pp]
    vacancy: { mode: v, lowOffset: -3, highOffset: 8 },
    // Exit cap: σ=50bps = 0.5pp, truncated [entry-50bps, entry+250bps]
    exitCap: { mu: ec, sigma: 0.5, loOffset: -0.5, hiOffset: 2.5 },
    // Rate: σ=75bps. Hard floor 1%, ceiling 15% to avoid degenerate cases.
    rate: { mu: r, sigma: 0.75, lo: 1, hi: 15 },
  };
}

/** Quantile helper: compute p-quantile (0–1) over a sorted array. */
export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

export function meanStd(arr: number[]): { mean: number; std: number } {
  if (arr.length === 0) return { mean: NaN, std: NaN };
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  let sq = 0;
  for (const v of arr) sq += (v - mean) * (v - mean);
  const std = Math.sqrt(sq / Math.max(1, arr.length - 1));
  return { mean, std };
}
