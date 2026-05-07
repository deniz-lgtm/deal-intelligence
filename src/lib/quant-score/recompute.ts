// Server-side helper to recompute and persist a quant deal score.
//
// Used by:
//   - POST /api/deals/:id/quant-score (manual recompute)
//   - Trigger hooks fired after underwriting / OM / location-intelligence saves
//
// Returns the inserted row's id and the breakdown so callers can choose
// whether to await the narrative or fire-and-forget.

import {
  dealQueries,
  dealScoreQueries,
  omAnalysisQueries,
  getUnderwritingForMassing,
  businessPlanQueries,
  locationIntelligenceQueries,
} from "@/lib/db";
import { calc as calcUnderwriting, xirr, type UWData } from "@/lib/underwriting-calc";
import { computeQuantScore } from "./compute";
import { runMonteCarlo, DEFAULT_TRIALS } from "./monte-carlo";
import { isStrategy, strategyFromTheses } from "./weights";
import { generateNarrative } from "./narrative";
import { ALGORITHM_VERSION } from "./factors";
import { CORRELATION_VERSION } from "./correlation";
import type {
  FactorInputs,
  UwLike,
  UwCalcLike,
  LiLike,
  BusinessPlanLike,
  OmLike,
  DealLike,
} from "./factors";
import type { Stage, Strategy } from "./types";

export type Mode = "commercial" | "multifamily" | "student_housing";

export interface RecomputeOptions {
  stage: Stage;
  runMc?: boolean;
  /** Skip Claude narrative entirely (used by background triggers). */
  skipNarrative?: boolean;
  massingId?: string;
  mcSeed?: number;
}

export interface RecomputeResult {
  id: string;
  composite: number;
  band: string;
  confidence: number;
  algorithm_version: string;
  mc_version: string | null;
}

export async function recomputeQuantScore(
  dealId: string,
  opts: RecomputeOptions
): Promise<RecomputeResult> {
  const stage = opts.stage;
  const runMc = opts.runMc !== false && stage !== "om";

  const [deal, omAnalysis, uwRow, locationIntelRows] = await Promise.all([
    dealQueries.getById(dealId),
    omAnalysisQueries.getByDealId(dealId),
    getUnderwritingForMassing(dealId, opts.massingId ?? null),
    locationIntelligenceQueries.getByDealId(dealId).catch(() => []),
  ]);

  const uw = parseUw(uwRow?.data);
  const bp = deal?.business_plan_id
    ? await businessPlanQueries.getById(deal.business_plan_id)
    : null;

  const mode = pickMode(deal?.property_type as string | undefined, uw);
  let uwCalc: ReturnType<typeof calcUnderwriting> | null = null;
  if (uw) {
    try {
      uwCalc = calcUnderwriting(uw as unknown as UWData, mode);
    } catch (err) {
      console.warn(
        `quant-score recompute: calc() failed for deal ${dealId}: ${(err as Error).message}`
      );
    }
  }

  const uwIrrPct = uwCalc && uw ? computeBaseIrr(uw as unknown as UWData, uwCalc) : null;
  const strategy = pickStrategy(bp);
  const factorWeightsOverride = (bp?.factor_weights as Record<string, number> | null | undefined) ?? null;

  const factorInputs: FactorInputs = {
    deal: deal as unknown as DealLike,
    om: (omAnalysis as unknown as OmLike) ?? null,
    uw: uw as unknown as UwLike,
    uwCalc: uwCalc as unknown as UwCalcLike,
    li: locationIntelRows as unknown as LiLike[],
    bp: bp as unknown as BusinessPlanLike,
    uwIrrPct,
  };

  const breakdown = computeQuantScore(factorInputs, {
    stage,
    strategy,
    weightsOverride: factorWeightsOverride,
  });

  let mc = null;
  if (runMc && uw && uwCalc) {
    try {
      mc = runMonteCarlo(uw as unknown as UWData, mode, {
        trials: DEFAULT_TRIALS,
        seed: opts.mcSeed ?? 0xc0ffee,
        targetIrrPct: bp?.target_irr_min != null ? Number(bp.target_irr_min) : null,
      });
    } catch (err) {
      console.warn(
        `quant-score recompute: Monte Carlo failed for deal ${dealId}: ${(err as Error).message}`
      );
    }
  }

  const inserted = await dealScoreQueries.insert({
    deal_id: dealId,
    stage,
    composite: breakdown.composite,
    confidence: breakdown.confidence,
    band: breakdown.band,
    factor_breakdown: breakdown,
    mc_distribution: mc,
    weight_profile_id: bp?.id ?? null,
    weight_profile_snapshot: bp?.factor_weights ?? null,
    inputs_snapshot: {
      property_type: deal?.property_type ?? null,
      mode,
      uw_irr_pct: uwIrrPct,
      uw_em: uwCalc?.em ?? null,
      uw_dscr: uwCalc?.stabilizedDSCR ?? null,
      uw_yoc: uwCalc?.yoc ?? null,
    },
    narrative: null,
    algorithm_version: ALGORITHM_VERSION,
    mc_version: mc ? CORRELATION_VERSION : null,
  });

  if (!opts.skipNarrative) {
    const narrative = await generateNarrative(breakdown, mc, {
      dealName: typeof deal?.name === "string" ? deal.name : undefined,
      strategy,
    });
    await dealScoreQueries.setNarrative(inserted.id, narrative);
  }

  return {
    id: inserted.id,
    composite: breakdown.composite,
    band: breakdown.band,
    confidence: breakdown.confidence,
    algorithm_version: ALGORITHM_VERSION,
    mc_version: mc ? CORRELATION_VERSION : null,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseUw(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return data as Record<string, unknown>;
}

function pickMode(propertyType: string | undefined, uw: Record<string, unknown> | null): Mode {
  const isSH = propertyType === "student_housing";
  const mu = (uw as { mixed_use?: { components?: Array<{ component_type?: string }> } } | null)?.mixed_use;
  const hasResMixedUse =
    propertyType === "mixed_use" &&
    (mu?.components || []).some((c) => c?.component_type === "residential");
  const isMF =
    propertyType === "multifamily" ||
    propertyType === "sfr" ||
    isSH ||
    hasResMixedUse;
  return isSH ? "student_housing" : isMF ? "multifamily" : "commercial";
}

function pickStrategy(bp: { strategy?: string | null; investment_theses?: unknown; property_types?: unknown } | null): Strategy | null {
  if (!bp) return null;
  if (isStrategy(bp.strategy)) return bp.strategy;
  return strategyFromTheses(
    Array.isArray(bp.investment_theses) ? (bp.investment_theses as string[]) : null,
    Array.isArray(bp.property_types) ? (bp.property_types as string[]) : null
  );
}

function computeBaseIrr(uw: UWData, c: ReturnType<typeof calcUnderwriting>): number | null {
  const equity = c.equity;
  const holdYrs = Math.max(1, Math.round(uw.hold_period_years || 5));
  const cf: number[] = [-equity];
  const tracked = Math.min(5, holdYrs, c.yearlyDCF.length);
  for (let yr = 1; yr <= tracked; yr++) cf.push(c.yearlyDCF[yr - 1].cashFlow);
  if (holdYrs > 5) {
    const rg = (uw.rent_growth_pct || 0) / 100;
    const eg = (uw.expense_growth_pct || 0) / 100;
    const netGrowth = rg - 0.3 * (eg - rg);
    let yrCF = c.yearlyDCF[tracked - 1]?.cashFlow ?? 0;
    for (let yr = 6; yr <= holdYrs; yr++) {
      yrCF = yrCF * (1 + netGrowth);
      cf.push(yrCF);
    }
  }
  cf[cf.length - 1] += c.exitEquity;
  return xirr(cf);
}
