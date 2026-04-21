// Bulk massing-variant generator.
//
// Given the current zoning constraints (and optionally the active
// scenario's footprint + unit mix), produce a ranked grid of candidate
// stacks — different heights, different unit mixes — so the analyst
// can see the tradeoff space at a glance instead of hand-editing one
// stack at a time. The Algoma article's thesis compressed: "see
// hundreds of options, compressing weeks of work into a few minutes."
//
// Intentionally deterministic and synchronous. No Claude call, no API
// round-trip. Keeps the UX snappy and the server cost at zero.

import { v4 as uuidv4 } from "uuid";
import type { BuildingFloor, UnitMixEntry, FloorUseType } from "@/lib/types";
import { FLOOR_HEIGHT_DEFAULTS } from "@/lib/types";
import { newFloor, autoLabelFloors, seedUnitMix, computeMassingSummary } from "./massing-utils";
import type { ZoningInputs } from "./massing-utils";

export interface ScenarioVariant {
  id: string;                  // ephemeral id — not persisted unless user picks
  label: string;               // short, scannable (e.g. "5-story · family")
  strategy: string;            // explanatory note ("Max height, family unit mix")
  floors: BuildingFloor[];
  unit_mix: UnitMixEntry[];
  footprint_sf: number;
  // Computed projections displayed in the card. Derived from
  // computeMassingSummary + a simple rent/cost hook provided by the
  // caller so the generator stays pure.
  projected_units: number;
  projected_gsf: number;
  projected_nrsf: number;
  height_ft: number;
  stories: number;
  compliance: {
    height_ok: boolean;
    far_ok: boolean;
    coverage_ok: boolean;
  };
}

export interface VariantInputs {
  footprint_sf: number;        // active building's footprint (from site plan)
  land_sf: number;
  far_cap: number;
  height_cap_ft: number;
  lot_coverage_pct: number;
  base_unit_mix?: UnitMixEntry[];  // optional — used as one of the "mix" axes
}

// Three canonical unit-mix flavors for SFR/MFR greenfield. Analysts see
// the same three archetypes across every site, which makes cross-deal
// comparison easy.
const MIX_ARCHETYPES: Array<{ label: string; mix: Array<{ type_label: string; allocation_pct: number; avg_sf: number }> }> = [
  {
    label: "studio-heavy",
    mix: [
      { type_label: "Studio", allocation_pct: 40, avg_sf: 420 },
      { type_label: "1-Br", allocation_pct: 45, avg_sf: 560 },
      { type_label: "2-Br", allocation_pct: 15, avg_sf: 720 },
    ],
  },
  {
    label: "balanced",
    mix: [
      { type_label: "Studio", allocation_pct: 15, avg_sf: 420 },
      { type_label: "1-Br", allocation_pct: 50, avg_sf: 560 },
      { type_label: "2-Br", allocation_pct: 28, avg_sf: 720 },
      { type_label: "3-Br", allocation_pct: 7, avg_sf: 920 },
    ],
  },
  {
    label: "family",
    mix: [
      { type_label: "1-Br", allocation_pct: 25, avg_sf: 580 },
      { type_label: "2-Br", allocation_pct: 50, avg_sf: 900 },
      { type_label: "3-Br", allocation_pct: 25, avg_sf: 1150 },
    ],
  },
];

function buildStack(
  footprintSF: number,
  residentialFloors: number,
  includeParking: "none" | "surface" | "structured_below",
  includeRetail: boolean,
  resFloorToFloor = 9.5,
): BuildingFloor[] {
  const floors: BuildingFloor[] = [];
  if (includeParking === "structured_below") {
    floors.push(newFloor("parking", footprintSF, FLOOR_HEIGHT_DEFAULTS.parking, true));
  }
  if (includeRetail) {
    floors.push(newFloor("retail", footprintSF, FLOOR_HEIGHT_DEFAULTS.retail, false, 0, 95));
  }
  const resFootprint = includeRetail ? Math.round(footprintSF * 0.90) : footprintSF;
  for (let i = 0; i < residentialFloors; i++) {
    floors.push(newFloor("residential", resFootprint, resFloorToFloor, false));
  }
  return autoLabelFloors(floors);
}

function seedMixFromArchetype(archetype: typeof MIX_ARCHETYPES[number]): UnitMixEntry[] {
  return archetype.mix.map(m => ({ id: uuidv4(), ...m }));
}

/**
 * Produce a grid of candidate stacks. The axes are:
 *   - Height: 3 steps — compact / mid / max (respecting the height cap)
 *   - Unit mix: 3 archetypes — studio / balanced / family
 *
 * 3 × 3 = 9 variants. The first variant always exists (compact + studio),
 * later variants may be clipped if they exceed the FAR or height cap.
 * Non-compliant variants are still returned but flagged so the analyst
 * can see the tradeoff ("going one floor taller busts the height cap").
 */
export function generateScenarioVariants(inputs: VariantInputs): ScenarioVariant[] {
  const { footprint_sf, land_sf, far_cap, height_cap_ft, lot_coverage_pct } = inputs;
  if (footprint_sf <= 0) return [];

  // Resolve the height ladder. If no cap is set, cap at 75 ft (~7 stories
  // residential) as a default — prevents runaway variants when zoning
  // isn't dialed in yet.
  const effectiveHeightCap = height_cap_ft > 0 ? height_cap_ft : 75;
  const maxResFloors = Math.max(3, Math.floor(effectiveHeightCap / 9.5));
  const midResFloors = Math.max(2, Math.floor(maxResFloors * 0.66));
  const compactResFloors = Math.max(2, Math.floor(maxResFloors * 0.40));
  const heightSteps: Array<{ label: string; floors: number; includeRetail: boolean; includeParking: "none" | "structured_below" }> = [
    { label: "compact", floors: compactResFloors, includeRetail: false, includeParking: "none" },
    { label: "mid-rise", floors: midResFloors, includeRetail: false, includeParking: "none" },
    { label: "max", floors: maxResFloors, includeRetail: true, includeParking: "structured_below" },
  ];

  const variants: ScenarioVariant[] = [];
  const zoning: ZoningInputs = {
    land_sf,
    far: far_cap,
    lot_coverage_pct,
    height_limit_ft: effectiveHeightCap,
    height_limit_stories: Math.floor(effectiveHeightCap / 9.5),
  };

  for (const h of heightSteps) {
    for (const archetype of MIX_ARCHETYPES) {
      const floors = buildStack(footprint_sf, h.floors, h.includeParking, h.includeRetail);
      const unit_mix = seedMixFromArchetype(archetype);

      // Rough units estimate for the card. Use the same math as the
      // live Massing summary: residential NRSF / weighted avg unit SF.
      const mixWeightedAvgSF = unit_mix.reduce(
        (s, m) => s + m.avg_sf * (m.allocation_pct / 100),
        0
      );
      // Build a throwaway MassingScenario shape just so we can reuse
      // computeMassingSummary. The parking SF rates default to 350 —
      // fine for a preview estimate.
      const tempScenario = {
        id: "preview",
        name: "preview",
        floors,
        footprint_sf,
        density_bonus_applied: null,
        density_bonus_far_increase: 0,
        density_bonus_height_increase_ft: 0,
        notes: "",
        created_at: new Date().toISOString(),
        is_baseline: false,
        linked_uw_scenario_id: null,
        unit_mix,
        parking_sf_per_space: 350,
      };
      const summary = computeMassingSummary(tempScenario, zoning);
      const projectedUnits = mixWeightedAvgSF > 0
        ? Math.floor((summary.nrsf_by_use.residential || 0) / mixWeightedAvgSF)
        : 0;

      variants.push({
        id: uuidv4(),
        label: `${h.floors}-story · ${archetype.label}`,
        strategy: [
          h.label === "compact" ? "Low-rise, surface parking" : h.label === "mid-rise" ? "Mid-rise, surface parking" : "Max height, retail base + structured parking",
          `${archetype.label} unit mix`,
        ].join(" · "),
        floors,
        unit_mix,
        footprint_sf,
        projected_units: projectedUnits,
        projected_gsf: summary.total_gsf,
        projected_nrsf: summary.total_nrsf,
        height_ft: summary.total_height_ft,
        stories: summary.above_grade_floors,
        compliance: {
          height_ok: summary.height_compliant,
          far_ok: summary.far_compliant,
          coverage_ok: summary.lot_coverage_compliant,
        },
      });
    }
  }

  // Rank: compliant variants first, then by projected unit count descending.
  variants.sort((a, b) => {
    const aCompliant = a.compliance.height_ok && a.compliance.far_ok && a.compliance.coverage_ok;
    const bCompliant = b.compliance.height_ok && b.compliance.far_ok && b.compliance.coverage_ok;
    if (aCompliant !== bCompliant) return aCompliant ? -1 : 1;
    return b.projected_units - a.projected_units;
  });

  return variants;
}

// Unused directly — keeping explicit type imports off the list of unused
// exports. Exposes a single function surface for callers.
export type { FloorUseType };
