// Thin wrapper around the existing underwriting math (`calc()` in
// `src/lib/underwriting-calc.ts`) that accepts an override bag and returns
// the IRR / EM / DSCR-at-refi outputs the Monte Carlo loop needs.
//
// Why a wrapper instead of re-implementing: `calc()` already encodes the full
// rent-roll, opex, debt-service, refi and exit-equity logic. We mutate four
// fields (rent_growth_pct, vacancy_rate, exit_cap_rate, acq_interest_rate)
// and re-evaluate. For deals with `has_refi=true` we also propagate the
// sampled rate to `refi_rate` since refi failure is the dominant risk under
// rate paths.

import { calc, xirr, type UWData } from "@/lib/underwriting-calc";

export type UnderwritingMode = "commercial" | "multifamily" | "student_housing";

export interface ScenarioOverrides {
  rent_growth_pct?: number; // %
  vacancy_rate?: number;    // %
  exit_cap_rate?: number;   // %
  acq_interest_rate?: number; // %
}

export interface ScenarioResult {
  irrPct: number | null;
  em: number;
  dscrAtRefi: number;
  refiSucceeded: boolean;
}

const REFI_DSCR_THRESHOLD = 1.0;

/**
 * Evaluate the underwriting model under the given overrides. Returns IRR (%),
 * EM, the stabilized DSCR (which doubles as DSCR-at-refi when has_refi), and
 * a boolean for whether the refi (if applicable) clears the 1.0× threshold.
 */
export function evaluateScenario(
  uw: UWData,
  mode: UnderwritingMode,
  overrides: ScenarioOverrides
): ScenarioResult {
  const modUw: UWData = {
    ...uw,
    rent_growth_pct: overrides.rent_growth_pct ?? uw.rent_growth_pct,
    vacancy_rate: overrides.vacancy_rate ?? uw.vacancy_rate,
    exit_cap_rate: overrides.exit_cap_rate ?? uw.exit_cap_rate,
    acq_interest_rate: overrides.acq_interest_rate ?? uw.acq_interest_rate,
    // Propagate rate shock into refi_rate so floating-rate / refi exposure
    // shows up in DSCR-at-refi distributions.
    refi_rate: overrides.acq_interest_rate ?? uw.refi_rate,
  };

  const c = calc(modUw, mode);
  const cashflows = buildCashflowSeries(modUw, c);
  const irrPct = xirr(cashflows);
  const dscrAtRefi = c.stabilizedDSCR;
  const refiSucceeded = !modUw.has_refi || dscrAtRefi >= REFI_DSCR_THRESHOLD;
  return { irrPct, em: c.em, dscrAtRefi, refiSucceeded };
}

/**
 * Reconstruct an equity-up cashflow series for IRR computation. `calc()`
 * stores yearlyDCF for years 1–5 only and aggregates totalCashFlows for
 * holds beyond that — but for IRR we need each year individually.
 *
 * Strategy: reuse yearlyDCF[0..4] for years 1–5; for years 6+ extrapolate
 * using the year-5 cashflow grown by an effective rate (rent growth net of
 * a fixed-cost drag). The terminal year carries the exit equity. This is a
 * faithful approximation for typical 5–10yr holds — `calc()` itself does
 * the same approximation internally for `totalCashFlows`.
 */
function buildCashflowSeries(uw: UWData, c: ReturnType<typeof calc>): number[] {
  const equity = c.equity;
  const holdYrs = Math.max(1, Math.round(uw.hold_period_years || 5));
  const cf: number[] = [-equity];
  const trackedYears = Math.min(5, holdYrs, c.yearlyDCF.length);
  for (let yr = 1; yr <= trackedYears; yr++) {
    cf.push(c.yearlyDCF[yr - 1].cashFlow);
  }
  if (holdYrs > 5) {
    const rg = (uw.rent_growth_pct || 0) / 100;
    const eg = (uw.expense_growth_pct || 0) / 100;
    // Effective net growth: revenue side weighted higher, with opex drag.
    const netGrowth = rg - 0.3 * (eg - rg);
    const lastTracked = c.yearlyDCF[trackedYears - 1]?.cashFlow ?? 0;
    let yrCF = lastTracked;
    for (let yr = 6; yr <= holdYrs; yr++) {
      yrCF = yrCF * (1 + netGrowth);
      cf.push(yrCF);
    }
  }
  // Terminal: last year's cashflow already in cf; add exit equity to it.
  cf[cf.length - 1] += c.exitEquity;
  return cf;
}
