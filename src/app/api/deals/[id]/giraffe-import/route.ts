import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  parseGiraffeGeoJSON,
  type GiraffeAction,
  type GiraffePreview,
  type GiraffeParsed,
} from "@/lib/giraffe";
import {
  proposeGiraffeKeyMappings,
  type GiraffeKeyMapping,
} from "@/lib/giraffe-claude";

export const dynamic = "force-dynamic";
// GeoJSON parse is fast; the optional Claude pass for unknown keys is
// the only slow step and we cap its payload size in the library.
export const maxDuration = 60;

/**
 * Step 1 of the Giraffe import flow. Accepts a .geojson file (or raw
 * GeoJSON JSON body), parses it, and returns a preview action list for
 * the analyst to review. No DB writes — they happen in /commit after
 * the analyst deselects anything they don't want.
 *
 * Strict synonym matching runs first; anything unrecognized gets one
 * optional LLM round-trip to propose mappings. The LLM step is best-
 * effort and skipped entirely if there are no unknown keys.
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

    const contentType = req.headers.get("content-type") || "";
    let rawJson: unknown;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      const text = await file.text();
      try {
        rawJson = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: "File is not valid JSON" },
          { status: 400 }
        );
      }
    } else if (contentType.includes("application/json") || contentType.includes("application/geo+json")) {
      rawJson = await req.json();
    } else {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a `file` field or a GeoJSON JSON body" },
        { status: 400 }
      );
    }

    let parsed: GiraffeParsed;
    try {
      parsed = parseGiraffeGeoJSON(rawJson);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to parse GeoJSON" },
        { status: 400 }
      );
    }

    // Optional LLM fallback for unknown keys. Collect the original
    // key/value pairs across every feature — same key on multiple
    // features only gets mapped once (we take the first non-null
    // value we see).
    const llm_proposed: Array<{ original_key: string; mapped_to: string; value: number | string }> = [];
    if (parsed.allUnmappedKeys.length > 0) {
      const unknownProps: Record<string, unknown> = {};
      const rawObj = rawJson as { features?: Array<{ properties?: Record<string, unknown> }> };
      for (const feat of rawObj.features || []) {
        const props = feat.properties || {};
        for (const k of parsed.allUnmappedKeys) {
          if (props[k] != null && unknownProps[k] == null) {
            unknownProps[k] = props[k];
          }
        }
      }
      try {
        const mappings: GiraffeKeyMapping[] = await proposeGiraffeKeyMappings(unknownProps);
        for (const m of mappings) {
          if (m.mapped_to && m.confidence !== "low") {
            llm_proposed.push({
              original_key: m.original_key,
              mapped_to: m.mapped_to,
              value: m.value,
            });
          }
        }
      } catch (e) {
        // Non-fatal — preview still returns with strict mappings only.
        console.error("giraffe-import: LLM fallback failed:", e);
      }
    }

    const preview = buildPreview(parsed, llm_proposed);
    return NextResponse.json({ data: preview });
  } catch (error) {
    console.error("POST /api/deals/[id]/giraffe-import error:", error);
    return NextResponse.json(
      { error: "Failed to process Giraffe import" },
      { status: 500 }
    );
  }
}

function buildPreview(
  parsed: GiraffeParsed,
  llm_proposed: Array<{ original_key: string; mapped_to: string; value: number | string }>
): GiraffePreview {
  const actions: GiraffeAction[] = [];

  // ── Massing geometry ──────────────────────────────────────────
  if (parsed.parcel) {
    actions.push({
      type: "create_massing",
      name: parsed.name || `Giraffe Import ${new Date().toLocaleDateString()}`,
      parcel_polygon: parsed.parcel.polygon,
      parcel_area_sf: parsed.parcel.area_sf ?? 0,
      buildings: parsed.buildings.map((b) => ({
        label: b.name,
        points: b.polygon,
        area_sf: b.footprint_sf,
      })),
    });
  }

  // ── Per-building programming seeds ────────────────────────────
  for (const b of parsed.buildings) {
    const hasProgramData =
      b.floors != null ||
      b.unit_count != null ||
      b.unit_mix.length > 0 ||
      b.parking_spaces != null;
    if (!hasProgramData) continue;
    actions.push({
      type: "seed_programming",
      building_label: b.name,
      floors: b.floors,
      unit_count: b.unit_count,
      unit_mix: b.unit_mix,
      parking_spaces: b.parking_spaces,
      parking_type: b.parking_type,
      footprint_sf: b.footprint_sf,
    });
  }

  // ── Zoning auto-fills ─────────────────────────────────────────
  // Existing values come in with the commit request (we don't have
  // deal context here); commit-time will decide whether to overwrite.
  const z = parsed.zoning;
  const addFill = (field: GiraffeAction extends { type: "fill_zoning"; field: infer F } ? F : never, value: number | null) => {
    if (value == null) return;
    actions.push({ type: "fill_zoning", field, value, existing: null });
  };
  addFill("far", z.far);
  addFill("height_ft", z.height_ft);
  addFill("height_stories", z.height_stories);
  addFill("lot_coverage_pct", z.lot_coverage_pct);
  addFill("setback_front", z.setbacks.front);
  addFill("setback_side", z.setbacks.side);
  addFill("setback_rear", z.setbacks.rear);
  addFill("setback_corner", z.setbacks.corner);
  addFill("parking_ratio_residential", z.parking_ratio_residential);
  addFill("parking_ratio_commercial", z.parking_ratio_commercial);

  // Merge LLM-proposed zoning fills for keys the strict pass missed.
  // We only add ones that land on a field we don't already have a
  // value for, and only if the value coerces to a number.
  const filledFields = new Set(
    actions
      .filter((a): a is Extract<GiraffeAction, { type: "fill_zoning" }> => a.type === "fill_zoning")
      .map((a) => a.field)
  );
  for (const m of llm_proposed) {
    const field = mapLlmFieldToAction(m.mapped_to);
    if (!field || filledFields.has(field)) continue;
    const numeric = typeof m.value === "number" ? m.value : Number(m.value);
    if (!Number.isFinite(numeric)) continue;
    actions.push({ type: "fill_zoning", field, value: numeric, existing: null });
    filledFields.add(field);
  }

  return {
    massing_name: parsed.name || `Giraffe Import ${new Date().toLocaleDateString()}`,
    actions,
    warnings: parsed.warnings,
    unmapped_keys: parsed.allUnmappedKeys,
    llm_proposed,
  };
}

function mapLlmFieldToAction(
  mapped_to: string
): Extract<GiraffeAction, { type: "fill_zoning" }>["field"] | null {
  switch (mapped_to) {
    case "far":
    case "height_ft":
    case "height_stories":
    case "lot_coverage_pct":
    case "setback_front":
    case "setback_side":
    case "setback_rear":
    case "setback_corner":
    case "parking_ratio_residential":
    case "parking_ratio_commercial":
      return mapped_to;
    default:
      return null;
  }
}
