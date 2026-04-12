import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";
import type { DemographicSnapshot } from "@/lib/types";

// ── Census ACS 5-Year variables ──────────────────────────────────────────────
// We fetch from the ACS 5-Year Subject Tables and Detailed Tables.
// Documentation: https://api.census.gov/data.html
//
// The Census API is free and does not require an API key for low-volume use
// (under 500 requests/day). We use county-level data as a proxy for the
// radius area, since block-group-level queries require knowing FIPS codes
// for every block group within a radius (which would require a GIS lookup).
//
// For a production Placer.ai-like experience, you'd use Census block-group
// data with a spatial intersection, but county-level is a solid free starting
// point that captures the right MSA-level trends.

const ACS_YEAR = 2023; // Latest available ACS 5-Year
const ACS_BASE = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;

// Variable mapping: Census variable code → our field name
const CENSUS_VARIABLES: Record<string, keyof DemographicSnapshot | string> = {
  // Population
  "B01003_001E": "total_population",
  "B01002_001E": "median_age",
  // Income
  "B19013_001E": "median_household_income",
  "B19301_001E": "per_capita_income",
  // Poverty
  "B17001_002E": "_poverty_count",
  "B17001_001E": "_poverty_universe",
  // Education (Bachelor's+)
  "B15003_022E": "_bachelors_count",
  "B15003_023E": "_masters_count",
  "B15003_024E": "_professional_count",
  "B15003_025E": "_doctorate_count",
  "B15003_001E": "_education_universe",
  // Housing
  "B25001_001E": "total_housing_units",
  "B25002_002E": "_occupied_units",
  "B25003_001E": "_tenure_total",
  "B25003_002E": "_owner_occupied",
  "B25003_003E": "_renter_occupied",
  "B25077_001E": "median_home_value",
  "B25064_001E": "median_gross_rent",
  // Employment
  "B23025_002E": "labor_force",
  "B23025_005E": "_unemployed",
  "B23025_004E": "total_employed",
  // Household size
  "B25010_001E": "avg_household_size",
  "B11001_002E": "_family_households",
  "B11001_001E": "_total_households",
};

// Top industries from ACS (S2403 — Industry by Sex for Civilian Employed)
// We'll fetch these separately from the subject tables
const INDUSTRY_VARIABLES: Record<string, string> = {
  "C24030_003E": "Agriculture, Forestry, Fishing",
  "C24030_004E": "Mining, Quarrying, Oil & Gas",
  "C24030_005E": "Construction",
  "C24030_006E": "Manufacturing",
  "C24030_007E": "Wholesale Trade",
  "C24030_008E": "Retail Trade",
  "C24030_009E": "Transportation & Warehousing",
  "C24030_010E": "Information",
  "C24030_011E": "Finance, Insurance, Real Estate",
  "C24030_012E": "Professional & Scientific Services",
  "C24030_013E": "Management of Companies",
  "C24030_014E": "Administrative & Waste Services",
  "C24030_015E": "Educational Services",
  "C24030_016E": "Health Care & Social Assistance",
  "C24030_017E": "Arts, Entertainment, Recreation",
  "C24030_018E": "Accommodation & Food Services",
  "C24030_019E": "Other Services",
  "C24030_020E": "Public Administration",
};

/**
 * Resolve lat/lng to a county FIPS code using the Census geocoder's
 * geography lookup endpoint.
 */
async function getCountyFips(
  lat: number,
  lng: number
): Promise<{ state: string; county: string } | null> {
  const url =
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
    `?x=${lng}&y=${lat}` +
    `&benchmark=Public_AR_Current` +
    `&vintage=Current_Current` +
    `&format=json`;

  try {
    assertAllowedFetchUrl(url);
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const geographies = json.result?.geographies;
    // The response nests geographies under various layers
    const counties =
      geographies?.["Counties"] ||
      geographies?.["Census Tracts"] ||
      [];
    const first = counties[0];
    if (!first) return null;
    return {
      state: first.STATE || first.STATEFP,
      county: first.COUNTY || first.COUNTYFP,
    };
  } catch (err) {
    console.error("County FIPS lookup error:", err);
    return null;
  }
}

function safeNum(v: unknown): number | null {
  if (v == null || v === "" || v === -666666666) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function pct(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

async function fetchCensusData(
  stateFips: string,
  countyFips: string
): Promise<DemographicSnapshot> {
  const varCodes = Object.keys(CENSUS_VARIABLES).join(",");
  const url = `${ACS_BASE}?get=${varCodes}&for=county:${countyFips}&in=state:${stateFips}`;

  try {
    assertAllowedFetchUrl(url);
  } catch {
    return emptySnapshot();
  }

  let raw: Record<string, unknown> = {};
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`Census ACS HTTP ${res.status}`);
      return emptySnapshot();
    }
    const json = await res.json();
    // Census returns [[header1, header2, ...], [val1, val2, ...]]
    if (!Array.isArray(json) || json.length < 2) return emptySnapshot();
    const headers = json[0] as string[];
    const values = json[1];
    for (let i = 0; i < headers.length; i++) {
      raw[headers[i]] = values[i];
    }
  } catch (err) {
    console.error("Census ACS fetch error:", err);
    return emptySnapshot();
  }

  // Map raw values to our DemographicSnapshot
  const val = (code: string) => safeNum(raw[code]);

  // Compute derived percentages
  const povertyCount = val("B17001_002E");
  const povertyUniverse = val("B17001_001E");
  const bachelors = (val("B15003_022E") ?? 0) + (val("B15003_023E") ?? 0) +
    (val("B15003_024E") ?? 0) + (val("B15003_025E") ?? 0);
  const eduUniverse = val("B15003_001E");
  const ownerOcc = val("B25003_002E");
  const renterOcc = val("B25003_003E");
  const tenureTotal = val("B25003_001E");
  const unemployed = val("B23025_005E");
  const laborForce = val("B23025_002E");
  const familyHH = val("B11001_002E");
  const totalHH = val("B11001_001E");

  // Fetch industry data
  const industries = await fetchIndustryData(stateFips, countyFips);

  return {
    total_population: val("B01003_001E"),
    population_growth_pct: null, // requires comparing two years
    median_age: val("B01002_001E"),
    median_household_income: val("B19013_001E"),
    per_capita_income: val("B19301_001E"),
    poverty_rate: pct(povertyCount, povertyUniverse),
    bachelors_degree_pct: pct(bachelors, eduUniverse),
    total_housing_units: val("B25001_001E"),
    owner_occupied_pct: pct(ownerOcc, tenureTotal),
    renter_occupied_pct: pct(renterOcc, tenureTotal),
    median_home_value: val("B25077_001E"),
    median_gross_rent: val("B25064_001E"),
    home_value_growth_pct: null, // requires comparing two years
    rent_growth_pct: null, // requires comparing two years
    labor_force: laborForce,
    unemployment_rate: pct(unemployed, laborForce),
    total_employed: val("B23025_004E"),
    top_employers: [],
    top_industries: industries,
    avg_household_size: val("B25010_001E"),
    family_households_pct: pct(familyHH, totalHH),
  };
}

async function fetchIndustryData(
  stateFips: string,
  countyFips: string
): Promise<Array<{ name: string; share_pct?: number }>> {
  const varCodes = Object.keys(INDUSTRY_VARIABLES).join(",");
  const url = `${ACS_BASE}?get=${varCodes}&for=county:${countyFips}&in=state:${stateFips}`;

  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json) || json.length < 2) return [];

    const headers = json[0] as string[];
    const values = json[1];
    const raw: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const n = safeNum(values[i]);
      if (n != null) raw[headers[i]] = n;
    }

    // Calculate total employed across all industries
    const total = Object.values(raw).reduce((sum, v) => sum + v, 0);

    // Sort by count descending, take top 8
    const sorted = Object.entries(INDUSTRY_VARIABLES)
      .map(([code, name]) => ({
        name,
        count: raw[code] ?? 0,
        share_pct: total > 0 ? Math.round(((raw[code] ?? 0) / total) * 1000) / 10 : 0,
      }))
      .filter((i) => i.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return sorted.map((i) => ({ name: i.name, share_pct: i.share_pct }));
  } catch (err) {
    console.error("Census industry fetch error:", err);
    return [];
  }
}

function emptySnapshot(): DemographicSnapshot {
  return {
    total_population: null,
    population_growth_pct: null,
    median_age: null,
    median_household_income: null,
    per_capita_income: null,
    poverty_rate: null,
    bachelors_degree_pct: null,
    total_housing_units: null,
    owner_occupied_pct: null,
    renter_occupied_pct: null,
    median_home_value: null,
    median_gross_rent: null,
    home_value_growth_pct: null,
    rent_growth_pct: null,
    labor_force: null,
    unemployment_rate: null,
    total_employed: null,
    top_employers: [],
    top_industries: [],
    avg_household_size: null,
    family_households_pct: null,
  };
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const radiusMiles = body.radius_miles ?? 3;

    // Get the deal's coordinates
    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!deal.lat || !deal.lng) {
      return NextResponse.json(
        {
          error:
            "Deal has no coordinates. Geocode the deal first from the Comps & Market page.",
        },
        { status: 400 }
      );
    }

    // Resolve coordinates to county FIPS
    const fips = await getCountyFips(Number(deal.lat), Number(deal.lng));
    if (!fips) {
      return NextResponse.json(
        { error: "Could not determine county for this location. The Census geocoder may be temporarily unavailable." },
        { status: 502 }
      );
    }

    // Fetch Census ACS data for this county
    const data = await fetchCensusData(fips.state, fips.county);

    // Upsert the data
    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      radiusMiles
    );
    const id = existing?.id ?? uuidv4();

    // Preserve any existing projections (user may have manually entered these)
    const existingProjections = existing?.projections
      ? (typeof existing.projections === "string"
          ? JSON.parse(existing.projections)
          : existing.projections)
      : {};

    const row = await locationIntelligenceQueries.upsert(
      params.id,
      id,
      radiusMiles,
      data as unknown as Record<string, unknown>,
      existingProjections,
      "census_acs",
      ACS_YEAR,
      `Census ACS 5-Year (${ACS_YEAR}), County FIPS: ${fips.state}${fips.county}`
    );

    return NextResponse.json({
      data: row,
      meta: {
        source: "Census ACS 5-Year",
        year: ACS_YEAR,
        geography: `County (FIPS ${fips.state}${fips.county})`,
        note: "County-level data used as proxy. For sub-county radius analysis, upload market reports with more granular data.",
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-census error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Census data" },
      { status: 500 }
    );
  }
}
