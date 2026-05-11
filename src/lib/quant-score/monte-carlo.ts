// Monte Carlo orchestrator.
//
// Runs N trials over the underwriting model with rent growth, vacancy, exit
// cap, and rate sampled from calibrated distributions, with a small
// correlation matrix applied via Cholesky. Returns the percentiles +
// probability statistics persisted to `deal_scores.mc_distribution`.

import {
  defaultCalibration,
  meanStd,
  mulberry32,
  quantileSorted,
  stdNormal,
  triangularFromZ,
  truncatedNormalFromZ,
  type Rng,
} from "./distributions";
import { CORRELATION_VERSION, DEFAULT_CORRELATION, applyCholesky, cholesky } from "./correlation";
import { evaluateScenario, type UnderwritingMode } from "./uw-evaluator";
import type { UWData } from "@/lib/underwriting-calc";
import type { McDistribution } from "./types";

export interface RunMcOptions {
  trials?: number;
  seed?: number;
  /** Target IRR (%) for prob_hit_target_irr. If null, that field is null in the output. */
  targetIrrPct?: number | null;
  /** Override the default 4×4 correlation matrix. */
  correlation?: number[][];
}

export const DEFAULT_TRIALS = 5000;

/**
 * Run the Monte Carlo simulation.
 *
 * Determinism: same `(uw, mode, opts.seed, opts.trials)` produces an
 * identical `mc_distribution` summary. The seed is recorded in the result
 * so historical runs can be replayed.
 */
export function runMonteCarlo(
  uw: UWData,
  mode: UnderwritingMode,
  opts: RunMcOptions = {}
): McDistribution {
  const trials = opts.trials ?? DEFAULT_TRIALS;
  const seed = opts.seed ?? 0xc0ffee;
  const rng: Rng = mulberry32(seed);

  const cal = defaultCalibration(uw);
  const corr = opts.correlation ?? DEFAULT_CORRELATION;
  const L = cholesky(corr);

  const irrSamples: number[] = [];
  const emSamples: number[] = [];
  let refiFailures = 0;
  let refiTrials = 0;
  let capitalLosses = 0;
  let hits = 0;

  for (let t = 0; t < trials; t++) {
    // Draw 4 independent standard normals, correlate via Cholesky.
    const z = [stdNormal(rng), stdNormal(rng), stdNormal(rng), stdNormal(rng)];
    const zc = applyCholesky(L, z);

    const rentGrowth = truncatedNormalFromZ(
      zc[0],
      cal.rentGrowth.mu,
      cal.rentGrowth.sigma,
      cal.rentGrowth.lo,
      cal.rentGrowth.hi
    );
    const vacancy = triangularFromZ(
      zc[1],
      cal.vacancy.mode + cal.vacancy.lowOffset,
      cal.vacancy.mode,
      cal.vacancy.mode + cal.vacancy.highOffset
    );
    const exitCap = truncatedNormalFromZ(
      zc[2],
      cal.exitCap.mu,
      cal.exitCap.sigma,
      cal.exitCap.mu + cal.exitCap.loOffset,
      cal.exitCap.mu + cal.exitCap.hiOffset
    );
    const rate = truncatedNormalFromZ(zc[3], cal.rate.mu, cal.rate.sigma, cal.rate.lo, cal.rate.hi);

    const result = evaluateScenario(uw, mode, {
      rent_growth_pct: rentGrowth,
      vacancy_rate: Math.max(0, vacancy),
      exit_cap_rate: Math.max(0.5, exitCap),
      acq_interest_rate: Math.max(0.5, rate),
    });

    // Drop trials where IRR didn't converge — keep the EM regardless so
    // P(capital loss) stays well-defined.
    if (result.irrPct != null && isFinite(result.irrPct)) {
      irrSamples.push(result.irrPct);
      if (opts.targetIrrPct != null && result.irrPct >= opts.targetIrrPct) hits++;
    }
    emSamples.push(result.em);
    if (result.em < 1.0) capitalLosses++;
    if (uw.has_refi) {
      refiTrials++;
      if (!result.refiSucceeded) refiFailures++;
    }
  }

  const irrSorted = [...irrSamples].sort((a, b) => a - b);
  const emSorted = [...emSamples].sort((a, b) => a - b);
  const irrValid = irrSorted.length > 0;
  const irrStats = meanStd(irrSamples);
  const emStats = meanStd(emSamples);
  const cvarCount = irrValid ? Math.max(1, Math.floor(0.05 * irrSorted.length)) : 0;
  const cvar = irrValid
    ? irrSorted.slice(0, cvarCount).reduce((s, v) => s + v, 0) / cvarCount
    : null;

  // Risk-adjusted returns. Sharpe uses the 10yr Treasury proxy (4.0%) as
  // the risk-free hurdle and divides excess return by total volatility.
  // Sortino uses the BP target IRR (or risk-free fallback) and divides by
  // downside-only volatility — a more honest measure for asymmetric
  // distributions where right-tail variance shouldn't be penalised.
  const RISK_FREE_PCT = 4.0;
  const sortinoTarget = opts.targetIrrPct ?? RISK_FREE_PCT;
  const sharpe = irrSamples.length > 1 && irrStats.std > 1e-6
    ? (irrStats.mean - RISK_FREE_PCT) / irrStats.std
    : null;
  const downside = irrSamples.filter((r) => r < sortinoTarget);
  let downsideStd: number | null = null;
  if (downside.length >= 2) {
    let sq = 0;
    for (const r of downside) sq += (r - sortinoTarget) ** 2;
    downsideStd = Math.sqrt(sq / downside.length);
  }
  const sortino = downsideStd != null && downsideStd > 1e-6
    ? (irrStats.mean - sortinoTarget) / downsideStd
    : null;

  // Build a binned histogram of the IRR distribution for the UI to render
  // a density chart without re-deriving bins from the raw samples (which
  // we don't persist). 30 bins spanning [P5, P95] padded by ~10% on each
  // tail so all but the most extreme outliers are visible.
  const histogram = buildIrrHistogram(irrSamples, irrSorted);

  return {
    trials,
    irr_valid: irrValid,
    irr_sample_count: irrSamples.length,
    irr: {
      p10: irrValid ? round2(quantileSorted(irrSorted, 0.1)) : 0,
      p25: irrValid ? round2(quantileSorted(irrSorted, 0.25)) : 0,
      p50: irrValid ? round2(quantileSorted(irrSorted, 0.5)) : 0,
      p75: irrValid ? round2(quantileSorted(irrSorted, 0.75)) : 0,
      p90: irrValid ? round2(quantileSorted(irrSorted, 0.9)) : 0,
      mean: irrValid ? round2(irrStats.mean) : 0,
      std: irrValid ? round2(irrStats.std) : 0,
    },
    irr_histogram: histogram,
    em: {
      p10: round2(quantileSorted(emSorted, 0.1)),
      p50: round2(quantileSorted(emSorted, 0.5)),
      p90: round2(quantileSorted(emSorted, 0.9)),
      mean: round2(emStats.mean),
    },
    prob_hit_target_irr:
      opts.targetIrrPct == null || irrSamples.length === 0 ? null : round3(hits / irrSamples.length),
    prob_capital_loss: round3(capitalLosses / Math.max(1, emSamples.length)),
    prob_refi_failure: refiTrials > 0 ? round3(refiFailures / refiTrials) : null,
    expected_shortfall_5pct: cvar == null ? null : round2(cvar),
    sharpe_ratio: sharpe == null ? null : round2(sharpe),
    sortino_ratio: sortino == null ? null : round2(sortino),
    risk_free_pct: RISK_FREE_PCT,
    sortino_target_pct: round2(sortinoTarget),
    target_irr_pct: opts.targetIrrPct == null ? null : round2(opts.targetIrrPct),
    inputs_distribution_summary: {
      rent_growth: {
        mu: cal.rentGrowth.mu,
        sigma: cal.rentGrowth.sigma,
        bounds: [cal.rentGrowth.lo, cal.rentGrowth.hi],
        kind: "normal",
      },
      vacancy: {
        mu: cal.vacancy.mode,
        sigma: (cal.vacancy.highOffset - cal.vacancy.lowOffset) / 4,
        bounds: [cal.vacancy.mode + cal.vacancy.lowOffset, cal.vacancy.mode + cal.vacancy.highOffset],
        kind: "beta",
      },
      exit_cap: {
        mu: cal.exitCap.mu,
        sigma: cal.exitCap.sigma,
        bounds: [cal.exitCap.mu + cal.exitCap.loOffset, cal.exitCap.mu + cal.exitCap.hiOffset],
        kind: "normal",
      },
      rate: {
        mu: cal.rate.mu,
        sigma: cal.rate.sigma,
        bounds: [cal.rate.lo, cal.rate.hi],
        // v1 samples a single rate offset per trial; v2 will support a true AR(1) path.
        kind: "ar1",
      },
    },
    correlation_matrix_version: CORRELATION_VERSION,
    rng_seed: seed,
  };
}

function round2(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * Build a 30-bin histogram from IRR samples. Range is [P5, P95] padded
 * 10% on each side so the bulk of the distribution renders cleanly with
 * tails still visible. Persisted on `mc_distribution.irr_histogram` so
 * the UI can draw a density chart without re-storing 5,000 raw samples.
 */
const HISTOGRAM_BINS = 30;
function buildIrrHistogram(samples: number[], sorted: number[]) {
  if (samples.length === 0) {
    return { bins: [], range: [0, 0] as [number, number], bin_count: 0 };
  }
  const p5 = quantileSorted(sorted, 0.05);
  const p95 = quantileSorted(sorted, 0.95);
  const span = Math.max(1, p95 - p5);
  const lo = p5 - 0.1 * span;
  const hi = p95 + 0.1 * span;
  const binWidth = (hi - lo) / HISTOGRAM_BINS;
  const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
  for (const v of samples) {
    if (v < lo) {
      counts[0]++;
    } else if (v >= hi) {
      counts[HISTOGRAM_BINS - 1]++;
    } else {
      const idx = Math.min(HISTOGRAM_BINS - 1, Math.floor((v - lo) / binWidth));
      counts[idx]++;
    }
  }
  const bins = counts.map((count, i) => ({
    low: round2(lo + i * binWidth),
    high: round2(lo + (i + 1) * binWidth),
    count,
  }));
  return { bins, range: [round2(lo), round2(hi)] as [number, number], bin_count: HISTOGRAM_BINS };
}
