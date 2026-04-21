// Max-Bid solver — reverse-underwriting.
//
// Given a UWData input and a set of return hurdles (IRR, Equity Multiple,
// Cash-on-Cash), find the maximum purchase price (or land cost, in
// ground-up mode) that still clears every hurdle. All three metrics are
// monotonically decreasing in basis, so bisection converges cleanly.
//
// Simplicity goal: reuse the existing `calc()` function from
// underwriting-calc.ts — don't re-implement the proforma. We just sweep
// `purchase_price` / `land_cost` and re-run calc() at each guess.

import { calc, type UWData } from "@/lib/underwriting-calc";

export type CalcMode = "commercial" | "multifamily" | "student_housing";

export interface MaxBidTargets {
  /** Required unlevered-equity IRR, % (e.g. 15 means 15%). */
  target_irr_pct?: number;
  /** Required equity multiple, x (e.g. 2.0 means 2.0x). */
  target_equity_multiple?: number;
  /** Required Year-1 Cash-on-Cash, % (e.g. 6 means 6%). */
  target_coc_pct?: number;
  /** Required DSCR (only checked if financing is enabled). */
  target_dscr?: number;
}

export interface MaxBidResult {
  max_bid: number;
  metrics_at_max_bid: {
    irr: number;
    equity_multiple: number;
    coc: number;
    dscr: number;
    total_cost: number;
    equity: number;
    noi: number;
    cap_rate: number;
  };
  /** Which hurdle was the binding constraint? */
  binding_constraint: "irr" | "equity_multiple" | "coc" | "dscr" | "none";
  /** Sensitivity: re-solve with each twist applied to a clone of the input. */
  sensitivity: Array<{
    label: string;
    max_bid: number;
    delta: number; // dollars vs baseline max_bid
  }>;
}

// Bracketed bisection IRR. Much slower than Newton-Raphson but
// converges on pathological inputs — at very low basis the underlying
// deal can return 500%+ IRR, which overshoots a Newton iteration and
// falls into NaN territory (the old version returned 0 there, which
// makes the max-bid solver think the deal is failing the hurdle when
// it's actually clearing it by miles).
//
// Returns annual rate as percentage, clipped to [-99%, +1000%].
function xirr(cashFlows: number[]): number {
  if (cashFlows.length < 2) return 0;
  const npv = (rate: number): number => {
    let sum = 0;
    for (let j = 0; j < cashFlows.length; j++) {
      sum += cashFlows[j] / Math.pow(1 + rate, j);
    }
    return sum;
  };
  // Need an initial outflow + at least one positive return for a
  // meaningful IRR. If the deal is flat-negative there's no root in
  // (-1, ∞); return 0 (same as the legacy behaviour).
  if (cashFlows[0] >= 0) return 0;
  let lo = -0.99;   // -99% floor — below this the NPV blows up
  let hi = 10;      // 1000% ceiling — any deal that returns more is "infinitely good"
  let npvLo = npv(lo);
  let npvHi = npv(hi);
  // If NPV is positive at both ends of the bracket the deal's return
  // lives above our ceiling — report the ceiling. If negative at both
  // ends, nothing solves (edge case); return 0.
  if (npvLo > 0 && npvHi > 0) return hi * 100;
  if (npvLo < 0 && npvHi < 0) return 0;
  // Invariant from here: sign change exists between lo and hi.
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < 1) break; // close enough — NPV is in $
    if ((npvMid > 0 && npvLo > 0) || (npvMid < 0 && npvLo < 0)) {
      lo = mid; npvLo = npvMid;
    } else {
      hi = mid; npvHi = npvMid;
    }
    if (hi - lo < 1e-6) break;
  }
  return ((lo + hi) / 2) * 100;
}

function computeMetrics(d: UWData, mode: CalcMode) {
  const m = calc(d, mode);
  // Match the UW page's Compare Scenarios / Wizard IRR pattern exactly
  // — use all 5 yearlyDCF rows and fold exitEquity into the last one —
  // so the Max-Bid answer matches what the page's own goal-seek would
  // return. (calc() always emits 5 rows regardless of hold_period_years.)
  let irr = 0;
  if (m.equity > 0 && m.yearlyDCF.length > 0) {
    const flows: number[] = [-m.equity, ...m.yearlyDCF.map((yr, i) =>
      i === m.yearlyDCF.length - 1 ? yr.cashFlow + m.exitEquity : yr.cashFlow
    )];
    irr = xirr(flows);
  }
  return {
    irr,
    equity_multiple: m.em,
    coc: m.coc,
    dscr: m.dscr,
    total_cost: m.totalCost,
    equity: m.equity,
    noi: m.proformaNOI,
    cap_rate: m.proformaCapRate,
  };
}

/** Public export so the UI panel can render current-basis metrics. */
export function getMetricsAt(d: UWData, mode: CalcMode) {
  return computeMetrics(d, mode);
}

/** Public export — solve the deal at land/purchase price = 0. Used by the
 *  UI to explain what IRR is achievable in the best case when the solver
 *  reports "Deal fails at any price". */
export function getMetricsAtZeroBasis(d: UWData, mode: CalcMode) {
  const zeroD = d.development_mode ? { ...d, land_cost: 0 } : { ...d, purchase_price: 0 };
  return computeMetrics(zeroD, mode);
}

function meetsTargets(
  metrics: ReturnType<typeof computeMetrics>,
  targets: MaxBidTargets,
  hasFinancing: boolean
): { passes: boolean; binding: MaxBidResult["binding_constraint"] } {
  // For bisection direction: at the max bid the binding constraint is
  // satisfied with equality. Any twist that pushes the metric lower
  // means the price was too high.
  if (targets.target_irr_pct !== undefined && metrics.irr < targets.target_irr_pct) {
    return { passes: false, binding: "irr" };
  }
  if (targets.target_equity_multiple !== undefined && metrics.equity_multiple < targets.target_equity_multiple) {
    return { passes: false, binding: "equity_multiple" };
  }
  if (targets.target_coc_pct !== undefined && metrics.coc < targets.target_coc_pct) {
    return { passes: false, binding: "coc" };
  }
  if (hasFinancing && targets.target_dscr !== undefined && metrics.dscr < targets.target_dscr) {
    return { passes: false, binding: "dscr" };
  }
  return { passes: true, binding: "none" };
}

function setPrice(d: UWData, price: number): UWData {
  // In ground-up mode the "bid" is really the land cost; everything
  // else (hard/soft costs) stays constant per the developer's program.
  if (d.development_mode) return { ...d, land_cost: Math.max(0, price) };
  return { ...d, purchase_price: Math.max(0, price) };
}

function basePrice(d: UWData): number {
  return d.development_mode ? (d.land_cost || 0) : (d.purchase_price || 0);
}

/**
 * Bisection over purchase price. Returns the max price that still clears
 * every target. Tolerance: $1,000.
 *
 * Lower bound is $0 (deal is free), upper bound is 4x the current basis
 * (or $50M if there is no basis yet). If even $0 doesn't clear the
 * targets, returns 0 with `binding_constraint` set to whichever hurdle
 * failed — that means the deal's expenses/debt structure is
 * fundamentally broken and no basis can save it.
 */
export function solveMaxBid(
  data: UWData,
  targets: MaxBidTargets,
  mode: CalcMode = "multifamily",
  // Internal flag: the sensitivity sweep re-calls solveMaxBid under
  // tweaked inputs. Without suppressing the inner sweep each recursive
  // call kicks off its own ~5x recursion → stack overflow. External
  // callers should leave this false.
  _skipSensitivity: boolean = false,
): MaxBidResult {
  // Determine search bounds. We need enough headroom to find the max:
  // start with 4x the current basis, or a generous $50M floor when the
  // deal hasn't been priced yet. If even that ceiling still passes the
  // hurdles, double up to 3 times (→ $400M cap) before giving up.
  const startBasis = basePrice(data);
  let upper = Math.max(startBasis * 4, 50_000_000);
  for (let i = 0; i < 3; i++) {
    const hi = computeMetrics(setPrice(data, upper), mode);
    const { passes } = meetsTargets(hi, targets, data.has_financing);
    if (!passes) break;
    upper *= 2;
  }

  // Bisect between $0 and the ceiling. We do NOT short-circuit on $0 —
  // the bisection handles it naturally. If the deal truly can't clear
  // the hurdles at any price, the loop converges on $0 and we flag the
  // binding constraint via lastBinding.
  let lo = 0;
  let hi = upper;
  let lastBinding: MaxBidResult["binding_constraint"] = "none";
  let anyPass = false;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const metrics = computeMetrics(setPrice(data, mid), mode);
    const { passes, binding } = meetsTargets(metrics, targets, data.has_financing);
    if (passes) {
      lo = mid;
      anyPass = true;
    } else {
      hi = mid;
      lastBinding = binding;
    }
    if (hi - lo < 1000) break;
  }

  // If nothing in [$0, ceiling] cleared the hurdles, the deal is
  // fundamentally broken at any basis — return 0 and surface the
  // binding constraint from the final failure.
  if (!anyPass) {
    const zeroMetrics = computeMetrics(setPrice(data, 0), mode);
    return {
      max_bid: 0,
      metrics_at_max_bid: zeroMetrics,
      binding_constraint: lastBinding,
      sensitivity: [],
    };
  }

  const finalPrice = lo;
  const finalMetrics = computeMetrics(setPrice(data, finalPrice), mode);

  // Sensitivity: re-solve under each twist. Each twist is a small UWData
  // mutation; bisection is cheap so we just run it 5x. Returns Δ vs the
  // baseline max_bid so the UI can render "+$X" / "-$X". Recursive call
  // passes _skipSensitivity=true so we don't re-sweep forever.
  const sensitivity: MaxBidResult["sensitivity"] = [];
  if (_skipSensitivity) {
    return {
      max_bid: finalPrice,
      metrics_at_max_bid: finalMetrics,
      binding_constraint: lastBinding,
      sensitivity,
    };
  }
  const twist = (label: string, mutate: (d: UWData) => UWData) => {
    const res = solveMaxBid(mutate(data), targets, mode, true);
    return { label, max_bid: res.max_bid, delta: res.max_bid - finalPrice };
  };

  // Rents ±5%: scale every unit group's rents uniformly.
  const scaleRents = (d: UWData, k: number): UWData => ({
    ...d,
    unit_groups: d.unit_groups.map(g => ({
      ...g,
      current_rent_per_unit: g.current_rent_per_unit * k,
      market_rent_per_unit: g.market_rent_per_unit * k,
      current_rent_per_sf: g.current_rent_per_sf * k,
      market_rent_per_sf: g.market_rent_per_sf * k,
      current_rent_per_bed: g.current_rent_per_bed * k,
      market_rent_per_bed: g.market_rent_per_bed * k,
    })),
  });

  sensitivity.push(twist("Rents −5%", d => scaleRents(d, 0.95)));
  sensitivity.push(twist("Rents +5%", d => scaleRents(d, 1.05)));
  sensitivity.push(twist("Exit cap +50 bps", d => ({ ...d, exit_cap_rate: d.exit_cap_rate + 0.5 })));
  sensitivity.push(twist("Exit cap −50 bps", d => ({ ...d, exit_cap_rate: Math.max(0.25, d.exit_cap_rate - 0.5) })));
  if (data.has_financing) {
    sensitivity.push(twist("Interest rate +100 bps", d => ({ ...d, acq_interest_rate: d.acq_interest_rate + 1 })));
  }

  return {
    max_bid: finalPrice,
    metrics_at_max_bid: finalMetrics,
    binding_constraint: lastBinding,
    sensitivity,
  };
}
