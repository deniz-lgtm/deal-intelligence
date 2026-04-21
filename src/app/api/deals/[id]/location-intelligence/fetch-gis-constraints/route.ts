import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Force dynamic — this route uses Clerk's auth(), which reads headers()
// and cannot be statically analyzed at build time.
export const dynamic = "force-dynamic";

// ── Composite GIS constraints endpoint ───────────────────────────────────────
//
// Queries three free public services and summarizes their results into a
// single "Site Buildability Score" (0-100) plus a list of constraints
// the analyst should know about. All three sources are already on the
// web-allowlist:
//   1. FEMA National Flood Hazard Layer — flood zones
//   2. USFWS National Wetlands Inventory (NWI) — wetlands overlap
//   3. USGS Elevation Point Query Service (EPQS) — spot elevations to
//      estimate slope (4 sample points around the subject lat/lng)
//
// Simple goal: show the analyst a one-glance "can we build here?" score
// without making them open 3-4 separate GIS tools. The score is
// heuristic (not a replacement for a civil engineer's site survey) —
// it's a pre-bid sniff test.

const FEMA_FLOOD_LAYER =
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";
// USFWS NWI v3 public MapServer (wetlands polygon layer = 0)
const USFWS_WETLANDS_LAYER =
  "https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands/MapServer/0/query";
// USGS Elevation Point Query Service — free, returns elevation in feet
// (or meters). Takes a single lat/lng point.
const USGS_EPQS_URL = "https://epqs.nationalmap.gov/v1/json";

interface Constraint {
  type: "flood" | "wetlands" | "slope";
  severity: "low" | "moderate" | "high";
  summary: string;
}

interface GisConstraintsResult {
  score: number; // 0-100
  constraints: Constraint[];
  data: {
    flood_zone?: string | null;
    flood_high_risk?: boolean;
    wetlands_intersects?: boolean;
    wetlands_type?: string | null;
    avg_slope_pct?: number | null;
    max_elevation_delta_ft?: number | null;
  };
  source_notes: string[];
}

async function queryFloodZone(lat: number, lng: number): Promise<{ zone: string; highRisk: boolean } | null> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
    returnGeometry: "false",
    f: "json",
    inSR: "4326",
  });
  const url = `${FEMA_FLOOD_LAYER}?${params.toString()}`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const json = await res.json();
    const features = json.features || [];
    if (features.length === 0) return { zone: "X", highRisk: false };
    const attrs = features[0].attributes || {};
    const zone = attrs.FLD_ZONE || "Unknown";
    const highRisk = ["A", "AE", "AH", "AO", "AR", "V", "VE"].includes(zone);
    return { zone, highRisk };
  } catch (err) {
    console.error("queryFloodZone failed:", err);
    return null;
  }
}

async function queryWetlands(lat: number, lng: number): Promise<{ intersects: boolean; type: string | null } | null> {
  // Small buffer around the point to catch adjacency (NWI polygons).
  // 0.001 deg ≈ 110 m — enough to flag nearby wetlands but narrow
  // enough to avoid false positives from distant features.
  const d = 0.001;
  const envelope = {
    xmin: lng - d, ymin: lat - d, xmax: lng + d, ymax: lat + d,
    spatialReference: { wkid: 4326 },
  };
  const params = new URLSearchParams({
    geometry: JSON.stringify(envelope),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "WETLAND_TYPE,ATTRIBUTE",
    returnGeometry: "false",
    f: "json",
    inSR: "4326",
  });
  const url = `${USFWS_WETLANDS_LAYER}?${params.toString()}`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const json = await res.json();
    const features = json.features || [];
    if (features.length === 0) return { intersects: false, type: null };
    const wetlandType =
      features[0].attributes?.WETLAND_TYPE ||
      features[0].attributes?.ATTRIBUTE ||
      "Unclassified wetland";
    return { intersects: true, type: wetlandType };
  } catch (err) {
    // NWI service occasionally 500s; don't fail the whole constraint
    // query — just leave wetlands unknown.
    console.error("queryWetlands failed:", err);
    return null;
  }
}

async function fetchElevation(lat: number, lng: number): Promise<number | null> {
  const url = `${USGS_EPQS_URL}?x=${lng}&y=${lat}&units=Feet&wkid=4326`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const elev = json?.value;
    if (elev === undefined || elev === null) return null;
    const n = typeof elev === "string" ? parseFloat(elev) : Number(elev);
    return isFinite(n) && n > -1500 ? n : null;
  } catch (err) {
    console.error("fetchElevation failed:", err);
    return null;
  }
}

async function sampleSlope(lat: number, lng: number): Promise<{ avgSlopePct: number; maxDelta: number } | null> {
  // Sample elevation at the center + 4 cardinal points ~500 ft out
  // (~0.0015 deg). Compute the max elevation delta across pairs, then
  // slope % = delta / horizontal distance. Rough but useful for flagging
  // "this site is on a hill" vs. "pancake flat."
  const offset = 0.0015; // ~500 ft N/S, slightly less E/W (fine for a heuristic)
  const points: Array<[number, number]> = [
    [lat, lng],
    [lat + offset, lng],
    [lat - offset, lng],
    [lat, lng + offset],
    [lat, lng - offset],
  ];
  const elevations = await Promise.all(points.map(([la, ln]) => fetchElevation(la, ln)));
  const valid = elevations.filter((e): e is number => e !== null);
  if (valid.length < 2) return null;
  const maxDelta = Math.max(...valid) - Math.min(...valid);
  // Horizontal sample distance ~500 ft between opposing points = 1000 ft.
  // Use that as the denominator for slope %.
  const slopePct = (maxDelta / 1000) * 100;
  return { avgSlopePct: slopePct, maxDelta };
}

function scoreConstraints(data: GisConstraintsResult["data"]): { score: number; constraints: Constraint[] } {
  let score = 100;
  const constraints: Constraint[] = [];

  if (data.flood_zone) {
    if (data.flood_high_risk) {
      score -= 30;
      constraints.push({
        type: "flood",
        severity: "high",
        summary: `FEMA Zone ${data.flood_zone} — Special Flood Hazard Area. Flood insurance required for federally-backed loans; elevated construction likely.`,
      });
    } else if (data.flood_zone === "X" || data.flood_zone === "C") {
      // Minimal — no penalty, no constraint entry (keeps the list clean).
    } else {
      score -= 10;
      constraints.push({
        type: "flood",
        severity: "moderate",
        summary: `FEMA Zone ${data.flood_zone}. Review flood studies before committing to grading.`,
      });
    }
  }

  if (data.wetlands_intersects) {
    score -= 25;
    constraints.push({
      type: "wetlands",
      severity: "high",
      summary: `USFWS NWI flags wetlands on/near the parcel${data.wetlands_type ? ` (${data.wetlands_type})` : ""}. 404 permit review almost certainly required.`,
    });
  }

  if (data.avg_slope_pct !== undefined && data.avg_slope_pct !== null) {
    if (data.avg_slope_pct >= 15) {
      score -= 20;
      constraints.push({
        type: "slope",
        severity: "high",
        summary: `Terrain slope ~${data.avg_slope_pct.toFixed(1)}% (max Δ ${Math.round(data.max_elevation_delta_ft || 0)} ft across sample). Expect significant grading / retaining costs.`,
      });
    } else if (data.avg_slope_pct >= 8) {
      score -= 10;
      constraints.push({
        type: "slope",
        severity: "moderate",
        summary: `Terrain slope ~${data.avg_slope_pct.toFixed(1)}%. Moderate grading work; stormwater routing warrants attention.`,
      });
    }
  }

  return { score: Math.max(0, Math.min(100, score)), constraints };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const radiusMiles = body.radius_miles ?? 3;

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);

    // Run all three queries in parallel — they're independent and the
    // whole endpoint should settle within ~15s even on cold caches.
    const [flood, wetlands, slope] = await Promise.all([
      queryFloodZone(lat, lng),
      queryWetlands(lat, lng),
      sampleSlope(lat, lng),
    ]);

    const data: GisConstraintsResult["data"] = {
      flood_zone: flood?.zone ?? null,
      flood_high_risk: flood?.highRisk ?? false,
      wetlands_intersects: wetlands?.intersects ?? undefined,
      wetlands_type: wetlands?.type ?? null,
      avg_slope_pct: slope ? Number(slope.avgSlopePct.toFixed(2)) : null,
      max_elevation_delta_ft: slope ? Number(slope.maxDelta.toFixed(1)) : null,
    };
    const { score, constraints } = scoreConstraints(data);

    const result: GisConstraintsResult = {
      score,
      constraints,
      data,
      source_notes: [
        flood ? "FEMA NFHL" : "FEMA NFHL (unavailable)",
        wetlands ? "USFWS NWI" : "USFWS NWI (unavailable)",
        slope ? "USGS 3DEP elevation" : "USGS 3DEP elevation (unavailable)",
      ],
    };

    // Merge into location_intelligence.data under the `gis_constraints`
    // key. This mirrors how flood/walkscore/AMI persist their payloads.
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const existingData = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      existingData.gis_constraints = result;
      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, existingData, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; ${result.source_notes.join(" + ")}`
      );
    }

    return NextResponse.json({
      data: result,
      meta: {
        sources: result.source_notes,
        note: constraints.length === 0
          ? "No material GIS constraints detected at this location."
          : `${constraints.length} constraint${constraints.length > 1 ? "s" : ""} flagged. Buildability score: ${score}/100.`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-gis-constraints error:", error);
    return NextResponse.json({ error: "Failed to fetch GIS constraints" }, { status: 500 });
  }
}
