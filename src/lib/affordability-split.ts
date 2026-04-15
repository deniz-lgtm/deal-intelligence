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

  // How many units per BR bucket are claimed as affordable across tiers.
  const affordableByBr: Record<BrKey, number> = {
    studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0,
  };
  for (const t of config.tiers) {
    affordableByBr.studio += Number(t.units_studio || 0);
    affordableByBr.one_br += Number(t.units_1br || 0);
    affordableByBr.two_br += Number(t.units_2br || 0);
    affordableByBr.three_br += Number(t.units_3br || 0);
    affordableByBr.four_br_plus += Number(t.units_4br_plus || 0);
  }

  // Scale each market group down by units claimed in its bucket.
  const marketGroups = marketOnly
    .map((g) => {
      const key = bedroomsToKey(g.bedrooms || 0);
      const claimed = affordableByBr[key] || 0;
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

  // Emit one affordable group per (tier, BR bucket) with units > 0.
  const affordableGroups: T[] = [];
  for (const tier of config.tiers) {
    for (const b of BR_BUCKETS) {
      const units = Number((tier as unknown as Record<string, unknown>)[b.unitsField] || 0);
      if (units <= 0) continue;
      const base = (marketBaseByBr[b.key] as T | undefined) || fallbackBase;
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
      } as T);
    }
  }

  return [...marketGroups, ...affordableGroups];
}
