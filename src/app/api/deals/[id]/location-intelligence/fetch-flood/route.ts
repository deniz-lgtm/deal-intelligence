import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries, underwritingQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── FEMA National Flood Hazard Layer (NFHL) ──────────────────────────────────
//
// Free ArcGIS REST endpoint. Returns flood zone designation for any point.
// Also auto-populates the Site & Zoning page's flood_zone field.
//
// API: https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer
// Layer 28 = Flood Hazard Zones (S_FLD_HAZ_AR)

const FEMA_FLOOD_LAYER =
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";

interface FloodResult {
  flood_zone: string;         // e.g., "AE", "X", "A", "VE"
  flood_zone_subtype: string | null; // e.g., "FLOODWAY", "0.2 PCT ANNUAL CHANCE"
  panel_number: string | null;
  effective_date: string | null;
  source: string;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const radiusMiles = body.radius_miles ?? 3;

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json({ error: "Deal has no coordinates." }, { status: 400 });
    }

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);

    // Query FEMA NFHL at the property point
    const queryParams = new URLSearchParams({
      geometry: JSON.stringify({ x: lng, y: lat }),
      geometryType: "esriGeometryPoint",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "FLD_ZONE,ZONE_SUBTY,DFIRM_ID,EFF_DATE,SFHA_TF",
      returnGeometry: "false",
      f: "json",
      inSR: "4326",
    });

    const url = `${FEMA_FLOOD_LAYER}?${queryParams.toString()}`;

    let floodResult: FloodResult | null = null;

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return NextResponse.json(
          { error: "FEMA flood service unavailable." },
          { status: 502 }
        );
      }
      const json = await res.json();
      if (json.error) {
        console.error("FEMA NFHL error:", json.error);
        return NextResponse.json(
          { error: "FEMA NFHL query error." },
          { status: 502 }
        );
      }

      const features = json.features || [];
      if (features.length > 0) {
        const attrs = features[0].attributes;
        floodResult = {
          flood_zone: attrs.FLD_ZONE || "Unknown",
          flood_zone_subtype: attrs.ZONE_SUBTY || null,
          panel_number: attrs.DFIRM_ID || null,
          effective_date: attrs.EFF_DATE || null,
          source: "FEMA NFHL",
        };
      } else {
        // No features means point is outside mapped flood areas
        floodResult = {
          flood_zone: "X",
          flood_zone_subtype: "AREA OF MINIMAL FLOOD HAZARD",
          panel_number: null,
          effective_date: null,
          source: "FEMA NFHL (no mapped hazard area)",
        };
      }
    } catch (err) {
      console.error("FEMA flood fetch error:", err);
      return NextResponse.json({ error: "Failed to query FEMA flood data." }, { status: 502 });
    }

    // ── Auto-populate Site & Zoning flood_zone ──────────────────────────
    try {
      const uwRow = await underwritingQueries.getByDealId(params.id);
      if (uwRow?.data) {
        const uwData = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
        const siteInfo = uwData.site_info || {};

        // Map FEMA zone to our dropdown values
        const zoneMap: Record<string, string> = {
          X: "Zone X", A: "Zone A", AE: "Zone AE", AH: "Zone AH",
          AO: "Zone A", VE: "Zone VE", V: "Zone VE",
          D: "Zone D", B: "X500", C: "Zone X",
        };
        const mappedZone = zoneMap[floodResult.flood_zone] || floodResult.flood_zone;

        // Only update if not already set or if currently empty
        if (!siteInfo.flood_zone || siteInfo.flood_zone === "" || siteInfo.flood_zone === "Unknown") {
          siteInfo.flood_zone = mappedZone;
          uwData.site_info = siteInfo;

          // Add environmental note about flood zone
          if (floodResult.flood_zone !== "X" && floodResult.flood_zone !== "C") {
            const note = `FEMA Flood Zone ${floodResult.flood_zone}${floodResult.flood_zone_subtype ? ` (${floodResult.flood_zone_subtype})` : ""}. May require flood insurance and elevated construction.`;
            siteInfo.environmental_notes = siteInfo.environmental_notes
              ? `${siteInfo.environmental_notes}\n${note}`
              : note;
          }

          await underwritingQueries.upsert(
            params.id,
            uwRow.id,
            JSON.stringify(uwData)
          );
        }
      }
    } catch (err) {
      // Non-fatal — flood data still returns even if site-zoning update fails
      console.error("Failed to auto-populate site-zoning flood zone:", err);
    }

    // ── Merge into location intelligence ────────────────────────────────
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.fema_flood_zone = floodResult.flood_zone;
      data.fema_flood_subtype = floodResult.flood_zone_subtype;
      data.fema_panel = floodResult.panel_number;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; FEMA NFHL (Zone ${floodResult.flood_zone})`
      );
    }

    // Determine risk level for display
    const highRiskZones = ["A", "AE", "AH", "AO", "AR", "V", "VE"];
    const isHighRisk = highRiskZones.includes(floodResult.flood_zone);

    return NextResponse.json({
      data: {
        ...floodResult,
        is_high_risk: isHighRisk,
        risk_label: isHighRisk ? "Special Flood Hazard Area (High Risk)" : "Minimal Flood Hazard",
        site_zoning_updated: true,
      },
      meta: {
        source: "FEMA National Flood Hazard Layer",
        note: `Flood Zone ${floodResult.flood_zone}${floodResult.flood_zone_subtype ? ` — ${floodResult.flood_zone_subtype}` : ""}. ${isHighRisk ? "⚠ High-risk zone: flood insurance required for federally-backed loans." : "Minimal flood hazard area."}`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-flood error:", error);
    return NextResponse.json({ error: "Failed to fetch flood zone data" }, { status: 500 });
  }
}
