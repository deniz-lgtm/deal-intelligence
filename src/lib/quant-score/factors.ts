// Factor definitions for the quant deal score.
//
// Each factor is a pure declaration: identity, the category it rolls up to,
// the maturity stage at which it's available, an extractor that pulls the
// raw value off the deal/om/uw/li/bp bundle, and a mapper that maps raw → 0-100.
// The compute engine never has to know about specific factors — it just walks
// this list.
//
// Inputs that depend on data we don't yet capture (e.g. GC contract type,
// detailed schedule risk) are simply omitted here. Adding them is additive:
// drop a new entry into `FACTORS` and it shows up in the breakdown
// automatically.

import { piecewise, bucket, clamp } from "./mappers";
import type { FactorCategory, Stage } from "./types";

// ─── Inputs the engine receives ──────────────────────────────────────────────

export interface FactorInputs {
  deal: DealLike | null;
  om: OmLike | null;
  uw: UwLike | null;
  uwCalc: UwCalcLike | null;
  li: LiLike[] | null;
  bp: BusinessPlanLike | null;
  /** Snapshot of the underwriting IRR (computed by the caller). */
  uwIrrPct: number | null;
}

export interface DealLike {
  id: string;
  year_built?: number | null;
}

export interface OmLike {
  cap_rate?: number | null;            // Decimal (0.07 = 7%)
  red_flags?: Array<{ severity?: string; category?: string; description?: string }> | null;
}

export interface UwLike {
  development_mode?: boolean;
  vacancy_rate?: number;               // %, e.g. 5
  rent_growth_pct?: number;            // %
  exit_cap_rate?: number;              // %
  acq_interest_rate?: number;          // %
  acq_io_years?: number;
  acq_ltc?: number;                    // %
  acq_pp_ltv?: number;                 // %
  has_refi?: boolean;
  refi_year?: number;
  hold_period_years?: number;
  hard_cost_per_sf?: number;
  unit_groups?: Array<{ unit_count: number; sf_per_unit: number; bedrooms?: number }>;
  capex_items?: Array<{ quantity: number; cost_per_unit: number }>;
  dev_budget_items?: Array<{ category?: string; pct_basis?: string; pct_value?: number; amount?: number; is_pct?: boolean; label?: string }>;
}

export interface UwCalcLike {
  yoc?: number;                  // % proforma yield on cost
  proformaCapRate?: number;      // %
  marketCapRate?: number;        // % (current NOI / cost)
  proformaNOI?: number;
  totalOpEx?: number;
  proformaGPR?: number;
  acqLoan?: number;
  stabilizedDSCR?: number;
  acqDebt?: number;
  em?: number;
  totalSF?: number;
  totalCost?: number;
  capexTotal?: number;
}

export interface LiLike {
  radius_miles?: number;
  data?: {
    population_growth_pct?: number | null;
    median_household_income?: number | null;
    unemployment_rate?: number | null;
    rent_growth_pct?: number | null;
    home_value_growth_pct?: number | null;
    top_industries?: Array<{ name?: string; share_pct?: number }>;
  } | null;
  projections?: {
    population_growth_5yr_pct?: number | null;
    job_growth_5yr_pct?: number | null;
    rent_growth_5yr_pct?: number | null;
    new_units_pipeline?: number | null;
  } | null;
}

export interface BusinessPlanLike {
  target_irr_min?: number | null;          // %
  target_equity_multiple_min?: number | null;
  hold_period_min?: number | null;
  hold_period_max?: number | null;
}

// ─── Factor shape ────────────────────────────────────────────────────────────

export interface FactorDef {
  id: string;
  category: FactorCategory;
  label: string;
  stage: Stage;
  /** Within-category weight (default 1). */
  weight?: number;
  /** Soft-floor: a 0 score on this factor notches the category by 15. */
  fatalFlaw?: boolean;
  /** Optional source path for the UI breakdown. */
  source?: string;
  /** Pull the raw value off the input bundle. Return null if missing. */
  extract: (i: FactorInputs) => number | null;
  /** Map raw → 0–100. */
  map: (raw: number) => number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : null;
};

const primaryLi = (li: LiLike[] | null): LiLike | null => {
  if (!li || li.length === 0) return null;
  // Prefer the smallest radius (most local).
  const sorted = [...li].sort((a, b) => (a.radius_miles || 999) - (b.radius_miles || 999));
  return sorted[0];
};

// ─── Factors ─────────────────────────────────────────────────────────────────
//
// Mappers use anchor pairs like [-300, 0] meaning "at -300 bps spread,
// score 0". `piecewise` linearly interps between anchors and clamps outside.

export const FACTORS: FactorDef[] = [
  // ── A. Return Quality ──
  {
    id: "yoc_vs_entry_cap_spread",
    category: "return",
    label: "YoC vs Entry Cap Spread (bps)",
    stage: "uw",
    source: "underwriting (yoc) − om.cap_rate",
    extract: ({ uwCalc, om }) => {
      const yoc = num(uwCalc?.yoc);
      const capPct = num(om?.cap_rate) != null ? (num(om?.cap_rate)! * 100) : num(uwCalc?.marketCapRate);
      if (yoc == null || capPct == null) return null;
      return (yoc - capPct) * 100; // bps
    },
    map: piecewise([
      [-100, 0],
      [0, 30],
      [50, 60],
      [100, 80],
      [175, 100],
    ]),
  },
  {
    id: "levered_irr_vs_target",
    category: "return",
    label: "Levered IRR vs Target",
    stage: "uw",
    weight: 1.5,
    source: "computed IRR − business_plan.target_irr_min",
    extract: ({ uwIrrPct, bp }) => {
      const irr = num(uwIrrPct);
      const tgt = num(bp?.target_irr_min);
      if (irr == null || tgt == null) return null;
      return (irr - tgt) * 100; // bps
    },
    map: piecewise([
      [-300, 0],
      [0, 60],
      [200, 80],
      [500, 100],
    ]),
  },
  {
    id: "em_vs_target",
    category: "return",
    label: "Equity Multiple vs Target",
    stage: "uw",
    source: "underwriting.em vs business_plan.target_equity_multiple_min",
    extract: ({ uwCalc, bp }) => {
      const em = num(uwCalc?.em);
      const tgt = num(bp?.target_equity_multiple_min);
      if (em == null || tgt == null) return null;
      return em - tgt;
    },
    map: piecewise([
      [-0.3, 0],
      [-0.1, 30],
      [0, 60],
      [0.3, 80],
      [0.5, 100],
    ]),
  },
  {
    id: "downside_breakeven_occupancy",
    category: "return",
    label: "Breakeven Occupancy %",
    stage: "uw",
    fatalFlaw: true,
    source: "underwriting: (opex + debt service) / GPR",
    extract: ({ uwCalc }) => {
      const opex = num(uwCalc?.totalOpEx);
      const debt = num(uwCalc?.acqDebt);
      const gpr = num(uwCalc?.proformaGPR);
      if (opex == null || debt == null || gpr == null || gpr === 0) return null;
      return ((opex + debt) / gpr) * 100;
    },
    map: piecewise([
      [75, 100],
      [80, 80],
      [85, 60],
      [90, 30],
      [95, 0],
    ]),
  },

  // ── B. Capital Stack ──
  {
    id: "stabilized_dscr",
    category: "capstack",
    label: "Stabilized DSCR",
    stage: "uw",
    weight: 1.5,
    fatalFlaw: true,
    source: "underwriting.stabilizedDSCR",
    extract: ({ uwCalc }) => num(uwCalc?.stabilizedDSCR),
    map: piecewise([
      [1.0, 0],
      [1.2, 30],
      [1.4, 60],
      [1.6, 80],
      [2.0, 100],
    ]),
  },
  {
    id: "debt_yield",
    category: "capstack",
    label: "Debt Yield (NOI / Loan)",
    stage: "uw",
    source: "computed: proformaNOI / acqLoan",
    extract: ({ uwCalc }) => {
      const noi = num(uwCalc?.proformaNOI);
      const loan = num(uwCalc?.acqLoan);
      if (noi == null || loan == null || loan === 0) return null;
      return (noi / loan) * 100;
    },
    map: piecewise([
      [6, 0],
      [7, 30],
      [8, 60],
      [9, 80],
      [12, 100],
    ]),
  },
  {
    id: "leverage",
    category: "capstack",
    label: "LTC / LTV",
    stage: "uw",
    source: "underwriting.acq_ltc / acq_pp_ltv",
    extract: ({ uw }) => {
      const ltc = num(uw?.acq_ltc);
      const ltv = num(uw?.acq_pp_ltv);
      const v = uw?.development_mode ? ltc : ltv;
      return v ?? ltc ?? ltv ?? null;
    },
    map: piecewise([
      [50, 100],
      [65, 80],
      [70, 60],
      [75, 30],
      [85, 0],
    ]),
  },
  {
    id: "refi_exposure",
    category: "capstack",
    label: "Refi vs Hold Buffer",
    stage: "uw",
    source: "underwriting: hold − refi_year",
    extract: ({ uw }) => {
      if (!uw?.has_refi) return 36; // No refi = comfortable.
      const buf = (num(uw.hold_period_years) || 0) - (num(uw.refi_year) || 0);
      return buf * 12;
    },
    map: piecewise([
      [-12, 0],
      [0, 30],
      [12, 50],
      [36, 80],
      [60, 100],
    ]),
  },
  {
    id: "io_share_of_hold",
    category: "capstack",
    label: "IO % of Hold Period",
    stage: "uw",
    source: "underwriting: io_years / hold_period",
    extract: ({ uw }) => {
      const io = num(uw?.acq_io_years) || 0;
      const hold = num(uw?.hold_period_years);
      if (hold == null || hold <= 0) return null;
      return (io / hold) * 100;
    },
    // Modest IO is healthy, very long IO is risky for non-dev deals.
    map: piecewise([
      [0, 70],
      [25, 90],
      [50, 80],
      [75, 50],
      [100, 30],
    ]),
  },

  // ── C. Construction Risk (dev only) ──
  {
    id: "hard_cost_contingency_pct",
    category: "construction",
    label: "Hard Cost Contingency %",
    stage: "uw",
    source: "underwriting.dev_budget_items (contingency)",
    extract: ({ uw, uwCalc }) => {
      if (!uw?.development_mode) return null;
      const items = uw?.dev_budget_items || [];
      const hard = items.filter((i) => i.category === "hard");
      const hardTotal = hard.reduce((s, i) => s + (i.is_pct ? 0 : (i.amount || 0)), 0)
        || (uw?.hard_cost_per_sf || 0) * (uwCalc?.totalSF || 0);
      const contingency = items.filter((i) => /contingency/i.test(i.label || ""));
      let contTotal = 0;
      for (const c of contingency) {
        if (c.is_pct && c.pct_value != null) contTotal += hardTotal * (c.pct_value / 100);
        else contTotal += c.amount || 0;
      }
      if (hardTotal === 0) return null;
      return (contTotal / hardTotal) * 100;
    },
    map: piecewise([
      [0, 0],
      [3, 30],
      [5, 60],
      [7, 80],
      [10, 100],
    ]),
  },
  {
    id: "hard_cost_per_sf",
    category: "construction",
    label: "Hard Cost $/GSF",
    stage: "uw",
    source: "underwriting.hard_cost_per_sf",
    extract: ({ uw }) => {
      if (!uw?.development_mode) return null;
      return num(uw?.hard_cost_per_sf);
    },
    // Inverted — lower is better up to a floor (don't reward unrealistic <100 $/sf).
    map: piecewise([
      [80, 30],
      [150, 100],
      [250, 80],
      [350, 50],
      [500, 20],
      [750, 0],
    ]),
  },

  // ── D. Lease-Up & Rent Risk ──
  {
    id: "tenant_concentration",
    category: "leaseup",
    label: "Top-Tenant SF Share %",
    stage: "uw",
    source: "underwriting.unit_groups (commercial)",
    extract: ({ uw }) => {
      const groups = uw?.unit_groups || [];
      if (groups.length === 0) return null;
      const sfs = groups.map((g) => (g.unit_count || 0) * (g.sf_per_unit || 0));
      const total = sfs.reduce((s, v) => s + v, 0);
      if (total === 0) return null;
      const max = Math.max(...sfs);
      // Only meaningful for commercial/multi-tenant (sf_per_unit set).
      const hasSF = groups.some((g) => (g.sf_per_unit || 0) > 0);
      if (!hasSF) return null;
      return (max / total) * 100;
    },
    map: piecewise([
      [15, 100],
      [30, 80],
      [50, 50],
      [70, 20],
      [100, 0],
    ]),
  },
  {
    id: "rent_growth_vs_inflation",
    category: "leaseup",
    label: "Rent Growth vs Local CPI Proxy",
    stage: "uw",
    source: "underwriting.rent_growth_pct − location.home_value_growth_pct",
    extract: ({ uw, li }) => {
      const rg = num(uw?.rent_growth_pct);
      const cpi = num(primaryLi(li)?.data?.home_value_growth_pct);
      if (rg == null) return null;
      if (cpi == null) return rg;
      return rg - cpi;
    },
    map: piecewise([
      [-3, 0],
      [-1, 30],
      [0, 60],
      [1, 80],
      [3, 100],
    ]),
  },

  // ── E. Market Fundamentals ──
  {
    id: "population_growth",
    category: "market",
    label: "Population Growth %",
    stage: "om",
    source: "location_intelligence.data.population_growth_pct",
    extract: ({ li }) => num(primaryLi(li)?.data?.population_growth_pct),
    map: piecewise([
      [-1, 0],
      [0, 30],
      [1, 60],
      [2, 80],
      [4, 100],
    ]),
  },
  {
    id: "job_growth_5yr",
    category: "market",
    label: "5yr Job Growth %",
    stage: "om",
    source: "location_intelligence.projections.job_growth_5yr_pct",
    extract: ({ li }) => num(primaryLi(li)?.projections?.job_growth_5yr_pct),
    map: piecewise([
      [-2, 0],
      [0, 30],
      [3, 60],
      [7, 80],
      [12, 100],
    ]),
  },
  {
    id: "supply_pipeline",
    category: "market",
    label: "Supply Pipeline (units)",
    stage: "om",
    source: "location_intelligence.projections.new_units_pipeline",
    extract: ({ li }) => num(primaryLi(li)?.projections?.new_units_pipeline),
    // Lower pipeline is better — too much new supply hurts lease-up.
    map: piecewise([
      [0, 100],
      [500, 80],
      [2000, 60],
      [5000, 30],
      [10000, 0],
    ]),
  },
  {
    id: "median_household_income",
    category: "market",
    label: "Median Household Income",
    stage: "om",
    source: "location_intelligence.data.median_household_income",
    extract: ({ li }) => num(primaryLi(li)?.data?.median_household_income),
    map: piecewise([
      [30000, 0],
      [50000, 30],
      [70000, 60],
      [100000, 80],
      [150000, 100],
    ]),
  },

  // ── F. Property / Physical ──
  {
    id: "year_built",
    category: "physical",
    label: "Year Built",
    stage: "om",
    source: "deals.year_built",
    extract: ({ deal }) => num(deal?.year_built),
    map: piecewise([
      [1900, 20],
      [1970, 40],
      [1995, 70],
      [2010, 90],
      [2025, 100],
    ]),
  },
  {
    id: "deferred_maintenance_per_sf",
    category: "physical",
    label: "Capex Reserve $/SF",
    stage: "uw",
    source: "underwriting.capex_items / total SF",
    extract: ({ uwCalc, uw }) => {
      const sf = num(uwCalc?.totalSF);
      const capex = num(uwCalc?.capexTotal);
      if (sf == null || sf === 0 || capex == null) return null;
      // For dev, this metric isn't meaningful.
      if (uw?.development_mode) return null;
      return capex / sf;
    },
    map: piecewise([
      [0, 50],
      [3, 80],
      [5, 100],
      [10, 60],
      [25, 20],
    ]),
  },
  {
    id: "environmental_red_flags",
    category: "physical",
    label: "Environmental Red Flags",
    stage: "om",
    fatalFlaw: true,
    source: "om_analyses.red_flags (environmental)",
    extract: ({ om }) => {
      const flags = om?.red_flags || [];
      let critical = 0;
      let high = 0;
      for (const f of flags) {
        const cat = (f.category || "").toLowerCase();
        const desc = (f.description || "").toLowerCase();
        const isEnv = /environ|asbest|lead|mold|contam|wetland|flood/.test(cat + " " + desc);
        if (!isEnv) continue;
        if (f.severity === "critical") critical++;
        else if (f.severity === "high") high++;
      }
      // Encode as a numeric severity index: 0=none, 1=high, 2=critical.
      if (critical > 0) return 2;
      if (high > 0) return 1;
      return 0;
    },
    map: piecewise([
      [0, 100],
      [1, 40],
      [2, 0],
    ]),
  },

  // ── G. Exit / Liquidity ──
  {
    id: "exit_cap_spread",
    category: "exit",
    label: "Exit Cap vs Entry Cap (bps)",
    stage: "uw",
    weight: 1.5,
    source: "uw.exit_cap_rate − om.cap_rate",
    extract: ({ uw, om, uwCalc }) => {
      const exit = num(uw?.exit_cap_rate);
      const entryPct = num(om?.cap_rate) != null ? (num(om?.cap_rate)! * 100) : num(uwCalc?.marketCapRate);
      if (exit == null || entryPct == null) return null;
      return (exit - entryPct) * 100;
    },
    // Higher exit cap = more conservative. Negative spread (exit < entry) is aggressive.
    map: piecewise([
      [-50, 0],
      [0, 50],
      [25, 70],
      [50, 90],
      [100, 100],
    ]),
  },
  {
    id: "hold_in_target_band",
    category: "exit",
    label: "Hold Period vs BP Target",
    stage: "uw",
    source: "uw.hold_period_years vs business_plan band",
    extract: ({ uw, bp }) => {
      const hold = num(uw?.hold_period_years);
      const lo = num(bp?.hold_period_min);
      const hi = num(bp?.hold_period_max);
      if (hold == null || (lo == null && hi == null)) return null;
      // Distance outside band, in years (0 if inside).
      const lower = lo ?? -Infinity;
      const upper = hi ?? Infinity;
      if (hold >= lower && hold <= upper) return 0;
      return hold < lower ? lower - hold : hold - upper;
    },
    map: piecewise([
      [0, 100],
      [1, 70],
      [3, 40],
      [5, 0],
    ]),
  },

  // ── I. Macro / Economy ──
  {
    id: "industry_diversification_hhi",
    category: "macro",
    label: "Industry HHI (lower = more diversified)",
    stage: "om",
    source: "location_intelligence.data.top_industries[].share_pct",
    extract: ({ li }) => {
      const ind = primaryLi(li)?.data?.top_industries || [];
      if (ind.length === 0) return null;
      let hhi = 0;
      for (const i of ind) {
        const s = (i.share_pct || 0) / 100;
        hhi += s * s;
      }
      // Add a residual for unaccounted industries (assume even split among 5 phantom buckets).
      const accounted = ind.reduce((s, i) => s + (i.share_pct || 0) / 100, 0);
      const residual = Math.max(0, 1 - accounted);
      hhi += (residual * residual) / 5;
      return hhi;
    },
    map: piecewise([
      [0.08, 100],
      [0.15, 70],
      [0.25, 40],
      [0.4, 0],
    ]),
  },
  {
    id: "underwriting_rate_buffer",
    category: "macro",
    label: "UW Rate vs Current",
    stage: "uw",
    source: "underwriting.acq_interest_rate (no Fed funds feed yet, scored absolute)",
    extract: ({ uw }) => num(uw?.acq_interest_rate),
    // Without a current-rate feed, score absolute level: higher UW rate
    // reflects more conservative underwriting in the current environment.
    map: piecewise([
      [3, 30],
      [5, 60],
      [6.5, 80],
      [8, 90],
      [10, 100],
    ]),
  },

  // ── (No factors yet for sponsor / regulatory categories — they require
  //     data we don't yet capture: deals-by-owner, rent-control flags,
  //     entitlements_status. Adding factors there is purely additive — drop
  //     a new entry into this array and the breakdown picks it up.)
];

/** Filter factors to those visible at or before `stage`. */
export function factorsForStage(stage: Stage): FactorDef[] {
  const order: Record<Stage, number> = { om: 0, uw: 1, final: 2 };
  return FACTORS.filter((f) => order[f.stage] <= order[stage]);
}

export const ALGORITHM_VERSION = "quant-1.0.0";
export { clamp };
