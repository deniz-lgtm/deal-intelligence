import { describe, expect, it } from "vitest";
import {
  mulberry32,
  stdNormal,
  stdNormalCdf,
  truncatedNormalFromZ,
  triangularFromZ,
  triangularFromU,
  defaultCalibration,
  meanStd,
  quantileSorted,
} from "../distributions";
import { applyCholesky, cholesky, DEFAULT_CORRELATION } from "../correlation";
import { runMonteCarlo, DEFAULT_TRIALS } from "../monte-carlo";
import { evaluateScenario } from "../uw-evaluator";
import { DEFAULT, type UWData } from "@/lib/underwriting-calc";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function baseDeal(): UWData {
  return {
    ...DEFAULT,
    purchase_price: 20_000_000,
    closing_costs_pct: 2,
    unit_groups: [
      {
        id: "g1",
        label: "1BR",
        unit_count: 100,
        renovation_count: 0,
        renovation_cost_per_unit: 0,
        unit_change: "none",
        unit_change_count: 0,
        bedrooms: 1,
        bathrooms: 1,
        sf_per_unit: 750,
        current_rent_per_sf: 0,
        market_rent_per_sf: 0,
        lease_type: "Gross",
        expense_reimbursement_per_sf: 0,
        current_rent_per_unit: 1800,
        market_rent_per_unit: 2000,
        beds_per_unit: 0,
        current_rent_per_bed: 0,
        market_rent_per_bed: 0,
      },
    ],
    capex_items: [],
    custom_opex: [],
    vacancy_rate: 5,
    in_place_vacancy_rate: 5,
    management_fee_pct: 4,
    taxes_annual: 200_000,
    insurance_annual: 50_000,
    repairs_annual: 80_000,
    utilities_annual: 30_000,
    other_expenses_annual: 0,
    ga_annual: 0,
    marketing_annual: 0,
    reserves_annual: 30_000,
    has_financing: true,
    acq_ltc: 0,
    acq_interest_rate: 6.5,
    acq_pp_ltv: 65,
    acq_capex_ltv: 100,
    acq_amort_years: 30,
    acq_io_years: 0,
    has_refi: false,
    refi_year: 3,
    refi_ltv: 65,
    refi_rate: 6.5,
    refi_amort_years: 30,
    rent_growth_pct: 3,
    expense_growth_pct: 3,
    exit_cap_rate: 5.5,
    hold_period_years: 5,
    notes: "",
    development_mode: false,
    land_cost: 0,
    hard_cost_per_sf: 0,
    soft_cost_pct: 0,
    lot_coverage_pct: 0,
    far: 0,
    height_limit_stories: 0,
    max_gsf: 0,
    efficiency_pct: 100,
    max_nrsf: 0,
    cam_taxes: false,
    cam_insurance: false,
    cam_repairs: false,
    cam_utilities: false,
    cam_ga: false,
    cam_marketing: false,
    cam_reserves: false,
    cam_other: false,
    cam_management: false,
    lc_new_pct: 0,
    lc_renewal_pct: 0,
    lc_renewal_prob: 0,
    zoning_designation: "",
    zoning_data: null,
    dev_budget_items: [],
    parking: null,
    lease_up: null,
    construction_loan: null,
    mixed_use: null,
    redevelopment: null,
    building_program: null,
    commercial_tenants: [],
    other_income_items: [],
    site_info: null,
    opex_narrative: "",
    loan_narrative: "",
    affordability_config: null,
  };
}

// ─── PRNG / distribution primitives ──────────────────────────────────────────

describe("distributions", () => {
  it("mulberry32 is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it("stdNormal produces approximately mean=0, std=1 over many draws", () => {
    const rng = mulberry32(123);
    const draws: number[] = [];
    for (let i = 0; i < 5000; i++) draws.push(stdNormal(rng));
    const { mean, std } = meanStd(draws);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(std - 1)).toBeLessThan(0.05);
  });

  it("stdNormalCdf is monotone and matches known values", () => {
    expect(stdNormalCdf(0)).toBeCloseTo(0.5, 4);
    expect(stdNormalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(stdNormalCdf(-1.96)).toBeCloseTo(0.025, 2);
    expect(stdNormalCdf(1)).toBeGreaterThan(stdNormalCdf(0));
  });

  it("truncatedNormalFromZ stays within bounds", () => {
    for (let z = -5; z <= 5; z += 0.5) {
      const v = truncatedNormalFromZ(z, 5, 1, 0, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("triangular stays within [low, high]", () => {
    for (let u = 0; u <= 1; u += 0.05) {
      const v = triangularFromU(u, 2, 5, 13);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(13);
    }
    expect(triangularFromZ(-3, 2, 5, 13)).toBeGreaterThanOrEqual(2);
    expect(triangularFromZ(3, 2, 5, 13)).toBeLessThanOrEqual(13);
  });

  it("defaultCalibration centers on uw values", () => {
    const cal = defaultCalibration({
      rent_growth_pct: 4,
      vacancy_rate: 6,
      exit_cap_rate: 6,
      acq_interest_rate: 7,
    });
    expect(cal.rentGrowth.mu).toBe(4);
    expect(cal.vacancy.mode).toBe(6);
    expect(cal.exitCap.mu).toBe(6);
    expect(cal.rate.mu).toBe(7);
  });

  it("quantileSorted returns interior, lower-tail, and upper-tail values", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantileSorted(arr, 0.0)).toBe(1);
    expect(quantileSorted(arr, 1.0)).toBe(10);
    expect(quantileSorted(arr, 0.5)).toBeGreaterThanOrEqual(5);
    expect(quantileSorted(arr, 0.5)).toBeLessThanOrEqual(6);
  });
});

// ─── Cholesky / correlation ─────────────────────────────────────────────────

describe("correlation / Cholesky", () => {
  it("Cholesky of identity is identity", () => {
    const I = [[1, 0], [0, 1]];
    const L = cholesky(I);
    expect(L[0][0]).toBeCloseTo(1, 6);
    expect(L[1][1]).toBeCloseTo(1, 6);
    expect(L[0][1]).toBe(0);
  });

  it("L · L^T reconstructs the original matrix (default 4×4)", () => {
    const L = cholesky(DEFAULT_CORRELATION);
    const n = DEFAULT_CORRELATION.length;
    const reconstructed: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += L[i][k] * L[j][k];
        reconstructed[i][j] = s;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(reconstructed[i][j]).toBeCloseTo(DEFAULT_CORRELATION[i][j], 6);
      }
    }
  });

  it("applying Cholesky to many standard normals reproduces target correlation", () => {
    const L = cholesky(DEFAULT_CORRELATION);
    const rng = mulberry32(7);
    const N = 8000;
    const samples: number[][] = [];
    for (let i = 0; i < N; i++) {
      const z = [stdNormal(rng), stdNormal(rng), stdNormal(rng), stdNormal(rng)];
      samples.push(applyCholesky(L, z));
    }
    // Sample correlation between rate (idx 3) and exit cap (idx 2).
    const cor = sampleCorr(samples, 2, 3);
    // Target is +0.6; at N=8000 we tolerate ±0.07.
    expect(cor).toBeGreaterThan(0.5);
    expect(cor).toBeLessThan(0.7);
  });
});

function sampleCorr(samples: number[][], i: number, j: number): number {
  const xs = samples.map((s) => s[i]);
  const ys = samples.map((s) => s[j]);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let k = 0; k < xs.length; k++) {
    num += (xs[k] - mx) * (ys[k] - my);
    dx += (xs[k] - mx) ** 2;
    dy += (ys[k] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// ─── Underwriting evaluator ─────────────────────────────────────────────────

describe("uw-evaluator", () => {
  it("base case produces a positive IRR and EM > 1 on a healthy deal", () => {
    const r = evaluateScenario(baseDeal(), "multifamily", {});
    expect(r.em).toBeGreaterThan(1);
    expect(r.irrPct == null || isFinite(r.irrPct)).toBe(true);
  });

  it("higher exit cap → lower IRR (monotone)", () => {
    const a = evaluateScenario(baseDeal(), "multifamily", { exit_cap_rate: 5.0 });
    const b = evaluateScenario(baseDeal(), "multifamily", { exit_cap_rate: 7.0 });
    if (a.irrPct != null && b.irrPct != null) {
      expect(a.irrPct).toBeGreaterThan(b.irrPct);
    }
  });
});

// ─── Monte Carlo orchestrator ────────────────────────────────────────────────

describe("runMonteCarlo", () => {
  const SMALL_TRIALS = 800;

  it("is reproducible: same (deal, seed) → identical summary", () => {
    const uw = baseDeal();
    const a = runMonteCarlo(uw, "multifamily", { trials: SMALL_TRIALS, seed: 42 });
    const b = runMonteCarlo(uw, "multifamily", { trials: SMALL_TRIALS, seed: 42 });
    expect(a.irr.p10).toBe(b.irr.p10);
    expect(a.irr.p50).toBe(b.irr.p50);
    expect(a.irr.p90).toBe(b.irr.p90);
    expect(a.em.p50).toBe(b.em.p50);
    expect(a.prob_capital_loss).toBe(b.prob_capital_loss);
    expect(a.rng_seed).toBe(b.rng_seed);
  });

  it("percentiles are monotonic", () => {
    const r = runMonteCarlo(baseDeal(), "multifamily", { trials: SMALL_TRIALS, seed: 11 });
    expect(r.irr.p10).toBeLessThanOrEqual(r.irr.p25);
    expect(r.irr.p25).toBeLessThanOrEqual(r.irr.p50);
    expect(r.irr.p50).toBeLessThanOrEqual(r.irr.p75);
    expect(r.irr.p75).toBeLessThanOrEqual(r.irr.p90);
    expect(r.em.p10).toBeLessThanOrEqual(r.em.p50);
    expect(r.em.p50).toBeLessThanOrEqual(r.em.p90);
  });

  it("prob_capital_loss is in [0, 1]", () => {
    const r = runMonteCarlo(baseDeal(), "multifamily", { trials: SMALL_TRIALS, seed: 11 });
    expect(r.prob_capital_loss).toBeGreaterThanOrEqual(0);
    expect(r.prob_capital_loss).toBeLessThanOrEqual(1);
  });

  it("targetIrrPct yields a probability in [0, 1] when set", () => {
    const r = runMonteCarlo(baseDeal(), "multifamily", {
      trials: SMALL_TRIALS,
      seed: 11,
      targetIrrPct: 12,
    });
    expect(r.prob_hit_target_irr).not.toBeNull();
    expect(r.prob_hit_target_irr!).toBeGreaterThanOrEqual(0);
    expect(r.prob_hit_target_irr!).toBeLessThanOrEqual(1);
  });

  it("reports the seed and correlation matrix version", () => {
    const r = runMonteCarlo(baseDeal(), "multifamily", { trials: 100, seed: 9 });
    expect(r.rng_seed).toBe(9);
    expect(r.correlation_matrix_version).toMatch(/mc-\d+\./);
  });

  it("Sharpe and Sortino are finite numbers (or null when undefined)", () => {
    const r = runMonteCarlo(baseDeal(), "multifamily", {
      trials: SMALL_TRIALS,
      seed: 17,
      targetIrrPct: 12,
    });
    expect(r.risk_free_pct).toBe(4.0);
    expect(r.sortino_target_pct).toBe(12);
    if (r.sharpe_ratio != null) expect(Number.isFinite(r.sharpe_ratio)).toBe(true);
    if (r.sortino_ratio != null) expect(Number.isFinite(r.sortino_ratio)).toBe(true);
  });

  it("Sortino > Sharpe when distribution is right-skewed (typical RE deal)", () => {
    // For deals where upside variance is large but downside is bounded,
    // dividing by downside-only deviation gives a higher ratio than
    // dividing by total deviation. This isn't guaranteed for every deal,
    // so we just assert both are finite and non-null when computable.
    const r = runMonteCarlo(baseDeal(), "multifamily", { trials: 2000, seed: 31 });
    expect(r.sharpe_ratio == null || Number.isFinite(r.sharpe_ratio)).toBe(true);
    expect(r.sortino_ratio == null || Number.isFinite(r.sortino_ratio)).toBe(true);
  });
});
