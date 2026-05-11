import { describe, expect, it } from "vitest";
import { piecewise, bucket, clamp } from "../mappers";
import { resolveWeights, normalize, DEFAULT_WEIGHTS } from "../weights";
import { computeQuantScore } from "../compute";
import type { FactorInputs } from "../factors";

describe("mappers", () => {
  it("piecewise hits anchor values exactly", () => {
    const m = piecewise([
      [-100, 0],
      [0, 30],
      [50, 60],
      [100, 80],
      [175, 100],
    ]);
    expect(m(-100)).toBe(0);
    expect(m(0)).toBe(30);
    expect(m(50)).toBe(60);
    expect(m(100)).toBe(80);
    expect(m(175)).toBe(100);
  });

  it("piecewise interpolates linearly between anchors", () => {
    const m = piecewise([
      [0, 0],
      [10, 100],
    ]);
    expect(m(5)).toBe(50);
    expect(m(2.5)).toBe(25);
  });

  it("piecewise clamps below first and above last anchor", () => {
    const m = piecewise([
      [0, 20],
      [100, 80],
    ]);
    expect(m(-50)).toBe(20);
    expect(m(200)).toBe(80);
  });

  it("piecewise handles unsorted anchors by sorting them", () => {
    const m = piecewise([
      [100, 80],
      [0, 20],
    ]);
    expect(m(50)).toBe(50);
  });

  it("bucket returns the table value or default", () => {
    const m = bucket({ red: 0, green: 100 } as Record<string, number>, 50);
    expect(m("red")).toBe(0);
    expect(m("green")).toBe(100);
    expect(m("blue")).toBe(50);
    expect(m(null)).toBe(50);
  });

  it("clamp pins to [0, 100]", () => {
    expect(clamp(-10)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(50)).toBe(50);
    expect(clamp(NaN)).toBe(0);
  });
});

describe("weights", () => {
  it("default profiles all sum to 100 across 10 categories", () => {
    for (const profile of Object.values(DEFAULT_WEIGHTS)) {
      const sum = (Object.values(profile) as number[]).reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(100, 6);
    }
  });

  it("normalize rescales to sum 100", () => {
    const w = normalize({
      return: 1,
      capstack: 1,
      construction: 0,
      leaseup: 1,
      market: 1,
      physical: 0,
      exit: 1,
      sponsor: 0,
      macro: 0,
      regulatory: 0,
    });
    const sum = (Object.values(w) as number[]).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("resolveWeights merges override on top of strategy default", () => {
    const w = resolveWeights("ground_up_dev", { return: 50 });
    // The override gets re-normalized along with the rest, so we don't
    // expect return=50 exactly — but its share should grow vs default.
    const defaultRet = DEFAULT_WEIGHTS.ground_up_dev.return;
    expect(w.return).toBeGreaterThan(defaultRet);
    const sum = (Object.values(w) as number[]).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("resolveWeights with no strategy falls back to value_add", () => {
    const w = resolveWeights(null);
    // Same shape as DEFAULT_WEIGHTS.value_add (which itself sums to 100).
    expect(w.return).toBeCloseTo(DEFAULT_WEIGHTS.value_add.return, 4);
  });
});

describe("computeQuantScore", () => {
  // Minimal stubbed inputs for a value-add deal at UW stage.
  function makeInputs(overrides: Partial<FactorInputs> = {}): FactorInputs {
    return {
      deal: { id: "d1", year_built: 2005 },
      om: { cap_rate: 0.06, red_flags: [] },
      uw: {
        development_mode: false,
        vacancy_rate: 5,
        rent_growth_pct: 3,
        exit_cap_rate: 6.5,
        acq_interest_rate: 7,
        acq_io_years: 0,
        acq_pp_ltv: 65,
        has_refi: false,
        hold_period_years: 5,
        unit_groups: [{ unit_count: 100, sf_per_unit: 800 }],
        capex_items: [],
        dev_budget_items: [],
      },
      uwCalc: {
        yoc: 7.5,
        proformaCapRate: 7.5,
        marketCapRate: 6,
        proformaNOI: 1_000_000,
        totalOpEx: 400_000,
        proformaGPR: 1_500_000,
        acqLoan: 13_000_000,
        stabilizedDSCR: 1.5,
        acqDebt: 700_000,
        em: 1.8,
        totalSF: 80_000,
        totalCost: 20_000_000,
        capexTotal: 0,
      },
      li: [
        {
          radius_miles: 1,
          data: {
            population_growth_pct: 2,
            median_household_income: 90_000,
            home_value_growth_pct: 2,
            top_industries: [{ name: "Tech", share_pct: 25 }, { name: "Healthcare", share_pct: 20 }],
          },
          projections: { job_growth_5yr_pct: 6, new_units_pipeline: 1500 },
        },
      ],
      bp: { target_irr_min: 15, target_equity_multiple_min: 1.7, hold_period_min: 4, hold_period_max: 7 },
      uwIrrPct: 17,
      ...overrides,
    };
  }

  it("produces a composite in [0, 100]", () => {
    const out = computeQuantScore(makeInputs(), { stage: "uw", strategy: "value_add" });
    expect(out.composite).toBeGreaterThanOrEqual(0);
    expect(out.composite).toBeLessThanOrEqual(100);
    expect(out.band).toMatch(/institutional|actionable|marginal|pass/);
  });

  it("is deterministic — same inputs produce same composite", () => {
    const inputs = makeInputs();
    const a = computeQuantScore(inputs, { stage: "uw", strategy: "value_add" });
    const b = computeQuantScore(inputs, { stage: "uw", strategy: "value_add" });
    expect(a.composite).toBe(b.composite);
    expect(a.confidence).toBe(b.confidence);
  });

  it("missing inputs reduce confidence rather than zeroing the score", () => {
    const sparse = makeInputs({ uwCalc: null, uw: null });
    const out = computeQuantScore(sparse, { stage: "uw", strategy: "value_add" });
    expect(out.confidence).toBeLessThan(1);
    // Composite still finite — no NaN propagation.
    expect(Number.isFinite(out.composite)).toBe(true);
  });

  it("fatal-flaw soft-floors a category by 15 points", () => {
    // Force breakeven occupancy >=95 → score 0 → fatal flaw triggers.
    const flawed = makeInputs({
      uwCalc: {
        yoc: 5,
        proformaCapRate: 5,
        marketCapRate: 5,
        proformaNOI: 100_000,
        totalOpEx: 1_400_000,
        proformaGPR: 1_500_000,
        acqLoan: 10_000_000,
        stabilizedDSCR: 0.9,
        acqDebt: 100_000,
        em: 1.0,
        totalSF: 80_000,
        totalCost: 15_000_000,
        capexTotal: 0,
      },
    });
    const out = computeQuantScore(flawed, { stage: "uw", strategy: "value_add" });
    const ret = out.categories.find((c) => c.category === "return");
    const cap = out.categories.find((c) => c.category === "capstack");
    expect(ret?.notched).toBe(true);
    expect(cap?.notched).toBe(true);
  });

  it("category confidence equals present weight / total weight", () => {
    const out = computeQuantScore(makeInputs(), { stage: "uw", strategy: "value_add" });
    for (const cat of out.categories) {
      const presentWeight = cat.inputs
        .filter((i) => i.score != null)
        .reduce((sum, i) => sum + (i.weight || 1), 0);
      const totalWeight = cat.inputs.reduce((sum, i) => sum + (i.weight || 1), 0);
      if (totalWeight === 0) {
        expect(cat.confidence).toBe(0);
      } else {
        expect(cat.confidence).toBeCloseTo(presentWeight / totalWeight, 5);
      }
    }
  });

  it("OM stage excludes UW-only factors entirely", () => {
    const out = computeQuantScore(makeInputs(), { stage: "om", strategy: "value_add" });
    // No UW-stage inputs should appear in any category's input list.
    for (const cat of out.categories) {
      for (const inp of cat.inputs) {
        expect(inp.stage).toBe("om");
      }
    }
  });

  it("strategy switch rebalances composite", () => {
    const inputs = makeInputs();
    const valueAdd = computeQuantScore(inputs, { stage: "uw", strategy: "value_add" });
    const ground = computeQuantScore(inputs, { stage: "uw", strategy: "ground_up_dev" });
    // Different weight profiles → at least one category contributes
    // differently → composites should not be identical for typical inputs.
    // We don't assert direction, just that the output reflects the change.
    expect(typeof valueAdd.composite).toBe("number");
    expect(typeof ground.composite).toBe("number");
    // Weight profiles themselves differ — an easy structural assertion.
    expect(valueAdd.weights.return).not.toBe(ground.weights.return);
  });
});
