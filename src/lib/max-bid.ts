// Goal-seek solver — reverse-underwrite against multiple hurdle sets.
//
// Supports three solve modes:
//   1. "price"    — max purchase price (or land cost for ground-up)
//   2. "rents"    — min rent multiplier (vs. current market rents) the
//                   deal can sustain while clearing hurdles
//   3. "exit_cap" — max exit cap rate the deal can sustain before
//                   hurdles break
//
// All three reuse the same hurdle engine (IRR / EM / CoC / DSCR) and
// the same page-local calc() so solver numbers always match the UW
// page's Returns panel. Bisection works for all three because each of
// the three independent variables produces monotonic returns.

import { calc as libCalc, type UWData } from "@/lib/underwriting-calc";

export type CalcMode = "commercial" | "multifamily" | "student_housing";

/**
 * The underwriting page ships its own local `calc` implementation that's
 * diverged from the shared lib over time (adds commercial_tenants
 * revenue, itemized other_income_items, etc.). Callers that need the
 * solver to match what the page's Returns panel displays should pass
 * that local calc in here. Tests and stand-alone callers get the lib's
 * calc by default.
 */
export type CalcFn = (d: UWData, mode: CalcMode) => ReturnType<typeof libCalc>;

/** What we're solving for. */
export type SolveMode = "price" | "rents" | "exit_cap";

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

export interface MetricsSnapshot {
  irr: number;
  equity_multiple: number;
  coc: number;
  dscr: number;
  total_cost: number;
  equity: number;
  noi: number;
  cap_rate: number;
}

export type BindingConstraint = "irr" | "equity_multiple" | "coc" | "dscr" | "none";

export interface SolveResult {
  solve_mode: SolveMode;
  /**
   * The solved value in native units:
   *   price    — dollars
   *   rents    — multiplier (1.0 = current market rents)
   *   exit_cap — percent (e.g. 6.25 means 6.25%)
   */
  solved_value: number;
  /** Metrics produced by calc() when the solved_value is applied. */
  metrics_at_solved: MetricsSnapshot;
  binding_constraint: BindingConstraint;
  /** Sensitivity: re-solve with each twist applied to a clone of the input. */
  sensitivity: Array<{
    label: string;
    solved_value: number;
    delta: number;
  }>;
  /** True iff at least one value inside the search range cleared all hurdles. */
  any_pass: boolean;
}

/** Back-compat alias — existing callers can keep using MaxBidResult. */
export interface MaxBidResult {
  max_bid: number;
  metrics_at_max_bid: MetricsSnapshot;
  binding_constraint: BindingConstraint;
  sensitivity: Array<{ label: string; max_bid: number; delta: number }>;
}

// Bracketed bisection IRR. Much slower than Newton-Raphson but
// converges on pathological inputs — at very low basis the underlying
// deal can return 500%+ IRR, which overshoots a Newton iteration and
// falls into NaN territory (the old version returned 0 there, which
// makes the max-bid solver think the deal is failing the hurdle when
// it's actually clearing it by miles).
function xirr(cashFlows: number[]): number {
  if (cashFlows.length < 2) return 0;
  const npv = (rate: number): number => {
    let sum = 0;
    for (let j = 0; j < cashFlows.length; j++) {
      sum += cashFlows[j] / Math.pow(1 + rate, j);
    }
    return sum;
  };
  if (cashFlows[0] >= 0) return 0;
  let lo = -0.99;
  let hi = 10;
  let npvLo = npv(lo);
  let npvHi = npv(hi);
  if (npvLo > 0 && npvHi > 0) return hi * 100;
  if (npvLo < 0 && npvHi < 0) return 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < 1) break;
    if ((npvMid > 0 && npvLo > 0) || (npvMid < 0 && npvLo < 0)) {
      lo = mid; npvLo = npvMid;
    } else {
      hi = mid; npvHi = npvMid;
    }
    if (hi - lo < 1e-6) break;
  }
  return ((lo + hi) / 2) * 100;
}

function computeMetrics(d: UWData, mode: CalcMode, calc: CalcFn = libCalc): MetricsSnapshot {
  const m = calc(d, mode);
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
    // Match the "Returns — Stabilized" panel on the UW page, which uses
    // stabilizedCoC / stabilizedDSCR (post-refi or post-IO) — not the
    // year-1 coc / dscr which collapse during lease-up.
    coc: m.stabilizedCoC,
    dscr: m.stabilizedDSCR,
    total_cost: m.totalCost,
    equity: m.equity,
    noi: m.proformaNOI,
    cap_rate: m.proformaCapRate,
  };
}

export function getMetricsAt(d: UWData, mode: CalcMode, calc: CalcFn = libCalc) {
  return computeMetrics(d, mode, calc);
}

export function getMetricsAtZeroBasis(d: UWData, mode: CalcMode, calc: CalcFn = libCalc) {
  const zeroD = d.development_mode ? { ...d, land_cost: 0 } : { ...d, purchase_price: 0 };
  return computeMetrics(zeroD, mode, calc);
}

function meetsTargets(
  metrics: MetricsSnapshot,
  targets: MaxBidTargets,
  hasFinancing: boolean
): { passes: boolean; binding: BindingConstraint } {
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

// ── Per-mode variable setters + bisection framing ───────────────────────────
// Each solve mode maps a scalar "trial value" into a UWData mutation.
// The bisection semantics also differ:
//   price:    passing region is LOW, searching for the MAX passing value
//   rents:    passing region is HIGH, searching for the MIN passing value
//   exit_cap: passing region is LOW, searching for the MAX passing value

interface ModeConfig {
  /** Apply the trial value to a UWData clone. */
  setValue: (d: UWData, v: number) => UWData;
  /** Bracket the search range. */
  lowBound: (d: UWData) => number;
  highBound: (d: UWData) => number;
  /** Which side of the bracket passes first? */
  passingSide: "low" | "high";
  /** Convergence tolerance in the variable's native units. */
  tolerance: number;
  /** Sensible default used when the search never converges — what to return. */
  fallbackValue: number;
}

function scaleRents(d: UWData, k: number): UWData {
  return {
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
  };
}

function modeConfigFor(mode: SolveMode): ModeConfig {
  switch (mode) {
    case "price":
      return {
        setValue: (d, v) => d.development_mode
          ? { ...d, land_cost: Math.max(0, v) }
          : { ...d, purchase_price: Math.max(0, v) },
        lowBound: () => 0,
        highBound: (d) => {
          const current = d.development_mode ? (d.land_cost || 0) : (d.purchase_price || 0);
          return Math.max(current * 4, 50_000_000);
        },
        passingSide: "low",
        tolerance: 1000,
        fallbackValue: 0,
      };
    case "rents":
      return {
        setValue: (d, v) => scaleRents(d, Math.max(0.01, v)),
        lowBound: () => 0.1,   // 10% of current market — floor
        highBound: () => 5.0,  // 500% of current market — should cover most value-add cases
        passingSide: "high",
        tolerance: 0.001,      // 0.1% multiplier
        fallbackValue: 5.0,
      };
    case "exit_cap":
      return {
        setValue: (d, v) => ({ ...d, exit_cap_rate: Math.max(0.25, v) }),
        lowBound: () => 1.0,
        highBound: () => 20.0,
        passingSide: "low",
        tolerance: 0.01,       // 1 bp
        fallbackValue: 20.0,
      };
  }
}

export function solve(
  data: UWData,
  targets: MaxBidTargets,
  calcMode: CalcMode,
  solveMode: SolveMode,
  calc: CalcFn = libCalc,
  // Internal flag: the sensitivity sweep re-calls solve() under
  // tweaked inputs. Without suppressing the inner sweep each recursive
  // call kicks off its own ~5x recursion → stack overflow.
  _skipSensitivity: boolean = false,
): SolveResult {
  const cfg = modeConfigFor(solveMode);

  // Expand the bracket if the "passing" end still passes — we want the
  // search range to straddle the pass/fail boundary.
  let lo = cfg.lowBound(data);
  let hi = cfg.highBound(data);
  for (let i = 0; i < 3; i++) {
    const endCheck = cfg.passingSide === "low" ? hi : lo;
    const endMetrics = computeMetrics(cfg.setValue(data, endCheck), calcMode, calc);
    const { passes } = meetsTargets(endMetrics, targets, data.has_financing);
    // If the supposedly-failing end still passes, the solver has no
    // meaningful boundary inside the current bracket — widen the range.
    if (!passes) break;
    if (cfg.passingSide === "low") hi *= 2;
    else lo /= 2;
  }

  // Bisect between [lo, hi]. The passing side starts as the "known good"
  // endpoint; each iteration shrinks toward the pass/fail boundary.
  let lastBinding: BindingConstraint = "none";
  let anyPass = false;
  let solvedValue = cfg.fallbackValue;

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const metrics = computeMetrics(cfg.setValue(data, mid), calcMode, calc);
    const { passes, binding } = meetsTargets(metrics, targets, data.has_financing);
    if (passes) {
      anyPass = true;
      // Passing side wins → move the "passing" boundary toward mid.
      // For passingSide=low we want max passing → push `lo` up.
      // For passingSide=high we want min passing → push `hi` down.
      if (cfg.passingSide === "low") {
        lo = mid;
        solvedValue = mid;
      } else {
        hi = mid;
        solvedValue = mid;
      }
    } else {
      // Failing side → move the "failing" boundary toward mid.
      if (cfg.passingSide === "low") hi = mid;
      else lo = mid;
      lastBinding = binding;
    }
    if (Math.abs(hi - lo) < cfg.tolerance) break;
  }

  // No trial value cleared the hurdles — the deal is broken for this
  // solve mode. Surface the binding constraint at the "best" endpoint.
  if (!anyPass) {
    const bestEnd = cfg.passingSide === "low" ? cfg.lowBound(data) : cfg.highBound(data);
    const bestMetrics = computeMetrics(cfg.setValue(data, bestEnd), calcMode, calc);
    return {
      solve_mode: solveMode,
      solved_value: bestEnd,
      metrics_at_solved: bestMetrics,
      binding_constraint: lastBinding,
      sensitivity: [],
      any_pass: false,
    };
  }

  const finalMetrics = computeMetrics(cfg.setValue(data, solvedValue), calcMode, calc);

  // Sensitivity: re-solve the same goal-seek under each tweaked input.
  // Skip the internal recursion to avoid stack blow-up.
  const sensitivity: SolveResult["sensitivity"] = [];
  if (_skipSensitivity) {
    return {
      solve_mode: solveMode,
      solved_value: solvedValue,
      metrics_at_solved: finalMetrics,
      binding_constraint: lastBinding,
      sensitivity,
      any_pass: true,
    };
  }

  const twist = (label: string, mutate: (d: UWData) => UWData) => {
    const res = solve(mutate(data), targets, calcMode, solveMode, calc, true);
    return { label, solved_value: res.solved_value, delta: res.solved_value - solvedValue };
  };

  // Rent + exit-cap sensitivities apply for all three modes. For "rents"
  // mode the "Rents +/-5%" twist is circular — skip it there. Likewise
  // "Exit cap +/-50bps" is redundant under "exit_cap" solve.
  if (solveMode !== "rents") {
    sensitivity.push(twist("Rents −5%", d => scaleRents(d, 0.95)));
    sensitivity.push(twist("Rents +5%", d => scaleRents(d, 1.05)));
  }
  if (solveMode !== "exit_cap") {
    sensitivity.push(twist("Exit cap +50 bps", d => ({ ...d, exit_cap_rate: d.exit_cap_rate + 0.5 })));
    sensitivity.push(twist("Exit cap −50 bps", d => ({ ...d, exit_cap_rate: Math.max(0.25, d.exit_cap_rate - 0.5) })));
  }
  if (data.has_financing) {
    sensitivity.push(twist("Interest rate +100 bps", d => ({ ...d, acq_interest_rate: d.acq_interest_rate + 1 })));
  }

  return {
    solve_mode: solveMode,
    solved_value: solvedValue,
    metrics_at_solved: finalMetrics,
    binding_constraint: lastBinding,
    sensitivity,
    any_pass: true,
  };
}

/** Back-compat shim — thin wrapper that routes to the generalized solver.
 *  Kept so any other consumer of solveMaxBid continues to work without
 *  touching its call sites. */
export function solveMaxBid(
  data: UWData,
  targets: MaxBidTargets,
  mode: CalcMode = "multifamily",
  calc: CalcFn = libCalc,
  _skipSensitivity: boolean = false,
): MaxBidResult {
  const r = solve(data, targets, mode, "price", calc, _skipSensitivity);
  return {
    max_bid: r.any_pass ? r.solved_value : 0,
    metrics_at_max_bid: r.metrics_at_solved,
    binding_constraint: r.binding_constraint,
    sensitivity: r.sensitivity.map(s => ({
      label: s.label,
      max_bid: s.solved_value,
      delta: s.delta,
    })),
  };
}
