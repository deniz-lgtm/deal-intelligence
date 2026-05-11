// Quant deal score — composite computation.
//
// Walks the factor table, extracts values from the input bundle, maps them
// to 0–100 subscores, rolls up into category scores (with a soft-floor
// notch for fatal flaws), and finally into a weighted composite. Missing
// inputs are tracked as confidence (present weight / total weight), not imputed.

import {
  FACTORS,
  factorsForStage,
  ALGORITHM_VERSION,
  type FactorDef,
  type FactorInputs,
  type DealLike,
  type OmLike,
  type UwLike,
  type UwCalcLike,
  type LiLike,
  type BusinessPlanLike,
} from "./factors";
import { clamp } from "./mappers";
import { resolveWeights } from "./weights";
import {
  bandFor,
  CATEGORY_LABELS,
  FACTOR_CATEGORIES,
  type CategoryResult,
  type FactorBreakdown,
  type FactorCategory,
  type FactorWeights,
  type Stage,
  type Strategy,
} from "./types";

export interface ComputeOpts {
  stage: Stage;
  strategy: Strategy | null;
  weightsOverride?: Partial<FactorWeights> | null;
}

const FATAL_NOTCH = 15;

export function computeQuantScore(
  inputs: FactorInputs,
  opts: ComputeOpts
): FactorBreakdown {
  const stageFactors = factorsForStage(opts.stage);
  const weights = resolveWeights(opts.strategy, opts.weightsOverride);

  // Group factors by category, evaluate each.
  const byCategory: Record<FactorCategory, CategoryResult> = {} as Record<FactorCategory, CategoryResult>;
  for (const cat of FACTOR_CATEGORIES) {
    byCategory[cat] = {
      category: cat,
      score: 0,
      confidence: 0,
      notched: false,
      inputs: [],
    };
  }

  for (const f of stageFactors) {
    const result = evaluateFactor(f, inputs);
    byCategory[f.category].inputs.push({
      id: f.id,
      label: f.label,
      stage: f.stage,
      raw: result.raw,
      score: result.score,
      weight: f.weight ?? 1,
      fatalFlaw: f.fatalFlaw,
      source: f.source,
    });
  }

  // Roll up each category.
  for (const cat of FACTOR_CATEGORIES) {
    const cr = byCategory[cat];
    rollUpCategory(cr);
  }

  // Composite = weighted average over categories that have any confidence.
  let weightedSum = 0;
  let weightTotal = 0;
  let confidenceWeightedSum = 0;
  for (const cat of FACTOR_CATEGORIES) {
    const cr = byCategory[cat];
    const w = weights[cat] || 0;
    if (w <= 0) continue;
    if (cr.confidence > 0) {
      weightedSum += cr.score * w;
      weightTotal += w;
    }
    confidenceWeightedSum += cr.confidence * w;
  }
  const composite = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const confidence = (Object.values(weights) as number[]).reduce((s, v) => s + v, 0) > 0
    ? confidenceWeightedSum / 100
    : 0;

  return {
    composite: round1(composite),
    band: bandFor(composite),
    confidence: round2(confidence),
    categories: FACTOR_CATEGORIES.map((c) => byCategory[c]),
    weights,
    strategy: opts.strategy,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

interface FactorEval {
  raw: number | null;
  score: number | null;
}

function evaluateFactor(f: FactorDef, inputs: FactorInputs): FactorEval {
  let raw: number | null;
  try {
    raw = f.extract(inputs);
  } catch {
    raw = null;
  }
  if (raw == null || !isFinite(raw)) return { raw: null, score: null };
  let score: number;
  try {
    score = f.map(raw);
  } catch {
    return { raw, score: null };
  }
  return { raw, score: clamp(score) };
}

function rollUpCategory(cr: CategoryResult): void {
  let weightedSum = 0;
  let weightSum = 0;
  let totalInputWeight = 0;
  let presentInputWeight = 0;
  let fatalTriggered = false;
  for (const inp of cr.inputs) {
    const inputWeight = inp.weight || 1;
    totalInputWeight += inputWeight;
    if (inp.score == null) continue;
    presentInputWeight += inputWeight;
    weightedSum += inp.score * inputWeight;
    weightSum += inputWeight;
    if (inp.fatalFlaw && inp.score === 0) fatalTriggered = true;
  }
  cr.score = weightSum > 0 ? round1(weightedSum / weightSum) : 0;
  cr.confidence = totalInputWeight > 0 ? round2(presentInputWeight / totalInputWeight) : 0;
  if (fatalTriggered) {
    cr.notched = true;
    cr.score = round1(Math.max(0, cr.score - FATAL_NOTCH));
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-exports for callers.
export { CATEGORY_LABELS, FACTOR_CATEGORIES, bandFor };
export type {
  FactorBreakdown,
  CategoryResult,
  FactorWeights,
  FactorCategory,
  Stage,
  Strategy,
} from "./types";
export type {
  FactorInputs,
  DealLike,
  OmLike,
  UwLike,
  UwCalcLike,
  LiLike,
  BusinessPlanLike,
} from "./factors";
