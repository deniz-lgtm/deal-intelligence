import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── IRS SOI County-to-County Migration Data ──────────────────────────────────
//
// IRS publishes annual county-to-county migration flows based on tax return
// address changes. Shows inflow/outflow by origin/destination county.
//
// Data: https://www.irs.gov/statistics/soi-tax-stats-migration-data
// CSV files by year. We use the county inflow/outflow summary.
//
// Since the IRS doesn't have a clean REST API, we use the Census ACS
// migration variables (B07001 — Geographic Mobility) as a proxy for the
// same data. These are available via the existing Census API.

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

// Census ACS migration variables (B07001 — Geographic Mobility in Past Year)
const MIGRATION_VARS: Record<string, string> = {
  "B07001_001E": "_total_pop_1yr",           // Total population 1 year and over
  "B07001_017E": "_same_house",              // Same house 1 year ago
  "B07001_033E": "_moved_within_county",     // Moved within same county
  "B07001_049E": "_moved_from_diff_county_same_state", // From different county, same state
  "B07001_065E": "_moved_from_diff_state",   // From different state
  "B07001_081E": "_moved_from_abroad",       // From abroad
  // Net migration components
  "B07401_001E": "_residence_1yr_total",     // Residence 1 year ago total
};

interface MigrationData {
  total_population_1yr: number | null;
  same_house_pct: number | null;
  moved_within_county: number | null;
  moved_from_other_county_same_state: number | null;
  moved_from_other_state: number | null;
  moved_from_abroad: number | null;
  total_movers: number | null;
  mobility_rate_pct: number | null;  // % of population that moved
  inflow_domestic: number | null;    // from other county + other state
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

    const varCodes = Object.keys(MIGRATION_VARS).join(",");
    const url = `https://api.census.gov/data/2023/acs/acs5?get=${varCodes}&for=county:${fips.county}&in=state:${fips.state}`;

    let raw: Record<string, string> = {};
    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return NextResponse.json({ error: "Census migration data unavailable." }, { status: 502 });
      }
      const json = await res.json();
      if (!Array.isArray(json) || json.length < 2) {
        return NextResponse.json({ error: "No migration data for this county." }, { status: 404 });
      }
      const headers = json[0] as string[];
      const values = json[1];
      for (let i = 0; i < headers.length; i++) {
        raw[headers[i]] = values[i];
      }
    } catch (err) {
      console.error("Census migration fetch error:", err);
      return NextResponse.json({ error: "Failed to fetch migration data." }, { status: 502 });
    }

    const num = (code: string): number | null => {
      const v = raw[code];
      if (!v || v === "-666666666") return null;
      const n = parseInt(v);
      return isNaN(n) ? null : n;
    };

    const totalPop = num("B07001_001E");
    const sameHouse = num("B07001_017E");
    const withinCounty = num("B07001_033E");
    const otherCounty = num("B07001_049E");
    const otherState = num("B07001_065E");
    const abroad = num("B07001_081E");

    const totalMovers = (withinCounty ?? 0) + (otherCounty ?? 0) + (otherState ?? 0) + (abroad ?? 0);
    const inflow = (otherCounty ?? 0) + (otherState ?? 0) + (abroad ?? 0);
    const mobilityRate = totalPop && totalPop > 0
      ? Math.round((totalMovers / totalPop) * 1000) / 10
      : null;
    const sameHousePct = totalPop && totalPop > 0 && sameHouse != null
      ? Math.round((sameHouse / totalPop) * 1000) / 10
      : null;

    const result: MigrationData = {
      total_population_1yr: totalPop,
      same_house_pct: sameHousePct,
      moved_within_county: withinCounty,
      moved_from_other_county_same_state: otherCounty,
      moved_from_other_state: otherState,
      moved_from_abroad: abroad,
      total_movers: totalMovers,
      mobility_rate_pct: mobilityRate,
      inflow_domestic: inflow,
    };

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.migration = result;
      data.mobility_rate_pct = mobilityRate;
      data.net_inflow = inflow;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; ACS Migration (county ${fips.state}${fips.county})`
      );
    }

    return NextResponse.json({
      data: result,
      meta: {
        source: "Census ACS Geographic Mobility",
        note: `${totalMovers.toLocaleString()} people moved in the past year (${mobilityRate ?? "?"}% mobility rate). ${inflow.toLocaleString()} moved in from outside the county.`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-migration error:", error);
    return NextResponse.json({ error: "Failed to fetch migration data" }, { status: 500 });
  }
}
