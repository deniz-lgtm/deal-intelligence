/**
 * Shared split logic that turns a flat list of `unit_groups` + an
 * AffordabilityConfig into a flat list with `(Market)` and
 * `(Affordable {ami}% AMI)` groups separated.
 *
 * Used by:
 *   • Programming page's saveAll (runs at save time when the analyst
 *     tweaks tiers on that surface and hits Save).
 *   • Underwriting page's "Push to Unit Mix" button (lets the analyst
 *     re-run the split after dialing in the per-BR mix on the mix
 *     surface, without needing to jump back to Programming).
 *
 * Rules kept deliberately boring:
 *   • Each affordable row gets its own group (cloned from the matching
 *     market template) so the analyst can adjust sf_per_unit etc.
 *     independently — affordable units are typically smaller.
 *   • Market groups are scaled down by exactly the number of units
 *     claimed in their BR bucket. Preserves total unit count.
 *   • Any unclaimed BR bucket stays untouched. 4BR+ falls back to the
 *     first market group's template when the building doesn't have a
 *     4BR group (bedrooms defaults to 4 in that case).
 *   • Idempotent on re-split: we filter out any previous
 *     `is_affordable` rows before recomputing, so running the split
 *     twice doesn't double-count.
 */

import { v4 as uuidv4 } from "uuid";

// Minimal shape we inspect. Kept separate from the caller's concrete
// UnitGroup type so we can accept anything that looks like one without
// coupling to lib/types.ts.
interface LooseUnitGroup {
  id?: string;
  label?: string;
  bedrooms?: number;
  bathrooms?: number;
  sf_per_unit?: number;
  unit_count?: number;
  is_affordable?: boolean;
  ami_pct?: number;
  market_rent_per_unit?: number;
  current_rent_per_unit?: number;
  // Tag linking the group back to a building in the active massing
  // (Programming's pushToUW stamps this). Used by the split logic
  // below to honor per-tier target_building_ids: when a tier targets
  // a specific building, only that building's market rows are scaled
  // down, and the emitted affordable rows inherit the tag.
  site_plan_building_id?: string | null;
}

interface AffordabilityConfigLite {
  enabled?: boolean;
  tiers?: Array<{
    ami_pct: number;
    units_studio?: number;
    units_1br?: number;
    units_2br?: number;
    units_3br?: number;
    units_4br_plus?: number;
    max_rent_studio?: number;
    max_rent_1br?: number;
    max_rent_2br?: number;
    max_rent_3br?: number;
    max_rent_4br_plus?: number;
    // Optional per-tier building targeting. Empty / unset = route
    // affordable units to every building proportionally (legacy
    // behaviour). When set, only market rows in these buildings get
    // scaled down and the emitted affordable rows are tagged with
    // the matching target. Populated by the Programming UI.
    target_building_ids?: string[];
  }>;
}

type BrKey = "studio" | "one_br" | "two_br" | "three_br" | "four_br_plus";

function bedroomsToKey(bd: number): BrKey {
  if (bd === 0) return "studio";
  if (bd === 1) return "one_br";
  if (bd === 2) return "two_br";
  if (bd === 3) return "three_br";
  return "four_br_plus";
}

const BR_BUCKETS: Array<{
  key: BrKey;
  unitsField: "units_studio" | "units_1br" | "units_2br" | "units_3br" | "units_4br_plus";
  rentField:
    | "max_rent_studio"
    | "max_rent_1br"
    | "max_rent_2br"
    | "max_rent_3br"
    | "max_rent_4br_plus";
  label: string;
  bedrooms: number;
}> = [
  { key: "studio",       unitsField: "units_studio",   rentField: "max_rent_studio",   label: "Studio", bedrooms: 0 },
  { key: "one_br",       unitsField: "units_1br",      rentField: "max_rent_1br",      label: "1BR",    bedrooms: 1 },
  { key: "two_br",       unitsField: "units_2br",      rentField: "max_rent_2br",      label: "2BR",    bedrooms: 2 },
  { key: "three_br",     unitsField: "units_3br",      rentField: "max_rent_3br",      label: "3BR",    bedrooms: 3 },
  { key: "four_br_plus", unitsField: "units_4br_plus", rentField: "max_rent_4br_plus", label: "4BR+",   bedrooms: 4 },
];

export function splitUnitGroupsByAffordability<T extends LooseUnitGroup>(
  unitGroups: T[],
  config: AffordabilityConfigLite | null | undefined
): T[] {
  if (
    !config?.enabled ||
    !config.tiers ||
    config.tiers.length === 0 ||
    unitGroups.length === 0
  ) {
    return unitGroups;
  }

  // Start from the "market-only" view by dropping any prior affordable
  // rows — makes repeated calls idempotent.
  const marketOnly = unitGroups.filter((g) => !g.is_affordable);
  if (marketOnly.length === 0) return unitGroups;

  // Map each BR bucket to a template group pulled from the market rows.
  const marketBaseByBr: Partial<Record<BrKey, T>> = {};
  for (const g of marketOnly) {
    const key = bedroomsToKey(g.bedrooms || 0);
    if (!marketBaseByBr[key]) marketBaseByBr[key] = g;
  }
  const fallbackBase = marketOnly[0];

  // ── Allocate affordable units per (tier, BR bucket, building) ──
  // `claimedByBuildingBr[buildingId || NO_BUILDING][br]` is how many
  // affordable units of that BR bucket are going to a specific building.
  // If a tier has no target_building_ids, its claims are split across
  // every building that has market units in that BR, proportional to
  // the building's market count (so legacy / single-building projects
  // behave exactly like before).
  const NO_BUILDING = "__no_building__";
  const claimedByBuildingBr: Record<string, Record<BrKey, number>> = {};
  // Capacity per (building, BR) = how many market units exist there
  // right now. We clamp tier allocations to this so an aggressive
  // tier can't "take" more affordable units than the building offers.
  const capacityByBuildingBr: Record<string, Record<BrKey, number>> = {};
  for (const g of marketOnly) {
    const b = (g.site_plan_building_id || NO_BUILDING) as string;
    const k = bedroomsToKey(g.bedrooms || 0);
    if (!capacityByBuildingBr[b]) {
      capacityByBuildingBr[b] = { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
    }
    capacityByBuildingBr[b][k] += g.unit_count || 0;
  }
  const allBuildingIds = Object.keys(capacityByBuildingBr);

  // tierAssigns[tier_index][building_id][br_key] = affordable units
  // for that tier going to that building for that BR.
  const tierAssigns: Array<Record<string, Record<BrKey, number>>> = [];

  for (const tier of config.tiers) {
    const targets = (tier.target_building_ids || []).filter(
      (id) => id && capacityByBuildingBr[id]
    );
    const effectiveTargets = targets.length > 0 ? targets : allBuildingIds;
    const tierAssign: Record<string, Record<BrKey, number>> = {};
    for (const id of effectiveTargets) {
      tierAssign[id] = { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
    }
    for (const b of BR_BUCKETS) {
      const want = Number((tier as unknown as Record<string, unknown>)[b.unitsField] || 0);
      if (want <= 0) continue;
      // Cap total capacity across the effective targets.
      const totalCap = effectiveTargets.reduce(
        (s, id) => s + (capacityByBuildingBr[id]?.[b.key] || 0),
        0
      );
      if (totalCap <= 0) continue;
      const assigned = Math.min(want, totalCap);
      // Distribute proportionally to each target's remaining capacity.
      let assignedSoFar = 0;
      effectiveTargets.forEach((id, i) => {
        const cap = capacityByBuildingBr[id]?.[b.key] || 0;
        const isLast = i === effectiveTargets.length - 1;
        let share: number;
        if (isLast) {
          share = assigned - assignedSoFar; // absorb rounding remainder
        } else {
          share = Math.round((assigned * cap) / totalCap);
        }
        share = Math.min(share, cap);
        tierAssign[id][b.key] = share;
        assignedSoFar += share;
      });
    }
    tierAssigns.push(tierAssign);
    // Track cumulative claims by (building, BR) for the market-scale pass.
    for (const id of Object.keys(tierAssign)) {
      if (!claimedByBuildingBr[id]) {
        claimedByBuildingBr[id] = { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
      }
      for (const k of ["studio", "one_br", "two_br", "three_br", "four_br_plus"] as BrKey[]) {
        claimedByBuildingBr[id][k] += tierAssign[id][k];
      }
    }
  }

  // Scale each market group down by units claimed against THIS building
  // + BR bucket. This lets Building 2's market rows stay fully intact
  // when a tier targeted only Building 3, and scales all buildings in
  // multi-building deals with no targeting (legacy behaviour).
  const marketGroups = marketOnly
    .map((g) => {
      const b = (g.site_plan_building_id || NO_BUILDING) as string;
      const k = bedroomsToKey(g.bedrooms || 0);
      const totalClaimed = claimedByBuildingBr[b]?.[k] || 0;
      const totalCap = capacityByBuildingBr[b]?.[k] || 0;
      // Proportional scale within the building's bucket: if two market
      // rows share a BR (rare, but possible — e.g. renovated vs not),
      // each gets its fair share of the reduction.
      const share = totalCap > 0 ? (g.unit_count || 0) / totalCap : 0;
      const claimed = Math.round(totalClaimed * share);
      const remaining = Math.max(0, (g.unit_count || 0) - claimed);
      const cleanLabel = (g.label || "")
        .replace(/\s*\(Market\)|\s*\(Affordable.*\)/gi, "")
        .trim();
      return {
        ...g,
        id: g.id || uuidv4(),
        label: `${cleanLabel} (Market)`,
        unit_count: remaining,
        is_affordable: false,
      };
    })
    .filter((g) => (g.unit_count || 0) > 0);

  // Emit one affordable group per (tier, building, BR bucket) with
  // units > 0. The resulting row carries site_plan_building_id so
  // Underwriting can keep its per-building grouping correct.
  const affordableGroups: T[] = [];
  config.tiers.forEach((tier, tierIdx) => {
    const assign = tierAssigns[tierIdx];
    for (const buildingId of Object.keys(assign)) {
      for (const b of BR_BUCKETS) {
        const units = assign[buildingId][b.key];
        if (units <= 0) continue;
        // Prefer the base template from the same building when
        // available so the affordable row inherits that building's
        // sf_per_unit etc.
        const sameBuildingBase = marketOnly.find(
          (g) =>
            (g.site_plan_building_id || NO_BUILDING) === buildingId &&
            bedroomsToKey(g.bedrooms || 0) === b.key
        );
        const base =
          (sameBuildingBase as T | undefined) ||
          (marketBaseByBr[b.key] as T | undefined) ||
          fallbackBase;
        const rent = Number((tier as unknown as Record<string, unknown>)[b.rentField] || 0);
        const baseLabel =
          (base?.label || "")
            .replace(/\s*\(Market\)|\s*\(Affordable.*\)/gi, "")
            .trim() || b.label;
        affordableGroups.push({
          ...base,
          id: uuidv4(),
          label: `${baseLabel} (Affordable ${tier.ami_pct}% AMI)`,
          bedrooms: base?.bedrooms ?? b.bedrooms,
          unit_count: units,
          market_rent_per_unit: rent,
          current_rent_per_unit: rent,
          is_affordable: true,
          ami_pct: tier.ami_pct,
          site_plan_building_id:
            buildingId === NO_BUILDING ? (base?.site_plan_building_id ?? null) : buildingId,
        } as T);
      }
    }
  });

  return [...marketGroups, ...affordableGroups];
}
