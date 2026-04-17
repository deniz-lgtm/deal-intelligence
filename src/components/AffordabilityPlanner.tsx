"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Loader2, Plus, Trash2, DollarSign, Sparkles,
  ChevronDown, ChevronRight, Wand2, AlertTriangle, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { findBonusCard, type BonusCardEffects } from "@/lib/bonus-catalog";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Distribution mode controls how the tier's total unit count is split across
 * bedroom types. Drives both the UI (locks certain inputs) and the solver.
 */
export type UnitMixMode =
  | "flexible"            // any mix of BR types satisfies the requirement
  | "match_building"      // must mirror the building's own BR mix proportions
  | "bedroom_equivalent"; // target is a TOTAL BEDROOM count, not a unit count

export interface AmiTier {
  id: string;
  ami_pct: number;           // e.g., 60 for 60% AMI
  units_pct: number;         // % of total units at this tier (ignored when mode = bedroom_equivalent)
  units_count: number;       // total units at this tier (derived from per-BR counts)
  // Per-bedroom unit counts — the affordable mix the user has committed to.
  units_studio: number;
  units_1br: number;
  units_2br: number;
  units_3br: number;
  units_4br_plus: number;
  // Max rents sourced from HUD AMI data at the given ami_pct.
  max_rent_studio: number;
  max_rent_1br: number;
  max_rent_2br: number;
  max_rent_3br: number;
  max_rent_4br_plus: number;
  // Mix constraint for this tier.
  mix_mode: UnitMixMode;
  /**
   * Total bedroom target (only used when mix_mode === "bedroom_equivalent").
   * A studio counts as 0, 1BR as 1, 2BR as 2, 3BR as 3, 4BR+ as 4. If a
   * jurisdiction counts studios differently, the user edits the mix manually
   * and switches back to "flexible".
   */
  bedroom_target: number;
  /**
   * Optional per-tier building targeting. When set, the affordable units
   * for THIS tier are routed only to unit groups whose
   * site_plan_building_id is in this list (the split routine ignores
   * other buildings' rows for this tier). Empty / unset = affordable
   * units distribute proportionally across every building in the
   * massing, matching prior behaviour. Only meaningful on multi-
   * building massings.
   */
  target_building_ids?: string[];
}

/**
 * How the affordable units relate to the market baseline.
 *   "replacement" — affordable units carve out of market-rate units;
 *                   total unit count stays fixed. Standard inclusionary
 *                   zoning (NYC MIH, most CA local IZ, Boston IDP).
 *   "additive"    — affordable units are added on top of the market
 *                   baseline; total unit count grows. Density-bonus
 *                   jurisdictions (CA State Density Bonus Law, NYC
 *                   Voluntary IH w/ bonus, MA 40B, NJ COAH RDP).
 */
export type AllocationMode = "replacement" | "additive";

export interface AffordabilityConfig {
  enabled: boolean;
  tiers: AmiTier[];
  total_units: number;
  market_rate_units: number;
  /**
   * Allocation model. Defaults to "replacement" so legacy configs keep
   * their existing behaviour (carve affordable out of market).
   */
  allocation_mode: AllocationMode;
  density_bonus_pct: number;        // additional density bonus earned
  density_bonus_source: string;     // e.g., "CA SB 1818", "Local IZ ordinance"
  tax_exemption_enabled: boolean;
  tax_exemption_pct: number;        // % reduction in property tax
  tax_exemption_years: number;      // how many years the exemption lasts
  tax_exemption_type: string;       // e.g., "LIHTC", "Local abatement", "Welfare exemption"
  notes: string;
}

interface AmiData {
  year: number;
  area_name: string;
  median_family_income: number;
  max_rents: Record<
    string,
    { studio: number; one_br: number; two_br: number; three_br: number; four_br?: number }
  >;
  income_limits: Record<string, number[]>;
}

/**
 * The subject building's own unit mix — used when a tier is in
 * "match_building" mode and for the AI optimizer to reason about what's
 * typical for the deal. Each field is a unit count.
 */
export interface BuildingUnitMix {
  studio: number;
  one_br: number;
  two_br: number;
  three_br: number;
  four_br_plus: number;
}

// Bedroom counts used by the "bedroom_equivalent" solver. Exported so callers
// can override if their jurisdiction treats studios as 1 bedroom, etc.
export const BEDROOM_WEIGHTS = {
  studio: 0,
  one_br: 1,
  two_br: 2,
  three_br: 3,
  four_br_plus: 4,
} as const;

// ── Default AMI tier presets ─────────────────────────────────────────────────

const AMI_PRESETS = [
  { label: "LIHTC 9% (100% affordable)", tiers: [{ ami: 30, pct: 10 }, { ami: 50, pct: 30 }, { ami: 60, pct: 60 }] },
  { label: "LIHTC 4% (100% affordable)", tiers: [{ ami: 50, pct: 40 }, { ami: 60, pct: 60 }] },
  { label: "80/20 Mixed Income", tiers: [{ ami: 60, pct: 20 }] },
  { label: "Density Bonus (CA)", tiers: [{ ami: 50, pct: 15 }] },
  { label: "Inclusionary (20% at 80%)", tiers: [{ ami: 80, pct: 20 }] },
  { label: "Mixed (10% at 50%, 10% at 80%)", tiers: [{ ami: 50, pct: 10 }, { ami: 80, pct: 10 }] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const fc = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const fpct = (n: number) => n.toFixed(1) + "%";

// ── Component ────────────────────────────────────────────────────────────────

// Loose shape of whatever's been previously stored on the deal's underwriting
// record. Historically this was saved with a smaller tier schema (no id / max
// rent fields / no per-BR counts), so we accept a lax shape here and hydrate
// below.
interface InitialConfigLoose {
  enabled?: boolean;
  tiers?: Array<
    Partial<AmiTier> & {
      ami_pct?: number;
      units_pct?: number;
      units_count?: number;
    }
  >;
  total_units?: number;
  market_rate_units?: number;
  allocation_mode?: AllocationMode;
  density_bonus_pct?: number;
  density_bonus_source?: string;
  tax_exemption_enabled?: boolean;
  tax_exemption_pct?: number;
  tax_exemption_years?: number;
  tax_exemption_type?: string;
  notes?: string;
}

interface Props {
  dealId: string;
  totalUnits: number;
  avgMarketRent: number;      // weighted average market rent per unit/month
  currentTaxes: number;       // current taxes_annual from UW
  onConfigChange: (config: AffordabilityConfig) => void;
  initialConfig?: InitialConfigLoose | null;
  /**
   * The subject building's own unit mix — powers the "match_building" solver
   * and the AI optimizer's sense of what's normal for the deal. Derived from
   * unit_groups by the parent page.
   */
  buildingUnitMix?: BuildingUnitMix;
  /**
   * Which editing responsibilities this surface owns.
   *
   *   "type"  — Programming page. Pick the affordability TYPE (presets,
   *             AMI%, % of units per tier, tax exemption). Per-BR mix of
   *             affordable units is NOT edited here.
   *
   *   "mix"   — Underwriting page. Edit the per-BR affordable mix per tier
   *             (Flexible / Match Building / Bedroom Count + Suggest +
   *             Optimize with AI). Presets / tax exemption are read-only
   *             here; the user sets those in Programming.
   *
   *   "full"  — Everything in one surface (default — backwards compat for
   *             any caller that hasn't opted into the split yet).
   */
  mode?: "type" | "mix" | "full";
  /**
   * Bonuses/incentives "spotted" from the Site & Zoning page. Rendered
   * read-only in the type surface so the analyst can see which density /
   * affordability programs have been committed to before picking tiers.
   */
  spottedBonuses?: Array<{
    source: string;
    description: string;
    additional_density: string;
  }>;
  /**
   * Mix-surface only. When provided, a "Push to Unit Mix" action appears
   * so the analyst can re-run the unit-group split after dialing in the
   * per-BR mix, without jumping to Programming to save. The parent owns
   * the actual mutation (it knows the current unit_groups state).
   */
  onPushToUnitMix?: () => void;
  /**
   * Buildings in the active Massing. When present AND length > 1, each
   * tier gets a "Target Building" selector that lets analysts route
   * that tier's affordable units to one specific building (e.g. "100%
   * affordable Building 3, market-rate Buildings 1 & 2"). Empty /
   * single-building massings fall back to proportional distribution
   * across everything.
   */
  availableBuildings?: Array<{ id: string; label: string }>;
}

function hydrateTiers(
  tiers: InitialConfigLoose["tiers"] = [],
  mix?: BuildingUnitMix
): AmiTier[] {
  return tiers.map((t) => {
    // If a legacy tier has a units_count but no per-BR breakdown yet, seed
    // the mix from the building's bedroom distribution when possible. That
    // gives existing deals a sensible starting point instead of an
    // "unallocated" warning. If no building mix is available, put the total
    // in 1BR as a safe default and let the user rebalance.
    const unitsCount = t.units_count ?? 0;
    const hasPerBr =
      (t.units_studio ?? 0) +
        (t.units_1br ?? 0) +
        (t.units_2br ?? 0) +
        (t.units_3br ?? 0) +
        (t.units_4br_plus ?? 0) >
      0;

    let studio = t.units_studio ?? 0;
    let one = t.units_1br ?? 0;
    let two = t.units_2br ?? 0;
    let three = t.units_3br ?? 0;
    let four = t.units_4br_plus ?? 0;

    if (!hasPerBr && unitsCount > 0) {
      if (mix) {
        const spread = solveMatchBuilding(unitsCount, mix);
        studio = spread.studio;
        one = spread.one_br;
        two = spread.two_br;
        three = spread.three_br;
        four = spread.four_br_plus;
      } else {
        one = unitsCount;
      }
    }

    return {
      id: t.id ?? uuidv4(),
      ami_pct: t.ami_pct ?? 60,
      units_pct: t.units_pct ?? 0,
      units_count: studio + one + two + three + four || unitsCount,
      units_studio: studio,
      units_1br: one,
      units_2br: two,
      units_3br: three,
      units_4br_plus: four,
      max_rent_studio: t.max_rent_studio ?? 0,
      max_rent_1br: t.max_rent_1br ?? 0,
      max_rent_2br: t.max_rent_2br ?? 0,
      max_rent_3br: t.max_rent_3br ?? 0,
      max_rent_4br_plus: t.max_rent_4br_plus ?? 0,
      mix_mode: (t.mix_mode as UnitMixMode) ?? "flexible",
      bedroom_target: t.bedroom_target ?? 0,
    };
  });
}

// ── Solvers ──────────────────────────────────────────────────────────────────

interface MixResult {
  studio: number;
  one_br: number;
  two_br: number;
  three_br: number;
  four_br_plus: number;
}

/**
 * Spread a unit count across BR types in the same proportions as the
 * building. Rounds with a largest-remainder pass so the result sums exactly
 * to the target.
 */
export function solveMatchBuilding(
  unitsCount: number,
  mix: BuildingUnitMix
): MixResult {
  const total =
    mix.studio + mix.one_br + mix.two_br + mix.three_br + mix.four_br_plus;
  if (total <= 0 || unitsCount <= 0) {
    return { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
  }
  const raw = {
    studio: (mix.studio / total) * unitsCount,
    one_br: (mix.one_br / total) * unitsCount,
    two_br: (mix.two_br / total) * unitsCount,
    three_br: (mix.three_br / total) * unitsCount,
    four_br_plus: (mix.four_br_plus / total) * unitsCount,
  };
  const floored = {
    studio: Math.floor(raw.studio),
    one_br: Math.floor(raw.one_br),
    two_br: Math.floor(raw.two_br),
    three_br: Math.floor(raw.three_br),
    four_br_plus: Math.floor(raw.four_br_plus),
  };
  const placed =
    floored.studio +
    floored.one_br +
    floored.two_br +
    floored.three_br +
    floored.four_br_plus;
  let remaining = unitsCount - placed;
  // Assign remaining units by largest fractional part.
  const remainders = (
    ["studio", "one_br", "two_br", "three_br", "four_br_plus"] as const
  )
    .map((k) => ({ k, frac: raw[k] - Math.floor(raw[k]) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { k } of remainders) {
    if (remaining <= 0) break;
    floored[k] += 1;
    remaining -= 1;
  }
  return floored;
}

/**
 * Maximize tier revenue by putting units in the highest-rent BR type that's
 * present (non-zero max rent). Studios / no-rent types fall out naturally.
 */
export function solveFlexibleMaxRevenue(
  unitsCount: number,
  rents: {
    max_rent_studio: number;
    max_rent_1br: number;
    max_rent_2br: number;
    max_rent_3br: number;
    max_rent_4br_plus: number;
  }
): MixResult {
  if (unitsCount <= 0) {
    return { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
  }
  const byRent: Array<{ k: keyof MixResult; rent: number }> = [
    { k: "studio", rent: rents.max_rent_studio },
    { k: "one_br", rent: rents.max_rent_1br },
    { k: "two_br", rent: rents.max_rent_2br },
    { k: "three_br", rent: rents.max_rent_3br },
    { k: "four_br_plus", rent: rents.max_rent_4br_plus },
  ];
  const best = byRent
    .filter((b) => b.rent > 0)
    .sort((a, b) => b.rent - a.rent)[0];
  const result: MixResult = {
    studio: 0,
    one_br: 0,
    two_br: 0,
    three_br: 0,
    four_br_plus: 0,
  };
  // If no rent data yet, fall back to 1BR so users see a sensible baseline.
  if (!best) {
    result.one_br = unitsCount;
  } else {
    result[best.k] = unitsCount;
  }
  return result;
}

/**
 * Find a mix that exactly hits `bedroomTarget` total bedrooms AND maximizes
 * revenue. Unit count is free — the user cares about bedrooms, not units.
 *
 * Greedy approach: walk BR types in descending rent order and fill them up
 * until the bedroom target is reached. Studios are only used if the target
 * permits and they're the best revenue option that fits.
 *
 * Returns a "best-effort" result even if the target can't be hit exactly
 * (e.g. target = 5 with only 2BR available → 2 × 2BR = 4 beds, the remainder
 * is dropped so the user can adjust).
 */
export function solveBedroomEquivalentMaxRevenue(
  bedroomTarget: number,
  rents: {
    max_rent_studio: number;
    max_rent_1br: number;
    max_rent_2br: number;
    max_rent_3br: number;
    max_rent_4br_plus: number;
  }
): MixResult {
  const result: MixResult = {
    studio: 0,
    one_br: 0,
    two_br: 0,
    three_br: 0,
    four_br_plus: 0,
  };
  if (bedroomTarget <= 0) return result;

  const allTypes: Array<{ k: keyof MixResult; br: number; rent: number }> = [
    { k: "studio", br: BEDROOM_WEIGHTS.studio, rent: rents.max_rent_studio },
    { k: "one_br", br: BEDROOM_WEIGHTS.one_br, rent: rents.max_rent_1br },
    { k: "two_br", br: BEDROOM_WEIGHTS.two_br, rent: rents.max_rent_2br },
    { k: "three_br", br: BEDROOM_WEIGHTS.three_br, rent: rents.max_rent_3br },
    {
      k: "four_br_plus",
      br: BEDROOM_WEIGHTS.four_br_plus,
      rent: rents.max_rent_4br_plus,
    },
  ];
  const types = allTypes.filter((t) => t.rent > 0);

  // Score each type by rent-per-bedroom (higher = more revenue efficient per
  // bedroom spent). Studios are 0 bedrooms and thus infinite efficiency, but
  // they don't contribute to the target — handle them after.
  const withBr = types.filter((t) => t.br > 0);
  if (withBr.length === 0) {
    // No bedroom-carrying types available — can't hit the target, bail.
    return result;
  }

  let remaining = bedroomTarget;
  // Prefer the highest rent-per-bedroom type, but bias toward larger units
  // first to avoid filling with tiny 1BRs when 3BRs beat them on absolute
  // rent (which is usually the case).
  const sorted = withBr
    .slice()
    .sort((a, b) => b.rent / b.br - a.rent / a.br);
  // Fill with the best type while the target allows.
  for (const t of sorted) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / t.br);
    if (count > 0) {
      result[t.k] += count;
      remaining -= count * t.br;
    }
  }
  return result;
}

export default function AffordabilityPlanner({
  dealId,
  totalUnits,
  avgMarketRent,
  currentTaxes,
  onConfigChange,
  initialConfig,
  buildingUnitMix,
  mode = "full",
  spottedBonuses,
  onPushToUnitMix,
  availableBuildings,
}: Props) {
  const showTypeControls = mode === "type" || mode === "full";
  const showMixControls = mode === "mix" || mode === "full";
  const [open, setOpen] = useState(false);
  const [loadingAmi, setLoadingAmi] = useState(false);
  const [ami, setAmi] = useState<AmiData | null>(null);
  const [optimizingTierId, setOptimizingTierId] = useState<string | null>(null);
  const [config, setConfig] = useState<AffordabilityConfig>({
    enabled: initialConfig?.enabled ?? false,
    tiers: hydrateTiers(initialConfig?.tiers, buildingUnitMix),
    total_units: initialConfig?.total_units ?? totalUnits,
    market_rate_units: initialConfig?.market_rate_units ?? totalUnits,
    allocation_mode: initialConfig?.allocation_mode ?? "replacement",
    density_bonus_pct: initialConfig?.density_bonus_pct ?? 0,
    density_bonus_source: initialConfig?.density_bonus_source ?? "",
    tax_exemption_enabled: initialConfig?.tax_exemption_enabled ?? false,
    tax_exemption_pct: initialConfig?.tax_exemption_pct ?? 0,
    tax_exemption_years: initialConfig?.tax_exemption_years ?? 0,
    tax_exemption_type: initialConfig?.tax_exemption_type ?? "",
    notes: initialConfig?.notes ?? "",
  });

  // Keep total / market-rate in sync when the parent's unit count
  // changes. The semantics depend on the allocation mode:
  //   replacement: parent `totalUnits` = market + affordable. Market
  //                rate is what's left after carving out affordable.
  //   additive:    parent `totalUnits` already reflects the additive
  //                total (it counts affordable rows pushed to the unit
  //                mix). Market baseline = total − affordable.
  useEffect(() => {
    setConfig((prev) => {
      const isAdditive = prev.allocation_mode === "additive";
      // Parent's `totalUnits` counts every row in unit_groups (market +
      // affordable). In additive mode we strip the affordable to recover
      // the market baseline; in replacement mode the total IS the
      // baseline (affordable rows were carved out of it).
      //
      // In additive mode each tier's units_pct is taken against the
      // market baseline, so if total tier pct is Σpct then
      //   affordable ≈ baseline × Σpct/100  and  baseline = totalUnits − affordable
      //   ⇒ baseline = totalUnits × 100 / (100 + Σpct).
      const sumPcts = prev.tiers.reduce((s, t) => s + (t.units_pct || 0), 0);
      const baseline = isAdditive
        ? Math.max(0, Math.round((totalUnits * 100) / (100 + sumPcts)))
        : totalUnits;

      // Reconcile each tier's units_count with the new baseline so the
      // "Units Required" field tracks units_pct × baseline. Without this
      // a tier saved against a stale baseline would keep displaying its
      // old count even after the massing changes the unit total.
      const nextTiers = prev.tiers.map((t) =>
        t.units_pct
          ? { ...t, units_count: Math.round(baseline * (t.units_pct / 100)) }
          : t
      );
      const affordable = nextTiers.reduce((s, t) => s + t.units_count, 0);

      const market = isAdditive
        ? baseline
        : Math.max(0, baseline - affordable);
      const changed =
        prev.total_units !== baseline ||
        prev.market_rate_units !== market ||
        nextTiers.some((t, i) => t.units_count !== prev.tiers[i]?.units_count);
      const next = {
        ...prev,
        tiers: nextTiers,
        total_units: baseline,
        market_rate_units: market,
      };
      if (changed) onConfigChange(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalUnits]);

  // Fetch AMI data
  const fetchAmi = useCallback(async () => {
    setLoadingAmi(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/location-intelligence/fetch-ami`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ radius_miles: 3 }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        setAmi(json.data);
        toast.success(`AMI loaded: ${fc(json.data.median_family_income)}`);
      }
    } catch { /* non-fatal */ }
    setLoadingAmi(false);
  }, [dealId]);

  // Auto-fetch AMI on mount so presets work immediately without user action
  useEffect(() => {
    if (!ami) fetchAmi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute when tiers change.
  //
  // Replacement: market = baseline − affordable (carve-out).
  // Additive:    market = baseline (affordable stacks on top).
  //
  // In both modes `total_units` holds the MARKET-RATE BASELINE so the
  // math stays consistent as the user toggles between modes.
  function updateConfig(newConfig: Partial<AffordabilityConfig>) {
    setConfig((prev) => {
      const next = { ...prev, ...newConfig };
      const affordableUnits = next.tiers.reduce((s, t) => s + t.units_count, 0);
      next.market_rate_units =
        next.allocation_mode === "additive"
          ? next.total_units
          : Math.max(0, next.total_units - affordableUnits);
      onConfigChange(next);
      return next;
    });
  }

  function addTier(amiPct: number = 60) {
    const rents = getMaxRents(amiPct);
    // Size new tiers off the market baseline so additive mode behaves
    // like replacement (10% of 100-unit baseline = 10 units, regardless
    // of affordable rows already in the mix).
    const baseline = config.total_units || totalUnits;
    const units = Math.round(baseline * 0.1);
    // Seed the new tier's mix from the building's BR distribution when we
    // have it — that's the most common default. Users can rebalance freely.
    const seedMix = buildingUnitMix
      ? solveMatchBuilding(units, buildingUnitMix)
      : { studio: 0, one_br: units, two_br: 0, three_br: 0, four_br_plus: 0 };
    const newTier: AmiTier = {
      id: uuidv4(),
      ami_pct: amiPct,
      units_pct: 10,
      units_count: units,
      units_studio: seedMix.studio,
      units_1br: seedMix.one_br,
      units_2br: seedMix.two_br,
      units_3br: seedMix.three_br,
      units_4br_plus: seedMix.four_br_plus,
      max_rent_studio: rents.studio,
      max_rent_1br: rents.one_br,
      max_rent_2br: rents.two_br,
      max_rent_3br: rents.three_br,
      max_rent_4br_plus: rents.four_br_plus,
      mix_mode: "flexible",
      bedroom_target: 0,
    };
    updateConfig({ enabled: true, tiers: [...config.tiers, newTier] });
  }

  function updateTier(id: string, changes: Partial<AmiTier>) {
    const newTiers = config.tiers.map((t) => {
      if (t.id !== id) return t;
      const updated = { ...t, ...changes };
      // If the total target units changed, re-solve the mix so the BR
      // breakdown still sums to the requested total.
      if (changes.units_pct != null) {
        const baseline = config.total_units || totalUnits;
        updated.units_count = Math.round(baseline * (updated.units_pct / 100));
        resolveTierMixInPlace(updated, buildingUnitMix);
      }
      // Recompute rents if AMI level changed
      if (changes.ami_pct != null) {
        const rents = getMaxRents(updated.ami_pct);
        updated.max_rent_studio = rents.studio;
        updated.max_rent_1br = rents.one_br;
        updated.max_rent_2br = rents.two_br;
        updated.max_rent_3br = rents.three_br;
        updated.max_rent_4br_plus = rents.four_br_plus;
      }
      // Mode toggles re-run the solver so the mix matches the new constraint.
      if (changes.mix_mode != null || changes.bedroom_target != null) {
        resolveTierMixInPlace(updated, buildingUnitMix);
      }
      // Keep units_count in sync when the user edits per-BR counts directly
      // (flexible mode lets them hand-edit).
      if (
        changes.units_studio != null ||
        changes.units_1br != null ||
        changes.units_2br != null ||
        changes.units_3br != null ||
        changes.units_4br_plus != null
      ) {
        updated.units_count =
          updated.units_studio +
          updated.units_1br +
          updated.units_2br +
          updated.units_3br +
          updated.units_4br_plus;
      }
      return updated;
    });
    updateConfig({ tiers: newTiers });
  }

  function removeTier(id: string) {
    const newTiers = config.tiers.filter((t) => t.id !== id);
    updateConfig({ tiers: newTiers, enabled: newTiers.length > 0 });
  }

  /**
   * Re-run whichever solver the tier's mode calls for and mutate the tier
   * in place. Used from updateTier() after changes that would invalidate
   * the current mix. Flexible mode leaves the user's manual edits alone.
   */
  function resolveTierMixInPlace(tier: AmiTier, mix?: BuildingUnitMix): void {
    if (tier.mix_mode === "match_building" && mix) {
      const r = solveMatchBuilding(tier.units_count, mix);
      tier.units_studio = r.studio;
      tier.units_1br = r.one_br;
      tier.units_2br = r.two_br;
      tier.units_3br = r.three_br;
      tier.units_4br_plus = r.four_br_plus;
    } else if (tier.mix_mode === "bedroom_equivalent") {
      const r = solveBedroomEquivalentMaxRevenue(tier.bedroom_target, {
        max_rent_studio: tier.max_rent_studio,
        max_rent_1br: tier.max_rent_1br,
        max_rent_2br: tier.max_rent_2br,
        max_rent_3br: tier.max_rent_3br,
        max_rent_4br_plus: tier.max_rent_4br_plus,
      });
      tier.units_studio = r.studio;
      tier.units_1br = r.one_br;
      tier.units_2br = r.two_br;
      tier.units_3br = r.three_br;
      tier.units_4br_plus = r.four_br_plus;
      tier.units_count =
        r.studio + r.one_br + r.two_br + r.three_br + r.four_br_plus;
    }
    // "flexible" leaves per-BR counts alone.
  }

  function applyPreset(preset: typeof AMI_PRESETS[0]) {
    const baseline = config.total_units || totalUnits;
    const tiers: AmiTier[] = preset.tiers.map((p) => {
      const rents = getMaxRents(p.ami);
      const units = Math.round(baseline * (p.pct / 100));
      const seedMix = buildingUnitMix
        ? solveMatchBuilding(units, buildingUnitMix)
        : { studio: 0, one_br: units, two_br: 0, three_br: 0, four_br_plus: 0 };
      return {
        id: uuidv4(),
        ami_pct: p.ami,
        units_pct: p.pct,
        units_count: units,
        units_studio: seedMix.studio,
        units_1br: seedMix.one_br,
        units_2br: seedMix.two_br,
        units_3br: seedMix.three_br,
        units_4br_plus: seedMix.four_br_plus,
        max_rent_studio: rents.studio,
        max_rent_1br: rents.one_br,
        max_rent_2br: rents.two_br,
        max_rent_3br: rents.three_br,
        max_rent_4br_plus: rents.four_br_plus,
        mix_mode: "flexible" as const,
        bedroom_target: 0,
      };
    });
    updateConfig({ enabled: true, tiers });
    toast.success(`Applied "${preset.label}" preset`);
  }

  // ── Bonus / incentive card application ─────────────────────────────────
  //
  // A spotted bonus card (set on Site & Zoning) may declare structured
  // effects. `isBonusApplied` checks whether the current config already
  // contains those effects; `applyBonusEffects` merges them in.
  //
  // Rules intentionally kept boring so the UX is predictable:
  //   • Adding an affordability tier is idempotent — we never duplicate
  //     a tier that already matches on (ami_pct, units_pct). If a match
  //     exists, we assume the user already applied this card.
  //   • Setting tax exemption is idempotent — we only enable it when
  //     not already enabled, and we prefer the card's values.
  //   • We never REMOVE tiers or exemptions automatically (un-spotting
  //     a card on Site & Zoning does not reverse effects). The analyst
  //     stays in control of cleanup.

  function isBonusApplied(effects?: BonusCardEffects): boolean {
    if (!effects) return false;
    const tierOk =
      !effects.affordability_tier ||
      config.tiers.some(
        (t) =>
          t.ami_pct === effects.affordability_tier!.ami_pct &&
          t.units_pct === effects.affordability_tier!.units_pct
      );
    const taxOk =
      !effects.tax_exemption ||
      (config.tax_exemption_enabled &&
        config.tax_exemption_pct === effects.tax_exemption.pct &&
        config.tax_exemption_type === effects.tax_exemption.type);
    return tierOk && taxOk;
  }

  function applyBonusEffects(sourceLabel: string, effects: BonusCardEffects) {
    let changed = false;
    setConfig((prev) => {
      let nextTiers = prev.tiers;
      let nextTaxEnabled = prev.tax_exemption_enabled;
      let nextTaxPct = prev.tax_exemption_pct;
      let nextTaxYears = prev.tax_exemption_years;
      let nextTaxType = prev.tax_exemption_type;

      // Affordability tier (idempotent — matches on ami_pct + units_pct).
      if (effects.affordability_tier) {
        const { ami_pct, units_pct } = effects.affordability_tier;
        const already = prev.tiers.some(
          (t) => t.ami_pct === ami_pct && t.units_pct === units_pct
        );
        if (!already) {
          const baseline = prev.total_units || totalUnits;
          const units = Math.round(baseline * (units_pct / 100));
          const seedMix = buildingUnitMix
            ? solveMatchBuilding(units, buildingUnitMix)
            : { studio: 0, one_br: units, two_br: 0, three_br: 0, four_br_plus: 0 };
          const rents = getMaxRents(ami_pct);
          nextTiers = [
            ...prev.tiers,
            {
              id: uuidv4(),
              ami_pct,
              units_pct,
              units_count: units,
              units_studio: seedMix.studio,
              units_1br: seedMix.one_br,
              units_2br: seedMix.two_br,
              units_3br: seedMix.three_br,
              units_4br_plus: seedMix.four_br_plus,
              max_rent_studio: rents.studio,
              max_rent_1br: rents.one_br,
              max_rent_2br: rents.two_br,
              max_rent_3br: rents.three_br,
              max_rent_4br_plus: rents.four_br_plus,
              mix_mode: "flexible",
              bedroom_target: 0,
            },
          ];
          changed = true;
        }
      }

      // Tax exemption (idempotent — only enables if off, and refreshes
      // pct / years / type to the card's spec).
      if (effects.tax_exemption) {
        const { pct, years, type } = effects.tax_exemption;
        if (
          !prev.tax_exemption_enabled ||
          prev.tax_exemption_pct !== pct ||
          prev.tax_exemption_type !== type ||
          prev.tax_exemption_years !== years
        ) {
          nextTaxEnabled = true;
          nextTaxPct = pct;
          nextTaxYears = years;
          nextTaxType = type;
          changed = true;
        }
      }

      if (!changed) return prev;
      const next: AffordabilityConfig = {
        ...prev,
        enabled: true,
        tiers: nextTiers,
        tax_exemption_enabled: nextTaxEnabled,
        tax_exemption_pct: nextTaxPct,
        tax_exemption_years: nextTaxYears,
        tax_exemption_type: nextTaxType,
        market_rate_units:
          prev.allocation_mode === "additive"
            ? prev.total_units
            : Math.max(
                0,
                prev.total_units - nextTiers.reduce((s, t) => s + t.units_count, 0)
              ),
      };
      onConfigChange(next);
      return next;
    });
    if (changed) toast.success(`Applied "${sourceLabel}"`);
    else toast.message(`"${sourceLabel}" already applied`);
  }

  // ── Per-tier mix actions ───────────────────────────────────────────────
  function suggestTierMix(tierId: string) {
    const tier = config.tiers.find((t) => t.id === tierId);
    if (!tier) return;
    if (tier.mix_mode === "match_building" && !buildingUnitMix) {
      toast.error(
        "Add unit groups in Underwriting first so the building mix is known."
      );
      return;
    }
    if (tier.mix_mode === "match_building" && buildingUnitMix) {
      const r = solveMatchBuilding(tier.units_count, buildingUnitMix);
      updateTier(tierId, {
        units_studio: r.studio,
        units_1br: r.one_br,
        units_2br: r.two_br,
        units_3br: r.three_br,
        units_4br_plus: r.four_br_plus,
      });
      toast.success("Mix matched to building distribution");
      return;
    }
    if (tier.mix_mode === "bedroom_equivalent") {
      if (!tier.bedroom_target) {
        toast.error("Set a bedroom target first");
        return;
      }
      const r = solveBedroomEquivalentMaxRevenue(tier.bedroom_target, {
        max_rent_studio: tier.max_rent_studio,
        max_rent_1br: tier.max_rent_1br,
        max_rent_2br: tier.max_rent_2br,
        max_rent_3br: tier.max_rent_3br,
        max_rent_4br_plus: tier.max_rent_4br_plus,
      });
      updateTier(tierId, {
        units_studio: r.studio,
        units_1br: r.one_br,
        units_2br: r.two_br,
        units_3br: r.three_br,
        units_4br_plus: r.four_br_plus,
      });
      toast.success(
        `Max-revenue mix for ${tier.bedroom_target} bedrooms applied`
      );
      return;
    }
    // Flexible: maximize revenue given the current unit count.
    const r = solveFlexibleMaxRevenue(tier.units_count, {
      max_rent_studio: tier.max_rent_studio,
      max_rent_1br: tier.max_rent_1br,
      max_rent_2br: tier.max_rent_2br,
      max_rent_3br: tier.max_rent_3br,
      max_rent_4br_plus: tier.max_rent_4br_plus,
    });
    updateTier(tierId, {
      units_studio: r.studio,
      units_1br: r.one_br,
      units_2br: r.two_br,
      units_3br: r.three_br,
      units_4br_plus: r.four_br_plus,
    });
    toast.success("Max-revenue mix applied");
  }

  async function aiOptimizeTierMix(tierId: string) {
    const tier = config.tiers.find((t) => t.id === tierId);
    if (!tier) return;
    setOptimizingTierId(tierId);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/affordability/optimize-mix`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mix_mode: tier.mix_mode,
            units_count: tier.units_count,
            bedroom_target: tier.bedroom_target,
            ami_pct: tier.ami_pct,
            building_unit_mix: buildingUnitMix ?? null,
            max_rents: {
              studio: tier.max_rent_studio,
              one_br: tier.max_rent_1br,
              two_br: tier.max_rent_2br,
              three_br: tier.max_rent_3br,
              four_br_plus: tier.max_rent_4br_plus,
            },
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "AI optimization failed");
        return;
      }
      const r = json.data?.mix as MixResult | undefined;
      if (!r) {
        toast.error("AI returned no mix");
        return;
      }
      updateTier(tierId, {
        units_studio: r.studio,
        units_1br: r.one_br,
        units_2br: r.two_br,
        units_3br: r.three_br,
        units_4br_plus: r.four_br_plus,
      });
      const rationale: string | undefined = json.data?.rationale;
      toast.success(
        rationale ? `AI mix applied: ${rationale}` : "AI mix applied"
      );
    } catch {
      toast.error("AI optimization failed");
    } finally {
      setOptimizingTierId(null);
    }
  }

  function getMaxRents(amiPct: number) {
    const zero = { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
    if (!ami?.max_rents) return zero;
    const key =
      amiPct === 30
        ? "ami_30"
        : amiPct === 50
        ? "ami_50"
        : amiPct === 60
        ? "ami_60"
        : amiPct === 80
        ? "ami_80"
        : amiPct === 100
        ? "ami_100"
        : "ami_120";
    const raw = ami.max_rents[key];
    if (!raw) return zero;
    return {
      studio: raw.studio,
      one_br: raw.one_br,
      two_br: raw.two_br,
      three_br: raw.three_br,
      // HUD publishes 4BR+ rents less consistently — fall back to 3BR if the
      // feed omits it so the solver still has a value to work with.
      four_br_plus: raw.four_br ?? raw.three_br,
    };
  }

  /** Annual revenue from a single affordable tier at its current mix. */
  function tierAnnualRevenue(t: AmiTier): number {
    return (
      (t.units_studio * t.max_rent_studio +
        t.units_1br * t.max_rent_1br +
        t.units_2br * t.max_rent_2br +
        t.units_3br * t.max_rent_3br +
        t.units_4br_plus * t.max_rent_4br_plus) *
      12
    );
  }

  /** Total bedrooms produced by a tier's current mix. */
  function tierBedrooms(t: AmiTier): number {
    return (
      t.units_studio * BEDROOM_WEIGHTS.studio +
      t.units_1br * BEDROOM_WEIGHTS.one_br +
      t.units_2br * BEDROOM_WEIGHTS.two_br +
      t.units_3br * BEDROOM_WEIGHTS.three_br +
      t.units_4br_plus * BEDROOM_WEIGHTS.four_br_plus
    );
  }

  // Revenue impact calculations
  const affordableUnits = config.tiers.reduce((s, t) => s + t.units_count, 0);
  // Show affordable share against the final project size. In additive
  // mode the final size is baseline + affordable, not just baseline.
  const affordablePctDenom =
    config.allocation_mode === "additive"
      ? config.total_units + affordableUnits
      : config.total_units || totalUnits;
  const affordablePct = affordablePctDenom > 0 ? (affordableUnits / affordablePctDenom) * 100 : 0;

  const affordableAnnualRevenue = config.tiers.reduce(
    (s, t) => s + tierAnnualRevenue(t),
    0
  );
  // Weighted average monthly affordable rent per unit (for the summary line).
  const weightedAffordableRent =
    affordableUnits > 0 ? affordableAnnualRevenue / affordableUnits / 12 : 0;

  // Revenue comparison — market-rate units at avg market rent, affordable
  // units at their actual per-BR mix (no more 2BR-proxy approximation).
  // projectTotal == the project's final unit count:
  //   replacement: == config.total_units (total is fixed; affordable carves in)
  //   additive:    == config.total_units + affordableUnits (affordable on top)
  // Using projectTotal keeps the "what if everything were market rate?"
  // comparison stable before and after the split is pushed to unit mix.
  const projectTotal =
    config.allocation_mode === "additive"
      ? config.total_units + affordableUnits
      : config.total_units;
  const marketGPR = projectTotal * avgMarketRent * 12;
  const blendedGPR =
    config.market_rate_units * avgMarketRent * 12 + affordableAnnualRevenue;
  const revenueImpact = marketGPR - blendedGPR;
  const revenueImpactPct = marketGPR > 0 ? (revenueImpact / marketGPR) * 100 : 0;

  // Tax savings — pro-rata by unit count (affordable share of final project)
  const taxSavings = config.tax_exemption_enabled && projectTotal > 0
    ? (affordableUnits / projectTotal) * currentTaxes * (config.tax_exemption_pct / 100)
    : 0;

  return (
    <div className="border border-border/60 rounded-xl bg-card shadow-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-3.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground/60" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/60" />}
        <span className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">
            {mode === "mix"
              ? "Affordable Unit Mix"
              : "Affordability & Income Restrictions"}
          </span>
        </span>
        {config.enabled && (
          <span className="ml-auto text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {affordableUnits} units ({fpct(affordablePct)})
          </span>
        )}
      </button>
      {mode !== "full" && open && (
        <p className="px-5 pt-3 text-[10px] text-muted-foreground/80">
          {mode === "type"
            ? "Pick the affordability type here. The per-bedroom mix is set on Underwriting."
            : "Per-bedroom mix for each tier. Change AMI levels, percentages, and tax exemption on Programming."}
        </p>
      )}

      {open && (
        <div className="px-5 py-4 space-y-4">
          {/* Allocation mode — jurisdictional model. Replacement is the
              default (most US inclusionary zoning: NYC MIH, CA local IZ,
              Boston IDP). Additive covers density-bonus programs where
              affordable units are added ON TOP of the market baseline
              (CA State Density Bonus Law, NYC Voluntary IH w/ bonus,
              MA 40B). Picking the wrong model makes the unit math lie.
              Editable on the type / full surface; read-only on the mix
              surface (Underwriting) — the analyst picks the model in
              Programming. */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              Allocation Model
            </div>
            {showTypeControls ? (
              <div className="flex gap-1.5">
                {(
                  [
                    {
                      value: "replacement" as const,
                      label: "Replacement",
                      help: "Affordable carves out of market. Total unit count stays fixed. Typical IZ (NYC MIH, CA local IZ, Boston IDP).",
                    },
                    {
                      value: "additive" as const,
                      label: "Additive (Density Bonus)",
                      help: "Affordable adds on top of market. Total grows by sum of affordable. CA State Density Bonus Law, NYC Voluntary IH w/ bonus, MA 40B.",
                    },
                  ]
                ).map((opt) => {
                  const active = config.allocation_mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      title={opt.help}
                      onClick={() => updateConfig({ allocation_mode: opt.value })}
                      className={
                        "text-[10px] px-2.5 py-1 rounded-full border transition-colors " +
                        (active
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/30")
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {config.allocation_mode === "additive"
                  ? "Additive (Density Bonus)"
                  : "Replacement"}
                <span className="text-muted-foreground/60"> — set in Programming</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/70 mt-1.5">
              {config.allocation_mode === "additive"
                ? `Affordable units add on top of the ${config.total_units}-unit market baseline → project total ${config.total_units + affordableUnits}.`
                : `Affordable units carve out of the ${config.total_units}-unit project → ${config.market_rate_units} market + ${affordableUnits} affordable.`}
            </p>
          </div>


          {/* AMI info */}
          {ami ? (
            <div className="flex items-center gap-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs">
              <DollarSign className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span>
                <span className="font-medium text-foreground/80">Area Median Income: {fc(ami.median_family_income)}</span>
                <span className="text-muted-foreground"> — {ami.area_name}, FY{ami.year}</span>
              </span>
            </div>
          ) : loadingAmi ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/10 border border-border/30 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              <span>Loading AMI data from HUD…</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              <DollarSign className="h-3.5 w-3.5 flex-shrink-0" />
              <span>Unable to load AMI data. Verify the property address is geocoded.</span>
            </div>
          )}

          {/* Spotted bonuses/incentives (type surface only) — each spotted
              card carries structured effects from the shared catalog
              (src/lib/bonus-catalog.ts). If it does, we render an "Apply"
              button that merges those effects (adds an AMI tier, enables
              tax exemption) into the config. Idempotent: if the tier /
              exemption already matches, the button shows "✓ Applied". */}
          {showTypeControls && spottedBonuses && spottedBonuses.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Spotted Bonuses / Incentives
              </div>
              <div className="space-y-1.5">
                {spottedBonuses.map((b, i) => {
                  const card = findBonusCard(b.source);
                  const effects = card?.effects;
                  const applied = isBonusApplied(effects);
                  const hasEffects =
                    !!effects?.affordability_tier || !!effects?.tax_exemption;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {b.source || "Unnamed bonus"}
                        </div>
                        {effects?.applySummary ? (
                          <div className="text-muted-foreground">
                            {effects.applySummary}
                          </div>
                        ) : b.description ? (
                          <div className="text-muted-foreground">
                            {b.description}
                          </div>
                        ) : null}
                      </div>
                      {hasEffects ? (
                        applied ? (
                          <span className="flex items-center gap-1 text-emerald-400 whitespace-nowrap text-[10px]">
                            <Check className="h-3 w-3" />
                            Applied
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              applyBonusEffects(b.source, effects!)
                            }
                            title="Merge this program's affordability + tax exemption effects into the project"
                          >
                            Apply
                          </Button>
                        )
                      ) : (
                        // Pure-informational cards (e.g. Opportunity Zone,
                        // HUD loan, entitlement pathways). Show the headline
                        // hint rather than an Apply button — they don't map
                        // to a tier or tax exemption we can set here.
                        b.additional_density && (
                          <span className="text-[10px] text-emerald-400 whitespace-nowrap">
                            {b.additional_density}
                          </span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                Picked from Site &amp; Zoning. &quot;Apply&quot; creates the
                matching tier / tax exemption on this project — it never
                removes anything, so you can un-spot a card without losing
                edits.
              </p>
            </div>
          )}

          {/* Quick presets — only on the type surface */}
          {showTypeControls && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Quick Presets</div>
              <div className="flex flex-wrap gap-1.5">
                {AMI_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mix-only hint when no tiers exist yet — user needs to set the
              type in Programming first. */}
          {mode === "mix" && config.tiers.length === 0 && (
            <div className="p-3 rounded-lg bg-muted/10 border border-border/30 text-xs text-muted-foreground">
              No affordable tiers configured yet. Pick an affordability preset
              or add tiers on the <span className="text-foreground font-medium">Programming</span> page,
              then come back here to dial in the per-bedroom mix.
            </div>
          )}

          {/* Tiers */}
          {config.tiers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Affordability Tiers
                </div>
                <div className="flex-1" />
                {mode === "mix" && onPushToUnitMix && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onPushToUnitMix}
                    title="Apply this mix to the Unit / Space Mix table — market rows shrink, and each (tier × BR) gets its own affordable row you can edit independently (they're usually smaller SF than market)"
                  >
                    Push to Unit Mix
                  </Button>
                )}
              </div>
              {config.tiers.map((tier) => {
                // Each row knows which AmiTier field to write when the user
              // edits its count cell, so the onChange can just lift a field
              // name from the row definition.
              const mixBreakdown: Array<{
                label: string;
                units: number;
                rent: number;
                field:
                  | "units_studio"
                  | "units_1br"
                  | "units_2br"
                  | "units_3br"
                  | "units_4br_plus";
              }> = [
                  { field: "units_studio", label: "Studio", units: tier.units_studio, rent: tier.max_rent_studio },
                  { field: "units_1br", label: "1BR", units: tier.units_1br, rent: tier.max_rent_1br },
                  { field: "units_2br", label: "2BR", units: tier.units_2br, rent: tier.max_rent_2br },
                  { field: "units_3br", label: "3BR", units: tier.units_3br, rent: tier.max_rent_3br },
                  { field: "units_4br_plus", label: "4BR+", units: tier.units_4br_plus, rent: tier.max_rent_4br_plus },
                ];
                const mixSum = mixBreakdown.reduce((s, b) => s + b.units, 0);
                // In bedroom_equivalent mode the target is bedrooms, not
                // units, so the "target" shown to the user is different.
                const target =
                  tier.mix_mode === "bedroom_equivalent"
                    ? tier.bedroom_target
                    : tier.units_count;
                const actual =
                  tier.mix_mode === "bedroom_equivalent"
                    ? tierBedrooms(tier)
                    : mixSum;
                const unitHint = tier.mix_mode === "bedroom_equivalent" ? "bedrooms" : "units";
                const mismatch = target > 0 && actual !== target;
                const editable = tier.mix_mode === "flexible";

                return (
                  <div key={tier.id} className="border border-border/40 rounded-lg p-3 bg-muted/5 space-y-3">
                    {/* Top row: AMI / target / revenue summary.
                        - type surface: AMI (editable) + % of Units + Remove.
                        - mix  surface: AMI (read-only label) + Bedroom Target
                          (when bedroom_equivalent) + Revenue. */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {showTypeControls ? (
                        <div>
                          <label className="text-[10px] text-muted-foreground">AMI Level</label>
                          <select
                            value={tier.ami_pct}
                            onChange={(e) => updateTier(tier.id, { ami_pct: Number(e.target.value) })}
                            className="block w-24 px-2 py-1 text-xs bg-background border border-border/40 rounded"
                          >
                            {[30, 50, 60, 80, 100, 120].map((v) => (
                              <option key={v} value={v}>{v}% AMI</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="text-[10px] text-muted-foreground">AMI Level</label>
                          <div className="text-xs font-medium px-2 py-1">
                            {tier.ami_pct}% AMI
                          </div>
                        </div>
                      )}

                      {showTypeControls && tier.mix_mode !== "bedroom_equivalent" && (
                        <>
                          <div>
                            <label className="text-[10px] text-muted-foreground">% of Units</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={tier.units_pct}
                                onChange={(e) => updateTier(tier.id, { units_pct: Number(e.target.value) || 0 })}
                                className="w-16 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                              />
                              <span className="text-xs text-muted-foreground">%</span>
                            </div>
                          </div>
                          <div className="text-xs">
                            <label className="text-[10px] text-muted-foreground">Units Required</label>
                            <div className="font-medium">{tier.units_count}</div>
                          </div>
                        </>
                      )}

                      {showMixControls && tier.mix_mode === "bedroom_equivalent" && (
                        <div>
                          <label className="text-[10px] text-muted-foreground">Bedroom Target</label>
                          <input
                            type="number"
                            min={0}
                            value={tier.bedroom_target}
                            onChange={(e) =>
                              updateTier(tier.id, {
                                bedroom_target: Number(e.target.value) || 0,
                              })
                            }
                            className="block w-20 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                          />
                        </div>
                      )}

                      <div className="flex-1 text-xs text-muted-foreground">
                        <label className="text-[10px]">Est. Revenue</label>
                        <div className="font-medium text-foreground">
                          {fc(tierAnnualRevenue(tier))}/yr
                        </div>
                      </div>

                      {showTypeControls && (
                        <button
                          onClick={() => removeTier(tier.id)}
                          className="text-muted-foreground/50 hover:text-red-400"
                          title="Remove tier"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Target building(s) — shown on Programming (type
                        surface) when the active massing has >1 building.
                        Lets analysts route this tier's affordable units
                        to a specific building (e.g. all affordable in
                        Building 3). Empty selection = distribute across
                        every building proportionally. */}
                    {showTypeControls && availableBuildings && availableBuildings.length > 1 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                          Target Building
                        </span>
                        {(() => {
                          const selected = tier.target_building_ids || [];
                          const allSelected = selected.length === 0;
                          return (
                            <>
                              <button
                                onClick={() =>
                                  updateTier(tier.id, { target_building_ids: [] })
                                }
                                className={`px-2 py-0.5 text-[10px] rounded border ${
                                  allSelected
                                    ? "bg-primary/20 border-primary/40 text-primary"
                                    : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/60"
                                }`}
                                title="Distribute affordable units proportionally across every building in this massing"
                              >
                                All buildings
                              </button>
                              {availableBuildings.map((b) => {
                                const on = selected.includes(b.id);
                                return (
                                  <button
                                    key={b.id}
                                    onClick={() => {
                                      const next = on
                                        ? selected.filter((x) => x !== b.id)
                                        : [...selected, b.id];
                                      updateTier(tier.id, { target_building_ids: next });
                                    }}
                                    className={`px-2 py-0.5 text-[10px] rounded border ${
                                      on
                                        ? "bg-blue-500/20 border-blue-500/40 text-blue-200"
                                        : "bg-muted/20 border-border/40 text-muted-foreground hover:border-border/60"
                                    }`}
                                    title={on ? `Remove ${b.label} from this tier` : `Route this tier's affordable units to ${b.label}`}
                                  >
                                    {b.label}
                                  </button>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* Mode selector + Suggest/AI actions — mix surface only */}
                    {showMixControls && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                          Distribution
                        </span>
                        {(
                          [
                            { value: "flexible", label: "Flexible" },
                            { value: "match_building", label: "Match Building" },
                            { value: "bedroom_equivalent", label: "Bedroom Count" },
                          ] as Array<{ value: UnitMixMode; label: string }>
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => updateTier(tier.id, { mix_mode: opt.value })}
                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                              tier.mix_mode === opt.value
                                ? "bg-primary/15 border-primary/40 text-primary"
                                : "border-border/40 text-muted-foreground hover:text-foreground"
                            }`}
                            title={
                              opt.value === "flexible"
                                ? "Any mix of BR types counts — pick the most profitable"
                                : opt.value === "match_building"
                                ? "Mix must mirror the rest of the building's BR distribution"
                                : "Target a total bedroom count; the mix can trade units for bedrooms"
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => suggestTierMix(tier.id)}
                          disabled={
                            tier.mix_mode === "match_building" && !buildingUnitMix
                          }
                          title="Apply a deterministic best-fit mix based on the current mode"
                        >
                          <Wand2 className="h-3 w-3 mr-1" />
                          Suggest Mix
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => aiOptimizeTierMix(tier.id)}
                          disabled={optimizingTierId === tier.id}
                          title="Ask Claude to pick a revenue-maximizing mix that's marketable in this submarket"
                        >
                          {optimizingTierId === tier.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3 mr-1" />
                          )}
                          Optimize with AI
                        </Button>
                      </div>
                    )}

                    {/* Per-bedroom mix editor — mix surface only.
                        On the type surface, show a compact read-only
                        summary so the user knows what's been set without
                        exposing the editor. */}
                    {showMixControls ? (
                    <div>
                      <div className="grid grid-cols-5 gap-2">
                        {mixBreakdown.map((b) => (
                          <div
                            key={b.field}
                            className="border border-border/30 rounded-md bg-background/40 px-2 py-1.5"
                          >
                            <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                              <span>{b.label}</span>
                              <span className="text-muted-foreground/70">
                                {b.rent > 0 ? fc(b.rent) + "/mo" : "—"}
                              </span>
                            </div>
                            <input
                              type="number"
                              min={0}
                              value={b.units}
                              disabled={!editable}
                              onChange={(e) =>
                                updateTier(tier.id, {
                                  [b.field]: Number(e.target.value) || 0,
                                } as Partial<AmiTier>)
                              }
                              className={`block w-full text-right tabular-nums text-sm bg-transparent outline-none mt-0.5 ${
                                !editable ? "text-muted-foreground/80 cursor-not-allowed" : ""
                              }`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                        <span className="text-muted-foreground">
                          Allocated: <span className="tabular-nums font-medium text-foreground">{actual}</span> {unitHint}
                          {target > 0 && (
                            <span className="text-muted-foreground"> / target {target}</span>
                          )}
                        </span>
                        {mismatch && (
                          <span className="flex items-center gap-1 text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {actual < target
                              ? `${target - actual} ${unitHint} short`
                              : `${actual - target} over`}
                          </span>
                        )}
                        {tier.mix_mode === "match_building" && !buildingUnitMix && (
                          <span className="flex items-center gap-1 text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            Building mix unknown — add unit groups in Underwriting
                          </span>
                        )}
                        {editable && (
                          <span className="text-muted-foreground/70 ml-auto">
                            Flexible mode — edit any cell directly
                          </span>
                        )}
                      </div>
                    </div>
                    ) : (
                      /* Type surface: compact read-only per-BR breakdown so
                         the analyst sees what the mix looks like without
                         being invited to edit it (that's Underwriting). */
                      <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {mixBreakdown
                          .filter((b) => b.units > 0)
                          .map((b) => (
                            <span
                              key={b.field}
                              className="px-2 py-0.5 rounded-full border border-border/40 bg-background/50 tabular-nums"
                            >
                              {b.units} × {b.label}
                            </span>
                          ))}
                        {mixBreakdown.every((b) => b.units === 0) && (
                          <span className="text-muted-foreground/70">
                            Mix not set — open Underwriting to distribute these units.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {showTypeControls && (
                <Button size="sm" variant="outline" onClick={() => addTier(60)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Tier
                </Button>
              )}
            </div>
          )}

          {config.tiers.length === 0 && showTypeControls && (
            <div className="text-center py-6 text-xs text-muted-foreground">
              <p>No affordability requirements set. Select a preset above or add custom tiers.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => addTier(60)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Affordability Tier
              </Button>
            </div>
          )}

          {/* Tax Exemption — owned by the type surface. On the mix surface
              it's read-only context only. */}
          {showTypeControls && (
          <div className="border-t border-border/40 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Property Tax Exemption</div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={config.tax_exemption_enabled}
                  onChange={(e) => updateConfig({ tax_exemption_enabled: e.target.checked })}
                  className="rounded border-border"
                />
                Tax exemption for affordable units
              </label>
              {config.tax_exemption_enabled && (
                <>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Type</label>
                    <select
                      value={config.tax_exemption_type}
                      onChange={(e) => updateConfig({ tax_exemption_type: e.target.value })}
                      className="block w-40 px-2 py-1 text-xs bg-background border border-border/40 rounded"
                    >
                      <option value="">Select...</option>
                      <option value="lihtc">LIHTC (100% exempt)</option>
                      <option value="welfare_exemption">Welfare Exemption (CA)</option>
                      <option value="local_abatement">Local Tax Abatement</option>
                      <option value="pilot">PILOT Agreement</option>
                      <option value="421a">421-a (NYC)</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Tax Reduction</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={config.tax_exemption_pct}
                        onChange={(e) => updateConfig({ tax_exemption_pct: Number(e.target.value) || 0 })}
                        className="w-16 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Duration</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={config.tax_exemption_years}
                        onChange={(e) => updateConfig({ tax_exemption_years: Number(e.target.value) || 0 })}
                        className="w-16 px-2 py-1 text-xs bg-background border border-border/40 rounded text-right"
                      />
                      <span className="text-xs text-muted-foreground">yrs</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          )}

          {/* Impact summary */}
          {config.enabled && (
            <div className="border-t border-border/40 pt-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Impact Summary</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] text-muted-foreground">Affordable Units</div>
                  <div className="text-sm font-semibold">{affordableUnits} of {totalUnits}</div>
                  <div className="text-[10px] text-muted-foreground">{fpct(affordablePct)}</div>
                </div>
                <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] text-muted-foreground">Market Rate Units</div>
                  <div className="text-sm font-semibold">{config.market_rate_units}</div>
                </div>
                <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                  <div className="text-[10px] text-muted-foreground">Revenue Impact</div>
                  <div className={`text-sm font-semibold ${revenueImpact > 0 ? "text-red-400" : "text-emerald-400"}`}>
                    -{fc(revenueImpact)}/yr
                  </div>
                  <div className="text-[10px] text-muted-foreground">-{fpct(revenueImpactPct)} GPR</div>
                </div>
                {config.tax_exemption_enabled && taxSavings > 0 && (
                  <div className="border border-border/40 rounded-lg bg-muted/10 p-2.5">
                    <div className="text-[10px] text-muted-foreground">Tax Savings</div>
                    <div className="text-sm font-semibold text-emerald-400">+{fc(taxSavings)}/yr</div>
                    <div className="text-[10px] text-muted-foreground">
                      {affordableUnits}/{totalUnits} units × {config.tax_exemption_pct}%
                    </div>
                  </div>
                )}
              </div>
              {avgMarketRent > 0 && weightedAffordableRent > 0 && (
                <div className="text-[10px] text-muted-foreground mt-2">
                  Avg market rent: {fc(avgMarketRent)}/mo · Avg affordable rent: {fc(weightedAffordableRent)}/mo · Blended: {fc(totalUnits > 0 ? (blendedGPR / totalUnits / 12) : 0)}/mo
                </div>
              )}
            </div>
          )}

          {/* Notes — owned by the type surface. */}
          {showTypeControls && (
            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Notes</label>
              <textarea
                value={config.notes}
                onChange={(e) => updateConfig({ notes: e.target.value })}
                placeholder="Affordability requirements, density bonus program details, regulatory agreement terms…"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
