/**
 * Giraffe GeoJSON importer — parser + property mapper.
 *
 * Giraffe (giraffe.build) exports feasibility / massing studies as
 * GeoJSON. We treat their export as the source of truth for geometry
 * (parcel polygon + building footprints) and a best-effort source for
 * program assumptions (FAR, height, unit count, unit mix, parking).
 *
 * This module is intentionally pure — no fetch, no I/O, no DB. Given a
 * parsed GeoJSON object, it returns a normalized `GiraffeParsed` that
 * the preview endpoint decorates into an action list, and the commit
 * endpoint turns into DB writes.
 *
 * Unknown property keys are collected into `unmappedKeys` so the
 * caller can optionally hand them to Claude (see `giraffe-claude.ts`).
 * The strict mapping table here covers the common Giraffe output
 * shapes; the LLM fallback catches drift.
 */

import type {
  SitePlanPoint,
  UnitMixEntry,
} from "./types";

// ─── Input GeoJSON shapes (narrow — we only touch what we need) ────

interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number];
}

interface GeoJSONPolygon {
  type: "Polygon";
  // coordinates[0] is the outer ring as [lng, lat] pairs. Holes ignored
  // for now — Giraffe buildings with courtyards come through as simple
  // polygons in practice, and our SitePlanBuilding has a separate
  // cutouts[] field for courtyards that we'd have to reconstruct from
  // inner rings anyway (future work).
  coordinates: number[][][];
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONPoint | GeoJSONPolygon | { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
}

export interface GiraffeGeoJSON {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

// ─── Normalized output shapes ──────────────────────────────────────

export interface GiraffeBuildingInput {
  name: string;
  polygon: SitePlanPoint[];
  footprint_sf: number;
  height_ft: number | null;
  floors: number | null;
  unit_count: number | null;
  unit_mix: UnitMixEntry[];
  parking_spaces: number | null;
  parking_type: "surface" | "structured" | "underground" | null;
  /** Unmapped property keys, kept for optional Claude fallback. */
  unmappedKeys: string[];
}

export interface GiraffeParcelInput {
  polygon: SitePlanPoint[];
  area_sf: number | null;
  /** Unmapped property keys from the parcel feature. */
  unmappedKeys: string[];
}

export interface GiraffeZoningInput {
  far: number | null;
  height_ft: number | null;
  height_stories: number | null;
  lot_coverage_pct: number | null;
  setbacks: {
    front: number | null;
    side: number | null;
    rear: number | null;
    corner: number | null;
  };
  parking_ratio_residential: number | null;
  parking_ratio_commercial: number | null;
}

export interface GiraffeParsed {
  name: string | null;
  parcel: GiraffeParcelInput | null;
  buildings: GiraffeBuildingInput[];
  zoning: GiraffeZoningInput;
  /** All unknown property keys across every feature. */
  allUnmappedKeys: string[];
  /** Non-fatal warnings surfaced to the analyst in the preview UI. */
  warnings: string[];
}

// ─── Property synonym tables ───────────────────────────────────────
//
// Giraffe users can attach arbitrary properties to GeoJSON features.
// We canonicalize common spellings up front; anything not listed here
// lands in unmappedKeys for the optional LLM fallback.

const PARCEL_AREA_SYNONYMS = [
  "site_area_sf", "site_area", "parcel_area_sf", "parcel_area",
  "land_sf", "lot_area_sf", "lot_area", "area_sf", "area",
];
const FAR_SYNONYMS = [
  "far", "allowed_far", "max_far", "target_far", "effective_far",
];
const HEIGHT_FT_SYNONYMS = [
  "height_ft", "allowed_height_ft", "max_height_ft", "building_height_ft",
  "height", "height_limit",
];
const HEIGHT_STORIES_SYNONYMS = [
  "height_stories", "max_stories", "stories_allowed", "floors_allowed",
];
const LOT_COVERAGE_SYNONYMS = [
  "lot_coverage_pct", "lot_coverage", "coverage_pct", "site_coverage_pct",
];
const UNIT_COUNT_SYNONYMS = [
  "unit_count", "units", "total_units", "num_units", "unit_total",
];
const PARKING_SPACES_SYNONYMS = [
  "parking_spaces", "parking_count", "num_parking_spaces",
  "total_parking_spaces", "spaces",
];
const PARKING_TYPE_SYNONYMS = [
  "parking_type", "parking_configuration", "parking_style",
];
const FLOORS_SYNONYMS = [
  "floors", "num_floors", "levels", "stories",
];
const FOOTPRINT_SF_SYNONYMS = [
  "footprint_sf", "footprint", "base_sf", "ground_floor_sf",
];
const UNIT_MIX_SYNONYMS = [
  "unit_mix", "units_by_type", "unit_breakdown", "unit_types",
];
const SETBACK_FRONT_SYNONYMS = [
  "setback_front", "front_setback", "setback.front", "front_yard",
];
const SETBACK_SIDE_SYNONYMS = [
  "setback_side", "side_setback", "setback.side", "side_yard",
];
const SETBACK_REAR_SYNONYMS = [
  "setback_rear", "rear_setback", "setback.rear", "rear_yard",
];
const SETBACK_CORNER_SYNONYMS = [
  "setback_corner", "corner_setback", "corner_side_setback", "setback.corner",
];

/**
 * Combined list of every synonym we recognize. Anything not in this
 * set is pushed to unmappedKeys so the optional LLM pass can try to
 * map it.
 */
const KNOWN_KEYS = new Set<string>([
  ...PARCEL_AREA_SYNONYMS,
  ...FAR_SYNONYMS,
  ...HEIGHT_FT_SYNONYMS,
  ...HEIGHT_STORIES_SYNONYMS,
  ...LOT_COVERAGE_SYNONYMS,
  ...UNIT_COUNT_SYNONYMS,
  ...PARKING_SPACES_SYNONYMS,
  ...PARKING_TYPE_SYNONYMS,
  ...FLOORS_SYNONYMS,
  ...FOOTPRINT_SF_SYNONYMS,
  ...UNIT_MIX_SYNONYMS,
  ...SETBACK_FRONT_SYNONYMS,
  ...SETBACK_SIDE_SYNONYMS,
  ...SETBACK_REAR_SYNONYMS,
  ...SETBACK_CORNER_SYNONYMS,
  // Classifier / label keys — recognized but not mapped to a field.
  "feature_type", "type", "category", "kind", "name", "label",
  "building_name", "building_label",
  // Nested setbacks object keeps these as sub-keys.
  "setbacks",
]);

// ─── Low-level helpers ─────────────────────────────────────────────

function pickNumber(props: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[,$%]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Shoelace formula in SF. Giraffe coordinates are lng/lat in EPSG:4326;
 * we project to an equirectangular approximation around the polygon's
 * centroid. For parcel-sized polygons (<1 km across) the error is
 * sub-percent, which is fine for a feasibility-study seed. Users can
 * correct in the site-zoning page if they need cadastral precision.
 */
function polygonAreaSf(ring: SitePlanPoint[]): number {
  if (ring.length < 3) return 0;
  const latAvg = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((latAvg * Math.PI) / 180);
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ax = a.lng * metersPerDegLng;
    const ay = a.lat * metersPerDegLat;
    const bx = b.lng * metersPerDegLng;
    const by = b.lat * metersPerDegLat;
    acc += ax * by - bx * ay;
  }
  const sqMeters = Math.abs(acc) / 2;
  return sqMeters * 10.7639; // m² → ft²
}

function coordsToPoints(coords: number[][]): SitePlanPoint[] {
  // Drop the duplicate closing vertex GeoJSON requires — our schema
  // stores open polygons.
  const last = coords.length - 1;
  const trimmed =
    last > 0 && coords[0][0] === coords[last][0] && coords[0][1] === coords[last][1]
      ? coords.slice(0, last)
      : coords;
  return trimmed.map(([lng, lat]) => ({ lat, lng }));
}

function collectUnmapped(props: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(props)) {
    if (!KNOWN_KEYS.has(k) && !KNOWN_KEYS.has(k.toLowerCase())) {
      out.push(k);
    }
  }
  return out;
}

// ─── Unit-mix normalizer ───────────────────────────────────────────

interface RawUnitMixRow {
  type?: string;
  type_label?: string;
  unit_type?: string;
  name?: string;
  count?: number;
  units?: number;
  avg_sf?: number;
  sf?: number;
  size_sf?: number;
  allocation_pct?: number;
  pct?: number;
}

function normalizeUnitMix(raw: unknown, fallbackTotal: number | null): UnitMixEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const rows = raw as RawUnitMixRow[];
  // Prefer explicit counts; if the export only gives us percentages we
  // pass those through directly.
  const hasCounts = rows.some((r) => (r.count ?? r.units) != null);
  const totalCount = hasCounts
    ? rows.reduce((s, r) => s + (r.count ?? r.units ?? 0), 0)
    : null;
  const entries: UnitMixEntry[] = rows.map((r, i) => {
    const label = r.type_label || r.type || r.unit_type || r.name || `Type ${i + 1}`;
    const count = r.count ?? r.units ?? null;
    const avgSf = r.avg_sf ?? r.sf ?? r.size_sf ?? 0;
    let pct = r.allocation_pct ?? r.pct ?? null;
    if (pct == null) {
      if (hasCounts && totalCount && totalCount > 0) {
        pct = (Number(count ?? 0) / totalCount) * 100;
      } else if (fallbackTotal && count != null) {
        pct = (Number(count) / fallbackTotal) * 100;
      } else {
        pct = 100 / rows.length;
      }
    }
    return {
      id: `um_${i}_${Date.now()}`,
      type_label: String(label),
      allocation_pct: Number(pct) || 0,
      avg_sf: Number(avgSf) || 0,
    };
  });
  return entries;
}

// ─── Feature classification ────────────────────────────────────────

type FeatureRole = "parcel" | "building" | "other";

function classifyFeature(feature: GeoJSONFeature): FeatureRole {
  const props = feature.properties || {};
  const typeHint =
    (typeof props.feature_type === "string" && props.feature_type) ||
    (typeof props.type === "string" && props.type) ||
    (typeof props.category === "string" && props.category) ||
    (typeof props.kind === "string" && props.kind) ||
    "";
  const normalized = typeHint.toLowerCase();
  if (
    normalized.includes("parcel") ||
    normalized.includes("site") ||
    normalized.includes("lot") ||
    normalized.includes("property")
  ) {
    return "parcel";
  }
  if (
    normalized.includes("building") ||
    normalized.includes("structure") ||
    normalized.includes("tower") ||
    normalized.includes("massing")
  ) {
    return "building";
  }
  // No classifier property — infer from geometry: the parcel is the
  // largest polygon (usually the only one containing the others). We
  // defer the size comparison to the caller since we don't know the
  // full feature set here.
  return "other";
}

// ─── Main parser ───────────────────────────────────────────────────

export function parseGiraffeGeoJSON(raw: unknown): GiraffeParsed {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    throw new Error("Not a valid GeoJSON object");
  }
  const gj = raw as GiraffeGeoJSON;
  if (gj.type !== "FeatureCollection" || !Array.isArray(gj.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection");
  }
  if (gj.features.length === 0) {
    throw new Error("FeatureCollection has no features");
  }

  // Polygon features only; drop points, lines, everything else.
  const polygons = gj.features.filter(
    (f) => f.geometry && f.geometry.type === "Polygon"
  );
  if (polygons.length === 0) {
    throw new Error("No polygon features found in the GeoJSON");
  }

  // First pass: split into parcel vs building using the classifier.
  // Anything left as "other" goes through a second pass: the largest
  // polygon wins the parcel slot, the rest become buildings.
  const parcels: GeoJSONFeature[] = [];
  const buildings: GeoJSONFeature[] = [];
  const others: GeoJSONFeature[] = [];
  for (const f of polygons) {
    const role = classifyFeature(f);
    if (role === "parcel") parcels.push(f);
    else if (role === "building") buildings.push(f);
    else others.push(f);
  }

  // Area-ranked list of all polygons (biggest first) for the fallback.
  const withAreas = polygons.map((f) => ({
    feature: f,
    points: coordsToPoints(((f.geometry as GeoJSONPolygon).coordinates)[0] || []),
  }));
  const areas = new Map(
    withAreas.map((w) => [w.feature, polygonAreaSf(w.points)])
  );

  // Fallback: if no feature self-declared as parcel, use the biggest
  // "other" polygon as the parcel and treat the rest as buildings.
  if (parcels.length === 0 && others.length > 0) {
    others.sort((a, b) => (areas.get(b) || 0) - (areas.get(a) || 0));
    const [first, ...rest] = others;
    parcels.push(first);
    buildings.push(...rest);
  } else if (others.length > 0) {
    // Buildings explicitly marked took precedence; anything left as
    // "other" we assume is also a building (Giraffe's default layers).
    buildings.push(...others);
  }

  if (parcels.length === 0) {
    warnings.push("No parcel polygon found — skipping site plan creation.");
  } else if (parcels.length > 1) {
    warnings.push(
      `Multiple parcel polygons detected (${parcels.length}); using the largest.`
    );
    parcels.sort((a, b) => (areas.get(b) || 0) - (areas.get(a) || 0));
  }

  const allUnmappedKeys = new Set<string>();

  // ── Parcel ────────────────────────────────────────────────────
  let parcel: GiraffeParcelInput | null = null;
  let zoningFromParcel: GiraffeZoningInput = {
    far: null,
    height_ft: null,
    height_stories: null,
    lot_coverage_pct: null,
    setbacks: { front: null, side: null, rear: null, corner: null },
    parking_ratio_residential: null,
    parking_ratio_commercial: null,
  };
  let parsedName: string | null = null;
  if (parcels.length > 0) {
    const pf = parcels[0];
    const pgeom = pf.geometry as GeoJSONPolygon;
    const points = coordsToPoints(pgeom.coordinates[0] || []);
    const geomArea = polygonAreaSf(points);
    const props = pf.properties || {};
    const declaredArea = pickNumber(props, PARCEL_AREA_SYNONYMS);
    parcel = {
      polygon: points,
      area_sf: declaredArea ?? Math.round(geomArea),
      unmappedKeys: collectUnmapped(props),
    };
    parsedName = pickString(props, ["name", "label"]);
    // Zoning fields can live on the parcel OR on buildings — we start
    // with parcel-level values and let buildings override if present.
    zoningFromParcel = extractZoning(props);
    for (const k of parcel.unmappedKeys) allUnmappedKeys.add(k);
  }

  // ── Buildings ─────────────────────────────────────────────────
  const parsedBuildings: GiraffeBuildingInput[] = buildings.map((bf, i) => {
    const bgeom = bf.geometry as GeoJSONPolygon;
    const points = coordsToPoints(bgeom.coordinates[0] || []);
    const geomArea = polygonAreaSf(points);
    const props = bf.properties || {};
    const declaredFootprint = pickNumber(props, FOOTPRINT_SF_SYNONYMS);
    const unitCount = pickNumber(props, UNIT_COUNT_SYNONYMS);
    const rawMix = UNIT_MIX_SYNONYMS.map((k) => props[k]).find(
      (v) => Array.isArray(v) && v.length > 0
    );
    const mix = normalizeUnitMix(rawMix, unitCount);
    const parkingType = (() => {
      const s = pickString(props, PARKING_TYPE_SYNONYMS);
      if (!s) return null;
      const n = s.toLowerCase();
      if (n.includes("surface") || n.includes("lot")) return "surface" as const;
      if (n.includes("structur") || n.includes("garage") || n.includes("deck"))
        return "structured" as const;
      if (n.includes("under") || n.includes("below") || n.includes("subterr"))
        return "underground" as const;
      return null;
    })();
    const unmapped = collectUnmapped(props);
    for (const k of unmapped) allUnmappedKeys.add(k);
    return {
      name:
        pickString(props, ["building_name", "building_label", "name", "label"]) ||
        `Building ${String.fromCharCode(65 + i)}`,
      polygon: points,
      footprint_sf: declaredFootprint ?? Math.round(geomArea),
      height_ft: pickNumber(props, HEIGHT_FT_SYNONYMS),
      floors: pickNumber(props, FLOORS_SYNONYMS),
      unit_count: unitCount,
      unit_mix: mix,
      parking_spaces: pickNumber(props, PARKING_SPACES_SYNONYMS),
      parking_type: parkingType,
      unmappedKeys: unmapped,
    };
  });

  // Union zoning: start with parcel-level, then the first building that
  // declares each field wins. This tolerates Giraffe files that put the
  // FAR / height on either the lot or the tower.
  const zoning: GiraffeZoningInput = { ...zoningFromParcel };
  for (const bf of buildings) {
    const props = bf.properties || {};
    const bz = extractZoning(props);
    if (zoning.far == null && bz.far != null) zoning.far = bz.far;
    if (zoning.height_ft == null && bz.height_ft != null) zoning.height_ft = bz.height_ft;
    if (zoning.height_stories == null && bz.height_stories != null) zoning.height_stories = bz.height_stories;
    if (zoning.lot_coverage_pct == null && bz.lot_coverage_pct != null) zoning.lot_coverage_pct = bz.lot_coverage_pct;
    if (zoning.parking_ratio_residential == null && bz.parking_ratio_residential != null) {
      zoning.parking_ratio_residential = bz.parking_ratio_residential;
    }
    if (zoning.parking_ratio_commercial == null && bz.parking_ratio_commercial != null) {
      zoning.parking_ratio_commercial = bz.parking_ratio_commercial;
    }
    zoning.setbacks = {
      front: zoning.setbacks.front ?? bz.setbacks.front,
      side: zoning.setbacks.side ?? bz.setbacks.side,
      rear: zoning.setbacks.rear ?? bz.setbacks.rear,
      corner: zoning.setbacks.corner ?? bz.setbacks.corner,
    };
  }

  if (parsedBuildings.length === 0) {
    warnings.push("No building polygons found — site plan will have a parcel only.");
  }

  return {
    name: parsedName,
    parcel,
    buildings: parsedBuildings,
    zoning,
    allUnmappedKeys: Array.from(allUnmappedKeys),
    warnings,
  };
}

function extractZoning(props: Record<string, unknown>): GiraffeZoningInput {
  const nested = props.setbacks as Record<string, unknown> | undefined;
  const nestedNum = (k: string): number | null => {
    if (!nested || typeof nested !== "object") return null;
    const v = (nested as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  return {
    far: pickNumber(props, FAR_SYNONYMS),
    height_ft: pickNumber(props, HEIGHT_FT_SYNONYMS),
    height_stories: pickNumber(props, HEIGHT_STORIES_SYNONYMS),
    lot_coverage_pct: pickNumber(props, LOT_COVERAGE_SYNONYMS),
    setbacks: {
      front: pickNumber(props, SETBACK_FRONT_SYNONYMS) ?? nestedNum("front"),
      side: pickNumber(props, SETBACK_SIDE_SYNONYMS) ?? nestedNum("side"),
      rear: pickNumber(props, SETBACK_REAR_SYNONYMS) ?? nestedNum("rear"),
      corner:
        pickNumber(props, SETBACK_CORNER_SYNONYMS) ?? nestedNum("corner"),
    },
    parking_ratio_residential: pickNumber(props, [
      "parking_ratio_residential",
      "residential_parking_ratio",
      "parking_per_unit",
    ]),
    parking_ratio_commercial: pickNumber(props, [
      "parking_ratio_commercial",
      "commercial_parking_ratio",
      "parking_per_1000sf",
    ]),
  };
}

// ─── Preview shape the dialog renders and the commit endpoint consumes ─

export type GiraffeAction =
  | {
      type: "create_massing";
      name: string;
      parcel_polygon: SitePlanPoint[];
      parcel_area_sf: number;
      buildings: Array<{
        label: string;
        points: SitePlanPoint[];
        area_sf: number;
      }>;
    }
  | {
      type: "seed_programming";
      building_label: string;
      floors: number | null;
      unit_count: number | null;
      unit_mix: UnitMixEntry[];
      parking_spaces: number | null;
      parking_type: "surface" | "structured" | "underground" | null;
      footprint_sf: number;
    }
  | {
      type: "fill_zoning";
      field:
        | "far"
        | "height_ft"
        | "height_stories"
        | "lot_coverage_pct"
        | "setback_front"
        | "setback_side"
        | "setback_rear"
        | "setback_corner"
        | "parking_ratio_residential"
        | "parking_ratio_commercial";
      value: number;
      existing: number | null;
    };

export interface GiraffePreview {
  massing_name: string;
  actions: GiraffeAction[];
  warnings: string[];
  /** Keys we couldn't map automatically. Exposed to the analyst in the UI. */
  unmapped_keys: string[];
  /** Keys Claude proposed mappings for on the fallback pass (empty when skipped). */
  llm_proposed: Array<{ original_key: string; mapped_to: string; value: number | string }>;
}
