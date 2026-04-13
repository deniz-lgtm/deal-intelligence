import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── Census Building Permits Survey ───────────────────────────────────────────
//
// Monthly new residential building permits by county/metro. Critical for
// understanding the supply pipeline — the #1 question LPs ask about MF.
//
// API: https://api.census.gov/data/timeseries/bps
// Free, no key required. Returns monthly permits by structure type.

async function getCountyFips(lat: number, lng: number): Promise<{ state: string; county: string } | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const counties = json.result?.geographies?.["Counties"] || [];
    const first = counties[0];
    if (!first) return null;
    return { state: first.STATE || first.STATEFP, county: first.COUNTY || first.COUNTYFP };
  } catch { return null; }
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

    const fips = await getCountyFips(Number(deal.lat), Number(deal.lng));
    if (!fips) {
      return NextResponse.json({ error: "Could not determine county." }, { status: 502 });
    }

    // Fetch last 3 years of annual building permits
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear - 2, currentYear - 3];
    const permitData: Array<{ year: number; total_units: number; single_family: number; multi_family: number; buildings_5plus: number }> = [];

    for (const year of years) {
      const url = `https://api.census.gov/data/timeseries/bps?get=BLDG,UNIT,UNIT1,UNITMULTI&for=county:${fips.county}&in=state:${fips.state}&time=${year}`;
      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const json = await res.json();
        if (!Array.isArray(json) || json.length < 2) continue;

        const headers = json[0] as string[];
        // Sum across all rows for the year
        let totalUnits = 0, sfUnits = 0, mfUnits = 0, bldg5plus = 0;
        for (let r = 1; r < json.length; r++) {
          const row = json[r];
          const get = (name: string) => {
            const idx = headers.indexOf(name);
            return idx >= 0 ? parseInt(row[idx]) || 0 : 0;
          };
          totalUnits += get("UNIT");
          sfUnits += get("UNIT1");
          mfUnits += get("UNITMULTI");
          bldg5plus += get("BLDG");
        }

        permitData.push({
          year,
          total_units: totalUnits,
          single_family: sfUnits,
          multi_family: mfUnits,
          buildings_5plus: bldg5plus,
        });
      } catch { /* non-fatal */ }
    }

    if (permitData.length === 0) {
      return NextResponse.json({ error: "No building permit data available for this county." }, { status: 404 });
    }

    // Calculate YoY trend
    const latest = permitData[0];
    const prior = permitData.length > 1 ? permitData[1] : null;
    const yoyPct = prior && prior.total_units > 0
      ? Math.round(((latest.total_units - prior.total_units) / prior.total_units) * 1000) / 10
      : null;

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.building_permits = permitData;
      data.permits_latest_year = latest.year;
      data.permits_total_units = latest.total_units;
      data.permits_sf_units = latest.single_family;
      data.permits_mf_units = latest.multi_family;
      data.permits_yoy_pct = yoyPct;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      if (projections.new_units_pipeline == null) {
        projections.new_units_pipeline = latest.multi_family;
      }

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Census Building Permits (${fips.state}${fips.county})`
      );
    }

    return NextResponse.json({
      data: { permits: permitData, yoy_change_pct: yoyPct, county_fips: `${fips.state}${fips.county}` },
      meta: { source: "Census Building Permits Survey", years: years, note: `Annual residential building permits for county FIPS ${fips.state}${fips.county}.` },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-permits error:", error);
    return NextResponse.json({ error: "Failed to fetch building permit data" }, { status: 500 });
  }
}
