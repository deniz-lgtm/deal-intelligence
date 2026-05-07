import type { FactorCategory, FactorWeights, Strategy } from "./types";
import { FACTOR_CATEGORIES } from "./types";

// Default weight profiles, summing to 100. Each profile reflects a strategy's
// risk priorities — ground-up dev cares about construction, core cares about
// exit liquidity and physical condition, etc.
export const DEFAULT_WEIGHTS: Record<Strategy, FactorWeights> = {
  ground_up_dev: {
    return: 15, capstack: 18, construction: 18, leaseup: 13, market: 10,
    physical: 4, exit: 8, sponsor: 3, macro: 6, regulatory: 5,
  },
  value_add: {
    return: 20, capstack: 16, construction: 4, leaseup: 16, market: 11,
    physical: 9, exit: 9, sponsor: 5, macro: 5, regulatory: 5,
  },
  core: {
    return: 23, capstack: 14, construction: 0, leaseup: 14, market: 13,
    physical: 11, exit: 12, sponsor: 5, macro: 5, regulatory: 3,
  },
  student_housing: {
    return: 18, capstack: 16, construction: 9, leaseup: 20, market: 13,
    physical: 4, exit: 6, sponsor: 3, macro: 6, regulatory: 5,
  },
};

/**
 * Merge an override (partial weights, possibly unnormalized) onto the default
 * profile for `strategy` and re-normalize to sum to 100. Categories absent
 * from the override fall back to the default. Always returns a complete
 * `FactorWeights` with every category present.
 */
export function resolveWeights(
  strategy: Strategy | null | undefined,
  override?: Partial<FactorWeights> | null
): FactorWeights {
  const base = strategy && DEFAULT_WEIGHTS[strategy] ? DEFAULT_WEIGHTS[strategy] : DEFAULT_WEIGHTS.value_add;
  const merged: FactorWeights = { ...base };
  if (override) {
    for (const cat of FACTOR_CATEGORIES) {
      const v = (override as Partial<FactorWeights>)[cat];
      if (typeof v === "number" && isFinite(v) && v >= 0) merged[cat] = v;
    }
  }
  return normalize(merged);
}

/** Normalize a weight map to sum to 100. Zero-sum maps fall back to equal. */
export function normalize(w: FactorWeights): FactorWeights {
  const sum = (Object.values(w) as number[]).reduce((s, v) => s + (isFinite(v) ? v : 0), 0);
  if (sum <= 0) {
    const eq = 100 / FACTOR_CATEGORIES.length;
    return Object.fromEntries(FACTOR_CATEGORIES.map((c) => [c, eq])) as FactorWeights;
  }
  const scaled = Object.fromEntries(
    FACTOR_CATEGORIES.map((c) => [c, ((w[c] || 0) / sum) * 100])
  ) as FactorWeights;
  return scaled;
}

/** Strategy inferred from a business plan's investment_theses, if any. */
export function strategyFromTheses(
  theses: string[] | null | undefined,
  propertyTypes?: string[] | null
): Strategy | null {
  const t = (theses || []).map((x) => x.toLowerCase());
  if (propertyTypes?.some((p) => p.toLowerCase().includes("student"))) return "student_housing";
  if (t.includes("ground_up")) return "ground_up_dev";
  if (t.includes("value_add")) return "value_add";
  if (t.includes("core") || t.includes("core_plus")) return "core";
  return null;
}

/** Re-export for callers that just want the strategy enum list. */
export const STRATEGIES: readonly Strategy[] = ["ground_up_dev", "value_add", "core", "student_housing"];

export function isStrategy(s: string | null | undefined): s is Strategy {
  return s === "ground_up_dev" || s === "value_add" || s === "core" || s === "student_housing";
}

// Re-export so consumers don't need to import from two paths.
export type { FactorCategory, FactorWeights, Strategy } from "./types";
