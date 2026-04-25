import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { underwritingQueries } from "@/lib/db";
import { DEFAULT_UNIT_MIX } from "@/lib/types";
import type {
  SitePlanScenario,
  SitePlanBuilding,
  SitePlanPoint,
  MassingScenario,
  UnitMixEntry,
  BuildingFloor,
} from "@/lib/types";
import type { GiraffeAction } from "@/lib/giraffe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface CommitBody {
  massing_name: string;
  actions: GiraffeAction[];
  /**
   * Per-field overwrite flags for zoning fills. Keyed by the same
   * enum used in GiraffeAction.field. Defaults to false — the UI
   * starts with all overwrite boxes unchecked so we never silently
   * stomp analyst-entered zoning values.
   */
  overwrite: Partial<Record<string, boolean>>;
  /**
   * Analyst-supplied massing name override (optional). If absent we
   * fall back to the auto-generated one.
   */
  name_override?: string | null;
}

interface LegacyUwRow {
  data: string | Record<string, unknown> | null;
}

function parseData(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

/**
 * Step 2 of the Giraffe import flow. Takes the preview action list
 * (filtered by the analyst) and writes:
 *  - a new SitePlanScenario with its parcel polygon + building
 *    footprints, appended to underwriting.data.site_plan.scenarios
 *  - a new MassingScenario per building with the imported unit mix
 *    and parking assumptions, appended to
 *    underwriting.data.building_program.scenarios
 *  - zoning field fills (FAR, height, setbacks, parking ratios),
 *    only overwriting an existing value when the matching overwrite
 *    flag is true
 *
 * Everything goes into the legacy underwriting row via a single PUT
 * so the existing per-massing sync logic in /api/underwriting keeps
 * the per-massing snapshots in lock-step.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = (await req.json()) as CommitBody;
    if (!Array.isArray(body.actions) || body.actions.length === 0) {
      return NextResponse.json(
        { error: "No actions to commit" },
        { status: 400 }
      );
    }

    const legacy = (await underwritingQueries.getByDealId(params.id)) as LegacyUwRow | null;
    const data = parseData(legacy?.data);

    // ── Site plan — append a new massing with parcel + buildings ──
    const createAction = body.actions.find(
      (a): a is Extract<GiraffeAction, { type: "create_massing" }> => a.type === "create_massing"
    );
    let newMassingId: string | null = null;
    const buildingIdByLabel = new Map<string, string>();

    const existingSitePlan = (data.site_plan as {
      scenarios?: SitePlanScenario[];
      active_scenario_id?: string | null;
      center_lat?: number | null;
      center_lng?: number | null;
      zoom?: number;
      map_style?: "satellite" | "streets" | "dark" | "light";
      show_setbacks?: boolean;
      snap_grid_ft?: number;
    } | undefined) || {};
    const existingScenarios = Array.isArray(existingSitePlan.scenarios)
      ? existingSitePlan.scenarios
      : [];

    if (createAction) {
      newMassingId = randomUUID();
      const buildings: SitePlanBuilding[] = createAction.buildings.map((b) => {
        const id = randomUUID();
        buildingIdByLabel.set(b.label, id);
        return {
          id,
          label: b.label,
          points: b.points as SitePlanPoint[],
          area_sf: b.area_sf,
        };
      });
      const scenario: SitePlanScenario = {
        id: newMassingId,
        name: body.name_override?.trim() || body.massing_name || "Giraffe Import",
        parcel_points: createAction.parcel_polygon as SitePlanPoint[],
        parcel_area_sf: createAction.parcel_area_sf,
        buildings,
        active_building_id: buildings[0]?.id ?? null,
        created_at: new Date().toISOString(),
        // Only claim base_case if no other scenarios exist — we never
        // silently demote a user-chosen base case.
        is_base_case: existingScenarios.length === 0 ? true : false,
      };
      const nextScenarios = [...existingScenarios, scenario];
      data.site_plan = {
        center_lat: existingSitePlan.center_lat ?? null,
        center_lng: existingSitePlan.center_lng ?? null,
        zoom: existingSitePlan.zoom ?? 18,
        map_style: existingSitePlan.map_style ?? "satellite",
        show_setbacks: existingSitePlan.show_setbacks ?? true,
        snap_grid_ft: existingSitePlan.snap_grid_ft ?? 0,
        scenarios: nextScenarios,
        // Switch focus to the freshly imported massing so the Site &
        // Zoning page lands on it when the analyst navigates over.
        active_scenario_id: newMassingId,
      };
    }

    // ── Programming — one MassingScenario per seeded building ────
    const programActions = body.actions.filter(
      (a): a is Extract<GiraffeAction, { type: "seed_programming" }> => a.type === "seed_programming"
    );
    if (programActions.length > 0 && newMassingId) {
      const existingBp = (data.building_program as {
        scenarios?: MassingScenario[];
        active_scenario_id?: string;
      } | undefined) || {};
      const existingScenarioRows = Array.isArray(existingBp.scenarios) ? existingBp.scenarios : [];
      const newScenarios: MassingScenario[] = [];
      for (const pa of programActions) {
        const buildingId = buildingIdByLabel.get(pa.building_label);
        const floors = buildFloors(pa);
        const unitMix = pa.unit_mix.length > 0
          ? pa.unit_mix
          : DEFAULT_UNIT_MIX.map((e, i): UnitMixEntry => ({
              id: `um_seed_${i}_${Date.now()}`,
              type_label: e.type_label,
              allocation_pct: e.allocation_pct,
              avg_sf: e.avg_sf,
            }));
        // If the analyst-provided mix doesn't sum to 100, proportionally
        // normalize so downstream pro forma math stays sane. We never
        // silently drop user-supplied values — just scale them.
        const mixSum = unitMix.reduce((s, u) => s + (u.allocation_pct || 0), 0);
        const normalizedMix =
          mixSum > 0 && Math.abs(mixSum - 100) > 0.5
            ? unitMix.map((u) => ({ ...u, allocation_pct: (u.allocation_pct / mixSum) * 100 }))
            : unitMix;

        // Parking rates: turn declared parking count + type into a
        // SF/space rate for the matching slot. 350/400/500 are the
        // typical surface/structured/underground industry defaults;
        // analyst can edit in Programming.
        const parkingType = pa.parking_type ?? "surface";
        const parking_surface_sf_per_space = parkingType === "surface" ? 350 : 350;
        const parking_structured_sf_per_space = parkingType === "structured" ? 400 : 400;
        const parking_underground_sf_per_space = parkingType === "underground" ? 500 : 500;

        newScenarios.push({
          id: randomUUID(),
          name: `${pa.building_label} — Base`,
          floors,
          footprint_sf: pa.footprint_sf,
          density_bonus_applied: null,
          density_bonus_far_increase: 0,
          density_bonus_height_increase_ft: 0,
          notes: "",
          created_at: new Date().toISOString(),
          is_baseline: true,
          linked_uw_scenario_id: null,
          unit_mix: normalizedMix,
          parking_sf_per_space: parkingType === "surface" ? 350 : parkingType === "structured" ? 400 : 500,
          parking_surface_sf_per_space,
          parking_structured_sf_per_space,
          parking_underground_sf_per_space,
          site_plan_building_id: buildingId ?? null,
          site_plan_scenario_id: newMassingId,
          ai_template_label: null,
        });
      }
      const nextScenarios = [...existingScenarioRows, ...newScenarios];
      data.building_program = {
        ...existingBp,
        scenarios: nextScenarios,
        active_scenario_id: newScenarios[0]?.id || existingBp.active_scenario_id || "",
      };
    }

    // ── Zoning auto-fills ─────────────────────────────────────────
    const fillActions = body.actions.filter(
      (a): a is Extract<GiraffeAction, { type: "fill_zoning" }> => a.type === "fill_zoning"
    );
    if (fillActions.length > 0) {
      const existingZoning = (data.zoning_info as Record<string, unknown> | undefined) || {};
      const existingDev = (data.dev_params as Record<string, unknown> | undefined) || {};
      const nextZoning: Record<string, unknown> = { ...existingZoning };
      const nextDev: Record<string, unknown> = { ...existingDev };

      const existingSetbacks = Array.isArray(existingZoning.setbacks)
        ? (existingZoning.setbacks as Array<{ label: string; feet: number | null }>)
        : [
            { label: "Front", feet: null },
            { label: "Side", feet: null },
            { label: "Rear", feet: null },
            { label: "Corner Side", feet: null },
          ];
      const existingHeights = Array.isArray(existingZoning.height_limits)
        ? (existingZoning.height_limits as Array<{ label: string; feet: number | null; stories: number | null; connector: "and" | "or" }>)
        : [{ label: "Base Zoning", feet: null, stories: null, connector: "and" as const }];

      const canOverwrite = (field: string) => body.overwrite?.[field] === true;

      for (const f of fillActions) {
        switch (f.field) {
          case "far":
            if (existingZoning.far == null || canOverwrite(f.field)) {
              nextZoning.far = f.value;
              nextDev.far = f.value;
            }
            break;
          case "lot_coverage_pct":
            if (existingZoning.lot_coverage_pct == null || canOverwrite(f.field)) {
              nextZoning.lot_coverage_pct = f.value;
              nextDev.lot_coverage_pct = f.value;
            }
            break;
          case "height_ft": {
            const base = existingHeights[0];
            if (base.feet == null || canOverwrite(f.field)) {
              existingHeights[0] = { ...base, feet: f.value };
            }
            break;
          }
          case "height_stories": {
            const base = existingHeights[0];
            if (base.stories == null || canOverwrite(f.field)) {
              existingHeights[0] = { ...base, stories: f.value };
            }
            if (existingDev.height_limit_stories == null || canOverwrite(f.field)) {
              nextDev.height_limit_stories = f.value;
            }
            break;
          }
          case "setback_front":
          case "setback_side":
          case "setback_rear":
          case "setback_corner": {
            const label = SETBACK_LABEL[f.field];
            const idx = existingSetbacks.findIndex((s) => s.label === label);
            if (idx >= 0) {
              const prior = existingSetbacks[idx];
              if (prior.feet == null || canOverwrite(f.field)) {
                existingSetbacks[idx] = { ...prior, feet: f.value };
              }
            }
            break;
          }
          case "parking_ratio_residential":
            if (!existingZoning.parking_ratio_residential || canOverwrite(f.field)) {
              nextZoning.parking_ratio_residential = f.value;
            }
            break;
          case "parking_ratio_commercial":
            if (!existingZoning.parking_ratio_commercial || canOverwrite(f.field)) {
              nextZoning.parking_ratio_commercial = f.value;
            }
            break;
        }
      }
      nextZoning.setbacks = existingSetbacks;
      nextZoning.height_limits = existingHeights;
      data.zoning_info = nextZoning;
      data.dev_params = nextDev;
    }

    // ── Site info land_sf auto-fill ──────────────────────────────
    // If the existing site_info has no land_sf and we created a
    // massing, seed it from the parcel area. Non-destructive.
    if (createAction) {
      const siteInfo = (data.site_info as Record<string, unknown> | undefined) || {};
      if (!siteInfo.land_sf) {
        data.site_info = {
          ...siteInfo,
          land_sf: createAction.parcel_area_sf,
          land_acres: Math.round((createAction.parcel_area_sf / 43560) * 1000) / 1000,
        };
      }
    }

    // ── Persist via the underwriting PUT (legacy path) ───────────
    const origin = new URL(req.url).origin;
    const putRes = await fetch(`${origin}/api/underwriting`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({ deal_id: params.id, data }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      console.error("giraffe-import/commit: underwriting PUT failed:", err);
      return NextResponse.json(
        { error: "Failed to persist import" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        massing_id: newMassingId,
        seeded_scenarios: programActions.length,
        filled_zoning: fillActions.length,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/giraffe-import/commit error:", error);
    return NextResponse.json(
      { error: "Failed to commit Giraffe import" },
      { status: 500 }
    );
  }
}

const SETBACK_LABEL: Record<string, string> = {
  setback_front: "Front",
  setback_side: "Side",
  setback_rear: "Rear",
  setback_corner: "Corner Side",
};

/**
 * Turn a per-building seed into a floor stack. If Giraffe gave us an
 * explicit floor count we materialize that many residential floors at
 * a default 10.5' floor-to-floor + 85% efficiency. If only a unit
 * count is present we infer floors by dividing units by a typical 20
 * units/floor; analyst tunes in Programming.
 */
function buildFloors(pa: Extract<GiraffeAction, { type: "seed_programming" }>): BuildingFloor[] {
  const inferredFloors =
    pa.floors != null
      ? Math.max(1, Math.round(pa.floors))
      : pa.unit_count != null
        ? Math.max(1, Math.ceil(pa.unit_count / 20))
        : 1;
  const unitsPerFloor = pa.unit_count != null ? Math.ceil(pa.unit_count / inferredFloors) : 0;
  const floors: BuildingFloor[] = [];
  for (let i = 0; i < inferredFloors; i++) {
    floors.push({
      id: `f_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      use_type: "residential",
      label: `L${i + 1}`,
      floor_plate_sf: pa.footprint_sf,
      floor_to_floor_ft: 10.5,
      is_below_grade: false,
      units_on_floor: unitsPerFloor,
      efficiency_pct: 85,
      sort_order: i,
      additional_uses: [],
    });
  }
  return floors;
}
