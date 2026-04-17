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
 * Two allocation models (picked via `config.allocation_mode`):
 *   • "replacement" (default) — the typical US inclusionary-zoning
 *     pattern (NYC MIH, most California local IZ, Boston IDP).
 *     Affordable units carve OUT of the market-rate share; total unit
 *     count is preserved.
 *   • "additive" — density-bonus jurisdictions (CA State Density
 *     Bonus Law, NYC Voluntary IH with bonus, MA 40B, NJ COAH RDP).
 *     Affordable units are ADDED on top of the market baseline; total
 *     unit count grows by the sum of affordable units.
 *
 * Rules kept deliberately boring:
 *   • Each affordable row gets its own group (cloned from the matching
 *     market template) so the analyst can adjust sf_per_unit etc.
 *     independently — affordable units are typically smaller.
 *   • Replacement mode: market groups are scaled down by exactly the
 *     number of units claimed in their BR bucket.
 *   • Additive mode: market rows are left untouched; affordable rows
 *     stack on top.
 *   • Any unclaimed BR bucket stays untouched. 4BR+ falls back to the
 *     first market group's template when the building doesn't have a
 *     4BR group (bedrooms defaults to 4 in that case).
 *   • Idempotent on re-split: any previous `is_affordable` rows are
 *     folded back into the matching market rows (same building + BR)
 *     before recomputing, so running the split twice with a DIFFERENT
 *     tier configuration doesn't silently drop units. In replacement
 *     mode the restored baseline becomes the new capacity; in additive
 *     mode the restored baseline becomes the "market baseline" on top
 *     of which the new affordable requirement is layered.
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
  /**
   * How affordable units relate to the market baseline.
   *   "replacement" (default) — affordable units carve out of the
   *       market share; total unit count is preserved.
   *   "additive" — affordable units are added on top of the market
   *       baseline (density-bonus / 40B-style); total unit count
   *       grows by sum of affordable units.
   * Undefined / any other value is treated as "replacement" so the
   * change is safe for legacy configs that don't carry this field.
   */
  allocation_mode?: "replacement" | "additive";
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

  const NO_BUILDING = "__no_building__";
  const mode: "replacement" | "additive" =
    config.allocation_mode === "additive" ? "additive" : "replacement";

  // Recover the pre-split market baseline when the previous split was
  // in REPLACEMENT mode — repeated calls with a DIFFERENT tier
  // configuration would otherwise shrink the market baseline each
  // time (e.g. 100 → 80 → 50 …). We fold each existing affordable row
  // back into a matching market row (same building + BR), recreating
  // a synthetic market row when no match exists.
  //
  // In ADDITIVE mode affordable rows were net-new on top of market,
  // so we just discard them — the market rows already represent the
  // correct baseline and re-adding affordable counts would inflate
  // the market side on every re-split.
  const marketOnlyRaw = unitGroups.filter((g) => !g.is_affordable);
  const existingAffordable = unitGroups.filter((g) => g.is_affordable);

  // Clone market rows so we can mutate unit_count during restore
  // without touching the caller's objects.
  const marketOnly: T[] = marketOnlyRaw.map((g) => ({ ...g }));

  if (mode === "replacement" && existingAffordable.length > 0) {
    // Sum existing affordable counts + stash a template row per
    // (building, BR) for the "no matching market row" fallback.
    const affordableCountByBuildingBr: Record<string, Record<BrKey, number>> = {};
    const affordableTemplateByBuildingBr: Record<string, Partial<Record<BrKey, T>>> = {};
    for (const g of existingAffordable) {
      const b = (g.site_plan_building_id || NO_BUILDING) as string;
      const k = bedroomsToKey(g.bedrooms || 0);
      if (!affordableCountByBuildingBr[b]) {
        affordableCountByBuildingBr[b] = {
          studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0,
        };
      }
      affordableCountByBuildingBr[b][k] += g.unit_count || 0;
      if (!affordableTemplateByBuildingBr[b]) affordableTemplateByBuildingBr[b] = {};
      if (!affordableTemplateByBuildingBr[b][k]) affordableTemplateByBuildingBr[b][k] = g;
    }

    // Current market sums (to drive proportional restore within buckets).
    const marketSumByBuildingBr: Record<string, Record<BrKey, number>> = {};
    for (const g of marketOnly) {
      const b = (g.site_plan_building_id || NO_BUILDING) as string;
      const k = bedroomsToKey(g.bedrooms || 0);
      if (!marketSumByBuildingBr[b]) {
        marketSumByBuildingBr[b] = {
          studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0,
        };
      }
      marketSumByBuildingBr[b][k] += g.unit_count || 0;
    }

    // Fold the affordable counts back into the matching market rows.
    for (const [b, byBr] of Object.entries(affordableCountByBuildingBr)) {
      for (const k of ["studio", "one_br", "two_br", "three_br", "four_br_plus"] as BrKey[]) {
        const toRestore = byBr[k];
        if (toRestore <= 0) continue;
        const marketSum = marketSumByBuildingBr[b]?.[k] || 0;
        if (marketSum > 0) {
          // Distribute restored units across the matching market rows
          // proportional to each row's current share, with the last
          // row absorbing any rounding remainder.
          const matchingRows = marketOnly.filter(
            (g) =>
              ((g.site_plan_building_id || NO_BUILDING) as string) === b &&
              bedroomsToKey(g.bedrooms || 0) === k
          );
          let restoredSoFar = 0;
          matchingRows.forEach((row, i) => {
            const isLast = i === matchingRows.length - 1;
            const share = isLast
              ? toRestore - restoredSoFar
              : Math.round((toRestore * (row.unit_count || 0)) / marketSum);
            row.unit_count = (row.unit_count || 0) + share;
            restoredSoFar += share;
          });
        } else {
          // No matching market row — synthesize one from the
          // affordable template so this (building, BR) bucket is
          // represented in the new capacity baseline. Strips the
          // affordability-specific fields.
          const template = affordableTemplateByBuildingBr[b]?.[k];
          if (template) {
            const cleanLabel = (template.label || "")
              .replace(/\s*\(Affordable.*\)/gi, "")
              .trim() || "Market";
            marketOnly.push({
              ...template,
              id: uuidv4(),
              label: cleanLabel,
              unit_count: toRestore,
              is_affordable: false,
              ami_pct: undefined,
            } as T);
          }
        }
      }
    }
  }

  if (marketOnly.length === 0) return unitGroups;

  // Map each BR bucket to a template group pulled from the restored
  // market rows.
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
  const claimedByBuildingBr: Record<string, Record<BrKey, number>> = {};
  // Capacity per (building, BR) = how many market units exist there
  // right now, AFTER restoring prior affordable rows. In replacement
  // mode we clamp tier allocations to this so an aggressive tier can't
  // "take" more affordable units than the building offers. In additive
  // mode the clamp is skipped (affordable units stack on top rather
  // than carving out).
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
      const totalCap = effectiveTargets.reduce(
        (s, id) => s + (capacityByBuildingBr[id]?.[b.key] || 0),
        0
      );
      // In additive mode a bucket with zero capacity is fine — the
      // affordable units are net-new. In replacement mode we skip it
      // because there's nothing to carve from.
      if (mode === "replacement" && totalCap <= 0) continue;
      // Replacement: clamp to available capacity (can't take more
      // than exists). Additive: take exactly what the tier asks for.
      const assigned = mode === "replacement" ? Math.min(want, totalCap) : want;
      // Distribute proportionally to each target's capacity. If
      // capacity is zero across the targets (additive, new bucket),
      // spread evenly across the effective targets so the affordable
      // rows still land on a building.
      let assignedSoFar = 0;
      const evenSpread = totalCap <= 0;
      effectiveTargets.forEach((id, i) => {
        const cap = capacityByBuildingBr[id]?.[b.key] || 0;
        const isLast = i === effectiveTargets.length - 1;
        let share: number;
        if (isLast) {
          share = assigned - assignedSoFar; // absorb rounding remainder
        } else if (evenSpread) {
          share = Math.round(assigned / effectiveTargets.length);
        } else {
          share = Math.round((assigned * cap) / totalCap);
        }
        if (mode === "replacement") {
          share = Math.min(share, cap);
        }
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

  // Replacement mode: scale each market group down by units claimed
  // against THIS (building, BR) bucket. Preserves total unit count.
  // Additive mode: market rows pass through untouched — the affordable
  // units are net-new, total grows by the sum of affordable.
  const marketGroups = marketOnly
    .map((g) => {
      const b = (g.site_plan_building_id || NO_BUILDING) as string;
      const k = bedroomsToKey(g.bedrooms || 0);
      const cleanLabel = (g.label || "")
        .replace(/\s*\(Market\)|\s*\(Affordable.*\)/gi, "")
        .trim();
      if (mode === "additive") {
        return {
          ...g,
          id: g.id || uuidv4(),
          label: `${cleanLabel} (Market)`,
          is_affordable: false,
        };
      }
      const totalClaimed = claimedByBuildingBr[b]?.[k] || 0;
      const totalCap = capacityByBuildingBr[b]?.[k] || 0;
      // Proportional scale within the building's bucket: if two market
      // rows share a BR (rare, but possible — e.g. renovated vs not),
      // each gets its fair share of the reduction.
      const share = totalCap > 0 ? (g.unit_count || 0) / totalCap : 0;
      const claimed = Math.round(totalClaimed * share);
      const remaining = Math.max(0, (g.unit_count || 0) - claimed);
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
