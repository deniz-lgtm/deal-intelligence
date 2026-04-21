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

// Newton-Raphson XIRR. Same convergence path as the underwriting page's
// inline xirr() — duplicated here so the solver can live outside the
// big page component. Returns annual rate as percentage, 0 if it fails.
function xirr(cashFlows: number[]): number {
  if (cashFlows.length < 2) return 0;
  let rate = 0.1;
  for (let i = 0; i < 200; i++) {
    let npv = 0, dNpv = 0;
    for (let j = 0; j < cashFlows.length; j++) {
      const denom = Math.pow(1 + rate, j);
      npv += cashFlows[j] / denom;
      dNpv -= (j * cashFlows[j]) / (denom * (1 + rate));
    }
    if (Math.abs(dNpv) < 1e-12) break;
    const delta = npv / dNpv;
    rate -= delta;
    if (Math.abs(delta) < 1e-8) break;
  }
  if (!isFinite(rate) || rate <= -1) return 0;
  return rate * 100;
}

function computeMetrics(d: UWData, mode: CalcMode) {
  const m = calc(d, mode);
  // Build the levered-equity cash-flow series the same way the Compare
  // Scenarios modal does: initial equity outflow, then per-year cashflow,
  // with the exit proceeds folded into the final year.
  let irr = 0;
  if (m.equity > 0 && m.yearlyDCF.length > 0) {
    // Only the first `hold_period_years` entries matter for IRR. The DCF
    // table is always 5 rows; if the hold is shorter, slice. If longer
    // (rare), fall back to using the 5-year table as-is.
    const hold = Math.min(d.hold_period_years || 5, m.yearlyDCF.length);
    const years = m.yearlyDCF.slice(0, hold);
    const flows: number[] = [-m.equity, ...years.map((yr, i) =>
      i === years.length - 1 ? yr.cashFlow + m.exitEquity : yr.cashFlow
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
  mode: CalcMode = "multifamily"
): MaxBidResult {
  // Determine search bounds. We need enough headroom to find the max:
  // start with 4x the current basis, or a generous $50M floor when the
  // deal hasn't been priced yet.
  const startBasis = basePrice(data);
  const upper0 = Math.max(startBasis * 4, 50_000_000);

  // Before searching, verify $0 passes. If not, return 0.
  const zeroMetrics = computeMetrics(setPrice(data, 0), mode);
  const { passes: zeroPasses, binding: zeroBinding } = meetsTargets(zeroMetrics, targets, data.has_financing);
  if (!zeroPasses) {
    return {
      max_bid: 0,
      metrics_at_max_bid: zeroMetrics,
      binding_constraint: zeroBinding,
      sensitivity: [],
    };
  }

  // Check upper bound. If even the high bound passes the targets, return
  // it — the search space wasn't wide enough. Double and retry once.
  let upper = upper0;
  for (let i = 0; i < 3; i++) {
    const hi = computeMetrics(setPrice(data, upper), mode);
    const { passes } = meetsTargets(hi, targets, data.has_financing);
    if (!passes) break;
    upper *= 2;
  }

  let lo = 0;
  let hi = upper;
  let lastBinding: MaxBidResult["binding_constraint"] = "none";
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const metrics = computeMetrics(setPrice(data, mid), mode);
    const { passes, binding } = meetsTargets(metrics, targets, data.has_financing);
    if (passes) {
      lo = mid;
    } else {
      hi = mid;
      lastBinding = binding;
    }
    if (hi - lo < 1000) break;
  }

  const finalPrice = lo;
  const finalMetrics = computeMetrics(setPrice(data, finalPrice), mode);

  // Sensitivity: re-solve under each twist. Each twist is a small UWData
  // mutation; bisection is cheap so we just run it 3x. Returns Δ vs the
  // baseline max_bid so the UI can render "+$X" / "-$X".
  const twist = (label: string, mutate: (d: UWData) => UWData) => {
    const res = solveMaxBid(mutate(data), targets, mode);
    return { label, max_bid: res.max_bid, delta: res.max_bid - finalPrice };
  };
  const sensitivity: MaxBidResult["sensitivity"] = [];

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
