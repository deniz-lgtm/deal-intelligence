/**
 * Canonical floor-plan unit types. Drives:
 *   - the wizard (user picks one before entering the editor)
 *   - library filter chips
 *   - default `bedrooms` / `bathrooms` denormalized values stored
 *     on the floor_plans row for cheap filtering / metrics math.
 */

export type UnitCategory = "multifamily" | "townhouse" | "sfr";

export interface UnitTypeDef {
  id: string;
  label: string;
  shortLabel: string;
  bedrooms: number;
  bathrooms: number;
  category: UnitCategory;
  /** Typical net SF range, shown as a hint in the wizard. */
  sfRange: [number, number];
}

export const UNIT_TYPES: UnitTypeDef[] = [
  // Multifamily
  { id: "studio",      label: "Studio",          shortLabel: "Studio",  bedrooms: 0, bathrooms: 1,   category: "multifamily", sfRange: [350, 600] },
  { id: "1br_1ba",     label: "1 BR / 1 BA",     shortLabel: "1×1",     bedrooms: 1, bathrooms: 1,   category: "multifamily", sfRange: [550, 850] },
  { id: "1br_1_5ba",   label: "1 BR / 1.5 BA",   shortLabel: "1×1.5",   bedrooms: 1, bathrooms: 1.5, category: "multifamily", sfRange: [650, 900] },
  { id: "2br_1ba",     label: "2 BR / 1 BA",     shortLabel: "2×1",     bedrooms: 2, bathrooms: 1,   category: "multifamily", sfRange: [750, 1000] },
  { id: "2br_2ba",     label: "2 BR / 2 BA",     shortLabel: "2×2",     bedrooms: 2, bathrooms: 2,   category: "multifamily", sfRange: [900, 1200] },
  { id: "2br_2_5ba",   label: "2 BR / 2.5 BA",   shortLabel: "2×2.5",   bedrooms: 2, bathrooms: 2.5, category: "multifamily", sfRange: [1000, 1300] },
  { id: "3br_2ba",     label: "3 BR / 2 BA",     shortLabel: "3×2",     bedrooms: 3, bathrooms: 2,   category: "multifamily", sfRange: [1100, 1450] },
  { id: "3br_2_5ba",   label: "3 BR / 2.5 BA",   shortLabel: "3×2.5",   bedrooms: 3, bathrooms: 2.5, category: "multifamily", sfRange: [1200, 1550] },
  { id: "3br_3ba",     label: "3 BR / 3 BA",     shortLabel: "3×3",     bedrooms: 3, bathrooms: 3,   category: "multifamily", sfRange: [1300, 1700] },
  { id: "4br_2ba",     label: "4 BR / 2 BA",     shortLabel: "4×2",     bedrooms: 4, bathrooms: 2,   category: "multifamily", sfRange: [1400, 1800] },
  // Townhouse
  { id: "th_2br",      label: "Townhouse · 2 BR", shortLabel: "TH 2BR", bedrooms: 2, bathrooms: 2.5, category: "townhouse",   sfRange: [1100, 1500] },
  { id: "th_3br",      label: "Townhouse · 3 BR", shortLabel: "TH 3BR", bedrooms: 3, bathrooms: 2.5, category: "townhouse",   sfRange: [1400, 1900] },
  { id: "th_4br",      label: "Townhouse · 4 BR", shortLabel: "TH 4BR", bedrooms: 4, bathrooms: 3.5, category: "townhouse",   sfRange: [1800, 2400] },
  // Detached SFR
  { id: "sfr_3br",     label: "SFR · 3 BR",       shortLabel: "SFR 3BR", bedrooms: 3, bathrooms: 2,   category: "sfr",        sfRange: [1300, 1800] },
  { id: "sfr_4br",     label: "SFR · 4 BR",       shortLabel: "SFR 4BR", bedrooms: 4, bathrooms: 2.5, category: "sfr",        sfRange: [1700, 2400] },
  { id: "sfr_5br",     label: "SFR · 5 BR",       shortLabel: "SFR 5BR", bedrooms: 5, bathrooms: 3,   category: "sfr",        sfRange: [2200, 3200] },
];

export const UNIT_CATEGORY_LABELS: Record<UnitCategory, string> = {
  multifamily: "Multifamily",
  townhouse:   "Townhouse",
  sfr:         "Single-Family",
};

export function getUnitTypeById(id: string | null | undefined): UnitTypeDef | undefined {
  if (!id) return undefined;
  return UNIT_TYPES.find((u) => u.id === id);
}
