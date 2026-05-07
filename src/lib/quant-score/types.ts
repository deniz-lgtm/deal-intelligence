// Shared types for the quant-score engine.

export type FactorCategory =
  | "return"
  | "capstack"
  | "construction"
  | "leaseup"
  | "market"
  | "physical"
  | "exit"
  | "sponsor"
  | "macro"
  | "regulatory";

export type Stage = "om" | "uw" | "final";

export type Strategy = "ground_up_dev" | "value_add" | "core" | "student_housing";

export const FACTOR_CATEGORIES: readonly FactorCategory[] = [
  "return",
  "capstack",
  "construction",
  "leaseup",
  "market",
  "physical",
  "exit",
  "sponsor",
  "macro",
  "regulatory",
] as const;

export const CATEGORY_LABELS: Record<FactorCategory, string> = {
  return: "Return Quality",
  capstack: "Capital Stack",
  construction: "Construction Risk",
  leaseup: "Lease-Up & Rent",
  market: "Market Fundamentals",
  physical: "Property / Physical",
  exit: "Exit / Liquidity",
  sponsor: "Sponsor / Execution",
  macro: "Macro / Economy",
  regulatory: "Regulatory / Political",
};

export type FactorWeights = Record<FactorCategory, number>;

export interface InputResult {
  /** Raw value pulled from the deal data (or null when missing). */
  raw: number | string | null;
  /** Mapped 0–100 subscore (only present when raw is non-null). */
  score: number | null;
  /** Optional per-input weight inside the category (defaults to 1). */
  weight: number;
  /** Whether this input was a hard fatal flaw (triggers soft-floor notch). */
  fatalFlaw?: boolean;
}

export interface CategoryResult {
  category: FactorCategory;
  /** Weighted average of present input scores (0 when no inputs present). */
  score: number;
  /** present / total input count, 0–1. */
  confidence: number;
  /** Was the soft-floor (fatal-flaw) notch applied? */
  notched: boolean;
  inputs: Array<{
    id: string;
    label: string;
    stage: Stage;
    raw: number | string | null;
    score: number | null;
    weight: number;
    fatalFlaw?: boolean;
    /** Optional source path (e.g. "underwriting.data.vacancy_rate"). */
    source?: string;
  }>;
}

export interface FactorBreakdown {
  composite: number;
  band: ScoreBand;
  confidence: number;
  categories: CategoryResult[];
  weights: FactorWeights;
  strategy: Strategy | null;
  algorithmVersion: string;
}

export type ScoreBand = "institutional" | "actionable" | "marginal" | "pass";

export function bandFor(composite: number): ScoreBand {
  if (composite >= 80) return "institutional";
  if (composite >= 65) return "actionable";
  if (composite >= 50) return "marginal";
  return "pass";
}

// ─── Monte Carlo types ───────────────────────────────────────────────────────

export interface DistributionSummary {
  /** μ (location parameter, e.g. mean rent growth %). */
  mu: number;
  /** σ (scale, e.g. annual standard deviation in pp). */
  sigma: number;
  /** Truncation / range bounds applied to draws (low, high). */
  bounds?: [number, number];
  /** Distribution kind: 'normal' | 'beta' | 'ar1'. */
  kind: "normal" | "beta" | "ar1";
}

export interface McDistribution {
  trials: number;
  irr: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; std: number };
  em: { p10: number; p50: number; p90: number; mean: number };
  prob_hit_target_irr: number | null;
  prob_capital_loss: number;
  prob_refi_failure: number | null;
  expected_shortfall_5pct: number;
  inputs_distribution_summary: {
    rent_growth: DistributionSummary;
    vacancy: DistributionSummary;
    exit_cap: DistributionSummary;
    rate: DistributionSummary;
  };
  correlation_matrix_version: string;
  rng_seed: number;
}
