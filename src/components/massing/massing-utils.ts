import { v4 as uuidv4 } from "uuid";
import type {
  FloorUseType, BuildingFloor, MassingScenario, MassingSummary, BuildingProgram, UnitMixEntry,
} from "@/lib/types";
import { FLOOR_HEIGHT_DEFAULTS, PARKING_ABOVE_GRADE_HEIGHT, FLOOR_USE_TYPE_LABELS, DEFAULT_UNIT_MIX } from "@/lib/types";

// ── Floor factory ────────────────────────────────────────────────────────────

const EFFICIENCY_BY_USE: Record<FloorUseType, number> = {
  parking: 98, retail: 95, lobby_amenity: 60, residential: 80, mechanical: 0, office: 87,
};

export function newFloor(
  use_type: FloorUseType,
  floor_plate_sf: number,
  floor_to_floor_ft?: number,
  is_below_grade = false,
  units_on_floor = 0,
  efficiency_pct?: number,
): BuildingFloor {
  return {
    id: uuidv4(),
    use_type,
    label: "",
    floor_plate_sf,
    floor_to_floor_ft: floor_to_floor_ft ?? (is_below_grade && use_type === "parking" ? FLOOR_HEIGHT_DEFAULTS.parking : use_type === "parking" ? PARKING_ABOVE_GRADE_HEIGHT : FLOOR_HEIGHT_DEFAULTS[use_type]),
    is_below_grade,
    units_on_floor,
    efficiency_pct: efficiency_pct ?? EFFICIENCY_BY_USE[use_type],
    sort_order: 0,
    secondary_use: null,
    secondary_sf: 0,
  };
}

// ── Scenario factory ─────────────────────────────────────────────────────────

export function seedUnitMix(): UnitMixEntry[] {
  return DEFAULT_UNIT_MIX.map(m => ({ id: uuidv4(), ...m }));
}

export function newScenario(name: string, floors: BuildingFloor[] = []): MassingScenario {
  return {
    id: uuidv4(), name, floors, footprint_sf: 0,
    density_bonus_applied: null, density_bonus_far_increase: 0, density_bonus_height_increase_ft: 0,
    notes: "", created_at: new Date().toISOString(), is_baseline: false, linked_uw_scenario_id: null,
    unit_mix: seedUnitMix(),
    parking_sf_per_space: 350,
  };
}

export function newBuildingProgram(): BuildingProgram {
  const scenario = newScenario("Massing 1");
  scenario.is_baseline = true;
  return { scenarios: [scenario], active_scenario_id: scenario.id };
}

// ── Auto-label floors ────────────────────────────────────────────────────────

export function autoLabelFloors(floors: BuildingFloor[]): BuildingFloor[] {
  const below = floors.filter(f => f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);
  const above = floors.filter(f => !f.is_below_grade).sort((a, b) => a.sort_order - b.sort_order);

  // Below grade: P1 (deepest), P2, etc.
  below.forEach((f, i) => {
    f.label = f.use_type === "parking" ? `P${below.length - i}` : `B${below.length - i}`;
  });

  // Above grade: 1 (ground), 2, 3, etc.
  above.forEach((f, i) => {
    const floorNum = i + 1;
    const useLabel = FLOOR_USE_TYPE_LABELS[f.use_type] || f.use_type;
    f.label = `${floorNum} — ${useLabel}`;
  });
  return [...below, ...above];
}

// ── Compute massing summary ──────────────────────────────────────────────────

export interface ZoningInputs {
  land_sf: number;
  far: number;
  lot_coverage_pct: number;
  height_limit_ft: number;
  height_limit_stories: number;
}

export function computeMassingSummary(scenario: MassingScenario, zoning: ZoningInputs): MassingSummary {
  // Defensive: legacy scenario rows written before the Massings refactor
  // sometimes lack a `floors` array. Missing floors just means empty
  // stack — returning NaN would cascade into every summary tile.
  const floors = Array.isArray(scenario.floors) ? scenario.floors : [];
  const aboveFloors = floors.filter(f => !f.is_below_grade);
  const belowFloors = floors.filter(f => f.is_below_grade);

  const total_gsf = floors.reduce((s, f) => s + f.floor_plate_sf, 0);
  const total_nrsf = floors.reduce((s, f) => s + Math.round(f.floor_plate_sf * (f.efficiency_pct / 100)), 0);
  const total_height_ft = aboveFloors.reduce((s, f) => s + f.floor_to_floor_ft, 0);
  const total_below_grade_ft = belowFloors.reduce((s, f) => s + f.floor_to_floor_ft, 0);
  const total_units = floors.reduce((s, f) => s + f.units_on_floor, 0);

  const gsf_by_use: Partial<Record<FloorUseType, number>> = {};
  const nrsf_by_use: Partial<Record<FloorUseType, number>> = {};
  for (const f of floors) {
    // If floor has a secondary use, split SF between primary and secondary
    const primarySF = f.secondary_use && f.secondary_sf > 0 ? f.floor_plate_sf - f.secondary_sf : f.floor_plate_sf;
    gsf_by_use[f.use_type] = (gsf_by_use[f.use_type] || 0) + primarySF;
    nrsf_by_use[f.use_type] = (nrsf_by_use[f.use_type] || 0) + Math.round(primarySF * (f.efficiency_pct / 100));
    if (f.secondary_use && f.secondary_sf > 0) {
      gsf_by_use[f.secondary_use] = (gsf_by_use[f.secondary_use] || 0) + f.secondary_sf;
      // Use a reasonable efficiency for the secondary use
      const secEff = f.secondary_use === "retail" ? 95 : f.secondary_use === "office" ? 87 : f.secondary_use === "parking" ? 98 : 80;
      nrsf_by_use[f.secondary_use] = (nrsf_by_use[f.secondary_use] || 0) + Math.round(f.secondary_sf * (secEff / 100));
    }
  }

  const total_parking_sf = gsf_by_use.parking || 0;
  const sfPerSpace = scenario.parking_sf_per_space || 350;
  const total_parking_spaces_est = Math.floor(total_parking_sf / sfPerSpace);

  const above_grade_gsf = aboveFloors.reduce((s, f) => s + f.floor_plate_sf, 0);
  const effective_far = zoning.land_sf > 0 ? above_grade_gsf / zoning.land_sf : 0;
  const maxPlate = Math.max(...floors.map(f => f.floor_plate_sf), 0);
  const effective_lot_coverage_pct = zoning.land_sf > 0 ? (maxPlate / zoning.land_sf) * 100 : 0;

  const bonusFar = 1 + (scenario.density_bonus_far_increase || 0);
  const max_allowed_far = (zoning.far || 0) * bonusFar;
  const baseHeightFt = zoning.height_limit_ft || (zoning.height_limit_stories * 10) || 0;
  const max_allowed_height_ft = baseHeightFt + (scenario.density_bonus_height_increase_ft || 0);

  return {
    total_gsf, total_nrsf, total_height_ft, total_below_grade_ft,
    above_grade_floors: aboveFloors.length, below_grade_floors: belowFloors.length,
    total_units, total_parking_sf, total_parking_spaces_est,
    gsf_by_use, nrsf_by_use, effective_far, effective_lot_coverage_pct,
    height_compliant: max_allowed_height_ft <= 0 || total_height_ft <= max_allowed_height_ft,
    far_compliant: max_allowed_far <= 0 || effective_far <= max_allowed_far,
    lot_coverage_compliant: !zoning.lot_coverage_pct || effective_lot_coverage_pct <= zoning.lot_coverage_pct,
    max_allowed_far, max_allowed_height_ft,
  };
}

// ── Quick Stack Generators ───────────────────────────────────────────────────
//
// All presets take the ACTIVE building's footprint (in SF) rather than
// deriving one from the parcel area. This matters when a massing has
// multiple buildings — each building has its own drawn footprint, and
// "AI Generate" should shape *that* building, not the lot.

export function quickStackPodium5over1(footprintSF: number): BuildingFloor[] {
  const footprint = Math.max(Math.round(footprintSF), 0);
  const tower = Math.round(footprint * 0.85);
  const unitsPerFloor = Math.floor(tower * 0.80 / 850);
  return autoLabelFloors([
    newFloor("parking", footprint, 10, true),
    newFloor("retail", footprint, 14, false, 0, 95),
    newFloor("residential", tower, 9.5, false, unitsPerFloor),
    newFloor("residential", tower, 9.5, false, unitsPerFloor),
    newFloor("residential", tower, 9.5, false, unitsPerFloor),
    newFloor("residential", tower, 9.5, false, unitsPerFloor),
    newFloor("residential", tower, 9.5, false, unitsPerFloor),
    newFloor("mechanical", Math.round(tower * 0.3), 8, false),
  ]);
}

export function quickStackMidRise3over2(footprintSF: number): BuildingFloor[] {
  const footprint = Math.max(Math.round(footprintSF), 0);
  const unitsPerFloor = Math.floor(footprint * 0.80 / 850);
  return autoLabelFloors([
    newFloor("parking", footprint, 10, true),
    newFloor("parking", footprint, 11, false, 0, 98),
    newFloor("lobby_amenity", footprint, 12, false),
    newFloor("residential", footprint, 9.5, false, unitsPerFloor),
    newFloor("residential", footprint, 9.5, false, unitsPerFloor),
    newFloor("residential", footprint, 9.5, false, unitsPerFloor),
    newFloor("mechanical", Math.round(footprint * 0.25), 8, false),
  ]);
}

export function quickStackHighRise(footprintSF: number): BuildingFloor[] {
  const podium = Math.max(Math.round(footprintSF), 0);
  const tower = Math.round(podium * 0.6);
  const unitsPerFloor = Math.floor(tower * 0.80 / 900);
  const floors: BuildingFloor[] = [
    newFloor("parking", podium, 10, true),
    newFloor("parking", podium, 10, true),
    newFloor("parking", podium, 10, true),
    newFloor("retail", podium, 14, false, 0, 95),
    newFloor("office", tower, 12, false, 0, 87),
    newFloor("office", tower, 12, false, 0, 87),
  ];
  for (let i = 0; i < 8; i++) floors.push(newFloor("residential", tower, 9.5, false, unitsPerFloor));
  floors.push(newFloor("mechanical", Math.round(tower * 0.3), 8, false));
  return autoLabelFloors(floors);
}

export function quickStackGardenStyle(footprintSF: number): BuildingFloor[] {
  const footprint = Math.max(Math.round(footprintSF), 0);
  const unitsPerFloor = Math.floor(footprint * 0.85 / 800);
  return autoLabelFloors([
    newFloor("lobby_amenity", footprint, 10, false),
    newFloor("residential", footprint, 9.5, false, unitsPerFloor),
    newFloor("residential", footprint, 9.5, false, unitsPerFloor),
    newFloor("residential", footprint, 9.5, false, unitsPerFloor),
  ]);
}

export function quickStackAutoFromZoning(
  footprintSF: number, landSF: number, far: number, heightLimitFt: number,
): BuildingFloor[] {
  const footprint = Math.max(Math.round(footprintSF), 0);
  if (footprint <= 0 || far <= 0) return [];
  // GSF cap is still parcel-derived (FAR × land area). If the active
  // building's footprint exceeds what a single-building fill would allow
  // we still let the stack compute — the compliance banner will flag FAR
  // over-runs. When a massing has multiple buildings the cap applies to
  // each building independently here (callers can sum across buildings).
  const maxGSF = landSF > 0 ? Math.round(landSF * far) : Infinity;
  const effectiveHeight = heightLimitFt > 0 ? heightLimitFt : 100;
  const maxResStories = Math.floor((effectiveHeight - 22) / 9.5);
  const tower = Math.round(footprint * 0.85);
  let resStories = maxResStories;
  while (resStories > 0 && (footprint + tower * resStories + tower * 0.3) > maxGSF) resStories--;
  if (resStories <= 0) resStories = 1;

  const unitsPerFloor = Math.floor(tower * 0.80 / 850);
  const floors: BuildingFloor[] = [
    newFloor("parking", footprint, 10, true),
    newFloor("retail", footprint, 14, false, 0, 95),
  ];
  for (let i = 0; i < resStories; i++) floors.push(newFloor("residential", tower, 9.5, false, unitsPerFloor));
  floors.push(newFloor("mechanical", Math.round(tower * 0.3), 8, false));
  return autoLabelFloors(floors);
}
