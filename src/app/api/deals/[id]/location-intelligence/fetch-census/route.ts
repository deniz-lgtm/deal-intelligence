import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";
import type { DemographicSnapshot } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── Census ACS 5-Year — Tract-Level Spatial Approach ─────────────────────────
//
// How it works:
//   1. TIGERweb ArcGIS REST API → find all census tracts whose centroids fall
//      within the requested radius of the property.
//   2. Census ACS API → fetch demographic data for each tract (batched by
//      county for efficiency — one API call returns all tracts in a county).
//   3. Population-weighted aggregation → combine tract-level data into a
//      single DemographicSnapshot that represents the actual radius area.
//   4. Prior-year comparison → fetch ACS data from 5 years earlier to compute
//      real growth rates for population, home values, and rent.
//
// This produces genuinely different data for 1mi vs 3mi vs 10mi radii.

const ACS_YEAR = 2023;
const ACS_PRIOR_YEAR = 2018; // 5-year lookback for growth rates
const ACS_BASE = (year: number) =>
  `https://api.census.gov/data/${year}/acs/acs5`;

// TIGERweb ArcGIS REST — Census Tracts layer
// Docs: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb
const TIGERWEB_TRACTS =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query";

// ── ACS variable codes ───────────────────────────────────────────────────────

const CENSUS_VARIABLES: Record<string, string> = {
  B01003_001E: "total_population",
  B01002_001E: "median_age",
  B19013_001E: "median_household_income",
  B19301_001E: "per_capita_income",
  B17001_002E: "_poverty_count",
  B17001_001E: "_poverty_universe",
  B15003_022E: "_bachelors",
  B15003_023E: "_masters",
  B15003_024E: "_professional",
  B15003_025E: "_doctorate",
  B15003_001E: "_edu_universe",
  B25001_001E: "total_housing_units",
  B25003_001E: "_tenure_total",
  B25003_002E: "_owner_occupied",
  B25003_003E: "_renter_occupied",
  B25077_001E: "median_home_value",
  B25064_001E: "median_gross_rent",
  B23025_002E: "labor_force",
  B23025_005E: "_unemployed",
  B23025_004E: "total_employed",
  B25010_001E: "avg_household_size",
  B11001_002E: "_family_households",
  B11001_001E: "_total_households",
  // B25118 — Tenure by Household Income (renter side, codes _015..._025).
  // Feeds Concord-style exhibit I-7 renter-income tranches.
  B25118_014E: "_renter_income_total",
  B25118_015E: "_renter_inc_u5k",
  B25118_016E: "_renter_inc_5_10k",
  B25118_017E: "_renter_inc_10_15k",
  B25118_018E: "_renter_inc_15_20k",
  B25118_019E: "_renter_inc_20_25k",
  B25118_020E: "_renter_inc_25_35k",
  B25118_021E: "_renter_inc_35_50k",
  B25118_022E: "_renter_inc_50_75k",
  B25118_023E: "_renter_inc_75_100k",
  B25118_024E: "_renter_inc_100_150k",
  B25118_025E: "_renter_inc_150k_plus",
  // B25070 — Gross Rent as % of HH Income. Feeds the rent-burden half of
  // exhibit I-7. _011E (not computed) is excluded from denominators.
  B25070_002E: "_rentburden_u10",
  B25070_003E: "_rentburden_10_15",
  B25070_004E: "_rentburden_15_20",
  B25070_005E: "_rentburden_20_25",
  B25070_006E: "_rentburden_25_30",
  B25070_007E: "_rentburden_30_35",
  B25070_008E: "_rentburden_35_40",
  B25070_009E: "_rentburden_40_50",
  B25070_010E: "_rentburden_50_plus",
};

// Subset for prior-year comparison (growth rates)
const GROWTH_VARIABLES: Record<string, string> = {
  B01003_001E: "total_population",
  B25077_001E: "median_home_value",
  B25064_001E: "median_gross_rent",
};

const INDUSTRY_VARIABLES: Record<string, string> = {
  C24030_003E: "Agriculture, Forestry, Fishing",
  C24030_004E: "Mining, Quarrying, Oil & Gas",
  C24030_005E: "Construction",
  C24030_006E: "Manufacturing",
  C24030_007E: "Wholesale Trade",
  C24030_008E: "Retail Trade",
  C24030_009E: "Transportation & Warehousing",
  C24030_010E: "Information",
  C24030_011E: "Finance, Insurance, Real Estate",
  C24030_012E: "Professional & Scientific Services",
  C24030_013E: "Management of Companies",
  C24030_014E: "Administrative & Waste Services",
  C24030_015E: "Educational Services",
  C24030_016E: "Health Care & Social Assistance",
  C24030_017E: "Arts, Entertainment, Recreation",
  C24030_018E: "Accommodation & Food Services",
  C24030_019E: "Other Services",
  C24030_020E: "Public Administration",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
  if (v == null || v === "" || v === -666666666 || v === -888888888) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function pct(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function annualGrowth(
  current: number | null,
  prior: number | null,
  years: number
): number | null {
  if (current == null || prior == null || prior === 0 || years === 0)
    return null;
  const totalGrowth = (current - prior) / prior;
  const annual = totalGrowth / years;
  return Math.round(annual * 1000) / 10; // one decimal, as %
}

// ── Step 1: Find tracts within radius via TIGERweb ──────────────────────────

interface TractFips {
  state: string;
  county: string;
  tract: string;
  geoid: string; // 11-digit full FIPS
}

async function findTractsInRadius(
  lat: number,
  lng: number,
  radiusMiles: number
): Promise<TractFips[]> {
  // TIGERweb ArcGIS REST spatial query: point + buffer distance
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusMiles),
    units: "esriSRUnit_StatuteMile",
    inSR: "4326",
    outFields: "STATE,COUNTY,TRACT,GEOID,BASENAME",
    returnGeometry: "false",
    f: "json",
  });

  const url = `${TIGERWEB_TRACTS}?${params.toString()}`;

  try {
    assertAllowedFetchUrl(url);
  } catch {
    console.error("TIGERweb URL rejected by allowlist");
    return [];
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`TIGERweb HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    if (json.error) {
      console.error("TIGERweb error:", json.error);
      return [];
    }
    const features = json.features || [];
    return features.map(
      (f: { attributes: Record<string, string> }) => ({
        state: f.attributes.STATE,
        county: f.attributes.COUNTY,
        tract: f.attributes.TRACT,
        geoid: f.attributes.GEOID,
      })
    );
  } catch (err) {
    console.error("TIGERweb fetch error:", err);
    return [];
  }
}

// ── Step 2: Fetch ACS data for tracts (batched by county) ───────────────────

type TractRow = Record<string, number | null>;

async function fetchAcsForTracts(
  tracts: TractFips[],
  variables: Record<string, string>,
  year: number
): Promise<Map<string, TractRow>> {
  // Group tracts by state+county so we can batch-fetch per county
  const byCounty = new Map<string, TractFips[]>();
  for (const t of tracts) {
    const key = `${t.state}|${t.county}`;
    if (!byCounty.has(key)) byCounty.set(key, []);
    byCounty.get(key)!.push(t);
  }

  const tractGeoidSet = new Set(tracts.map((t) => t.geoid));
  const result = new Map<string, TractRow>();
  const varCodes = Object.keys(variables).join(",");
  const base = ACS_BASE(year);

  // Fetch all tracts in each county (Census returns all tracts in one call)
  const countyKeys = Array.from(byCounty.keys());
  for (const key of countyKeys) {
    const [stateFips, countyFips] = key.split("|");
    const url = `${base}?get=${varCodes}&for=tract:*&in=state:${stateFips}+county:${countyFips}`;

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        console.error(`Census ACS tract HTTP ${res.status} for ${key}`);
        continue;
      }
      const json = await res.json();
      if (!Array.isArray(json) || json.length < 2) continue;

      const headers = json[0] as string[];
      const stateIdx = headers.indexOf("state");
      const countyIdx = headers.indexOf("county");
      const tractIdx = headers.indexOf("tract");

      // Process each tract row
      for (let r = 1; r < json.length; r++) {
        const row = json[r];
        const geoid =
          (row[stateIdx] || "") +
          (row[countyIdx] || "") +
          (row[tractIdx] || "");

        // Only keep tracts that are within our radius
        if (!tractGeoidSet.has(geoid)) continue;

        const parsed: TractRow = {};
        for (let i = 0; i < headers.length; i++) {
          if (
            headers[i] === "state" ||
            headers[i] === "county" ||
            headers[i] === "tract"
          )
            continue;
          parsed[headers[i]] = safeNum(row[i]);
        }
        result.set(geoid, parsed);
      }
    } catch (err) {
      console.error(`Census ACS tract fetch error for ${key}:`, err);
    }

    // Politeness delay between county batches
    if (byCounty.size > 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return result;
}

// ── Step 3: Population-weighted aggregation ─────────────────────────────────

function aggregateTracts(
  tractData: Map<string, TractRow>,
  priorData: Map<string, TractRow> | null
): DemographicSnapshot {
  if (tractData.size === 0) return emptySnapshot();

  // First pass: collect totals and population weights
  let totalPop = 0;
  let totalLaborForce = 0;
  let totalEmployed = 0;
  let totalUnemployed = 0;
  let totalHousingUnits = 0;
  let totalOwnerOcc = 0;
  let totalRenterOcc = 0;
  let totalTenure = 0;
  let totalPovertyCount = 0;
  let totalPovertyUniverse = 0;
  let totalBachPlus = 0;
  let totalEduUniverse = 0;
  let totalFamilyHH = 0;
  let totalHouseholds = 0;
  // B25118 renter income tranches (counts of renter HHs)
  let rInc_total = 0;
  let rInc_u50 = 0;
  let rInc_50_75 = 0;
  let rInc_75_100 = 0;
  let rInc_100_150 = 0;
  let rInc_150_plus = 0;
  // B25070 rent burden (counts of renter HHs with computed burden)
  let rb_u20 = 0;
  let rb_20_29 = 0;
  let rb_30_plus = 0;

  // For population-weighted medians: collect (value, weight) pairs
  const wAge: Array<[number, number]> = [];
  const wIncome: Array<[number, number]> = [];
  const wPerCapita: Array<[number, number]> = [];
  const wHomeValue: Array<[number, number]> = [];
  const wRent: Array<[number, number]> = [];
  const wHHSize: Array<[number, number]> = [];

  const tractEntries = Array.from(tractData.entries());
  for (const [, row] of tractEntries) {
    const pop = row.B01003_001E ?? 0;
    if (pop <= 0) continue;

    totalPop += pop;
    totalLaborForce += row.B23025_002E ?? 0;
    totalEmployed += row.B23025_004E ?? 0;
    totalUnemployed += row.B23025_005E ?? 0;
    totalHousingUnits += row.B25001_001E ?? 0;
    totalOwnerOcc += row.B25003_002E ?? 0;
    totalRenterOcc += row.B25003_003E ?? 0;
    totalTenure += row.B25003_001E ?? 0;
    totalPovertyCount += row.B17001_002E ?? 0;
    totalPovertyUniverse += row.B17001_001E ?? 0;
    totalBachPlus +=
      (row.B15003_022E ?? 0) +
      (row.B15003_023E ?? 0) +
      (row.B15003_024E ?? 0) +
      (row.B15003_025E ?? 0);
    totalEduUniverse += row.B15003_001E ?? 0;
    totalFamilyHH += row.B11001_002E ?? 0;
    totalHouseholds += row.B11001_001E ?? 0;

    // Renter income tranches — sum the raw buckets into Concord ranges.
    rInc_total += row.B25118_014E ?? 0;
    rInc_u50 +=
      (row.B25118_015E ?? 0) +
      (row.B25118_016E ?? 0) +
      (row.B25118_017E ?? 0) +
      (row.B25118_018E ?? 0) +
      (row.B25118_019E ?? 0) +
      (row.B25118_020E ?? 0) +
      (row.B25118_021E ?? 0);
    rInc_50_75 += row.B25118_022E ?? 0;
    rInc_75_100 += row.B25118_023E ?? 0;
    rInc_100_150 += row.B25118_024E ?? 0;
    rInc_150_plus += row.B25118_025E ?? 0;

    // Rent burden — sum buckets, exclude "not computed" (B25070_011E).
    rb_u20 +=
      (row.B25070_002E ?? 0) +
      (row.B25070_003E ?? 0) +
      (row.B25070_004E ?? 0);
    rb_20_29 += (row.B25070_005E ?? 0) + (row.B25070_006E ?? 0);
    rb_30_plus +=
      (row.B25070_007E ?? 0) +
      (row.B25070_008E ?? 0) +
      (row.B25070_009E ?? 0) +
      (row.B25070_010E ?? 0);

    if (row.B01002_001E != null) wAge.push([row.B01002_001E, pop]);
    if (row.B19013_001E != null) wIncome.push([row.B19013_001E, pop]);
    if (row.B19301_001E != null) wPerCapita.push([row.B19301_001E, pop]);
    if (row.B25077_001E != null && row.B25077_001E > 0)
      wHomeValue.push([row.B25077_001E, pop]);
    if (row.B25064_001E != null && row.B25064_001E > 0)
      wRent.push([row.B25064_001E, pop]);
    if (row.B25010_001E != null) wHHSize.push([row.B25010_001E, pop]);
  }

  if (totalPop === 0) return emptySnapshot();

  // Compute weighted median (actually weighted average for tract-level data —
  // true weighted median would require sorting, but weighted average is standard
  // practice for ACS tract aggregation and matches how Placer/ESRI do it)
  const wAvg = (pairs: Array<[number, number]>): number | null => {
    if (pairs.length === 0) return null;
    let sumW = 0;
    let sumVW = 0;
    for (const [v, w] of pairs) {
      sumVW += v * w;
      sumW += w;
    }
    return sumW > 0 ? Math.round(sumVW / sumW) : null;
  };

  const wAvgDec = (
    pairs: Array<[number, number]>,
    decimals = 1
  ): number | null => {
    if (pairs.length === 0) return null;
    let sumW = 0;
    let sumVW = 0;
    for (const [v, w] of pairs) {
      sumVW += v * w;
      sumW += w;
    }
    if (sumW === 0) return null;
    const factor = Math.pow(10, decimals);
    return Math.round((sumVW / sumW) * factor) / factor;
  };

  // Growth rates from prior-year data
  let popGrowth: number | null = null;
  let homeValueGrowth: number | null = null;
  let rentGrowth: number | null = null;

  if (priorData && priorData.size > 0) {
    let priorPop = 0;
    const priorHomeValues: Array<[number, number]> = [];
    const priorRents: Array<[number, number]> = [];

    const priorEntries = Array.from(priorData.entries());
    for (const [geoid, row] of priorEntries) {
      const pop = row.B01003_001E ?? 0;
      if (pop <= 0) continue;
      priorPop += pop;
      if (row.B25077_001E != null && row.B25077_001E > 0)
        priorHomeValues.push([row.B25077_001E, pop]);
      if (row.B25064_001E != null && row.B25064_001E > 0)
        priorRents.push([row.B25064_001E, pop]);
    }

    const years = ACS_YEAR - ACS_PRIOR_YEAR;
    popGrowth = annualGrowth(totalPop, priorPop, years);
    homeValueGrowth = annualGrowth(wAvg(wHomeValue), wAvg(priorHomeValues), years);
    rentGrowth = annualGrowth(wAvg(wRent), wAvg(priorRents), years);
  }

  return {
    total_population: totalPop,
    population_growth_pct: popGrowth,
    median_age: wAvgDec(wAge),
    median_household_income: wAvg(wIncome),
    per_capita_income: wAvg(wPerCapita),
    poverty_rate: pct(totalPovertyCount, totalPovertyUniverse),
    bachelors_degree_pct: pct(totalBachPlus, totalEduUniverse),
    total_housing_units: totalHousingUnits,
    owner_occupied_pct: pct(totalOwnerOcc, totalTenure),
    renter_occupied_pct: pct(totalRenterOcc, totalTenure),
    median_home_value: wAvg(wHomeValue),
    median_gross_rent: wAvg(wRent),
    home_value_growth_pct: homeValueGrowth,
    rent_growth_pct: rentGrowth,
    labor_force: totalLaborForce,
    unemployment_rate: pct(totalUnemployed, totalLaborForce),
    total_employed: totalEmployed,
    top_employers: [],
    top_industries: [], // filled separately
    avg_household_size: wAvgDec(wHHSize),
    family_households_pct: pct(totalFamilyHH, totalHouseholds),
    renter_households_by_income:
      rInc_total > 0
        ? {
            total: rInc_total,
            under_50k: rInc_u50,
            income_50_75k: rInc_50_75,
            income_75_100k: rInc_75_100,
            income_100_150k: rInc_100_150,
            over_150k: rInc_150_plus,
          }
        : null,
    renter_rent_burden:
      rb_u20 + rb_20_29 + rb_30_plus > 0
        ? {
            computed_total: rb_u20 + rb_20_29 + rb_30_plus,
            under_20_pct: rb_u20,
            pct_20_to_29: rb_20_29,
            pct_30_plus: rb_30_plus,
          }
        : null,
  };
}

// ── Industry data (county-level — still appropriate for industry mix) ────────

async function fetchIndustryData(
  tracts: TractFips[]
): Promise<Array<{ name: string; share_pct?: number }>> {
  // Industry data at tract level is sparse/suppressed. County-level is
  // standard practice (even Placer.ai uses MSA-level for industry).
  // Dedupe to unique counties.
  const counties = new Map<string, { state: string; county: string }>();
  for (const t of tracts) {
    counties.set(`${t.state}|${t.county}`, {
      state: t.state,
      county: t.county,
    });
  }

  // Aggregate industry counts across all counties that touch our radius
  const totals: Record<string, number> = {};
  const varCodes = Object.keys(INDUSTRY_VARIABLES).join(",");

  const countyEntries = Array.from(counties.entries());
  for (const [, { state, county }] of countyEntries) {
    const url = `${ACS_BASE(ACS_YEAR)}?get=${varCodes}&for=county:${county}&in=state:${state}`;
    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const json = await res.json();
      if (!Array.isArray(json) || json.length < 2) continue;

      const headers = json[0] as string[];
      const values = json[1];
      for (let i = 0; i < headers.length; i++) {
        const n = safeNum(values[i]);
        if (n != null && INDUSTRY_VARIABLES[headers[i]]) {
          totals[headers[i]] = (totals[headers[i]] ?? 0) + n;
        }
      }
    } catch {
      // Non-fatal
    }
  }

  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(INDUSTRY_VARIABLES)
    .map(([code, name]) => ({
      name,
      count: totals[code] ?? 0,
      share_pct:
        total > 0
          ? Math.round(((totals[code] ?? 0) / total) * 1000) / 10
          : 0,
    }))
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return sorted.map((i) => ({ name: i.name, share_pct: i.share_pct }));
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
    renter_households_by_income: null,
    renter_rent_burden: null,
  };
}

// ── POST handler ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
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

    const lat = Number(deal.lat);
    const lng = Number(deal.lng);

    // Step 1: Find census tracts within the radius
    const tracts = await findTractsInRadius(lat, lng, radiusMiles);
    if (tracts.length === 0) {
      return NextResponse.json(
        {
          error:
            "No census tracts found within the radius. The TIGERweb service may be temporarily unavailable — try again in a moment.",
        },
        { status: 502 }
      );
    }

    // Step 2: Fetch ACS data for those tracts (current + prior year in parallel)
    const [currentTractData, priorTractData] = await Promise.all([
      fetchAcsForTracts(tracts, CENSUS_VARIABLES, ACS_YEAR),
      fetchAcsForTracts(tracts, GROWTH_VARIABLES, ACS_PRIOR_YEAR),
    ]);

    // Step 3: Aggregate
    const data = aggregateTracts(currentTractData, priorTractData);

    // Step 4: Industry data (county-level, standard practice)
    data.top_industries = await fetchIndustryData(tracts);

    // Unique counties for source notes
    const uniqueCounties = new Set(tracts.map((t) => `${t.state}${t.county}`));

    // Upsert
    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      radiusMiles
    );
    const id = existing?.id ?? uuidv4();
    const existingProjections = existing?.projections
      ? typeof existing.projections === "string"
        ? JSON.parse(existing.projections)
        : existing.projections
      : {};

    const row = await locationIntelligenceQueries.upsert(
      params.id,
      id,
      radiusMiles,
      data as unknown as Record<string, unknown>,
      existingProjections,
      "census_acs",
      ACS_YEAR,
      `Census ACS 5-Year (${ACS_YEAR}), ${tracts.length} tracts across ${uniqueCounties.size} ${uniqueCounties.size === 1 ? "county" : "counties"}`
    );

    return NextResponse.json({
      data: row,
      meta: {
        source: "Census ACS 5-Year",
        year: ACS_YEAR,
        prior_year: ACS_PRIOR_YEAR,
        geography: "Census Tract (population-weighted)",
        tracts_found: tracts.length,
        tracts_with_data: currentTractData.size,
        counties: uniqueCounties.size,
        radius_miles: radiusMiles,
        note: `Aggregated ${currentTractData.size} census tracts within ${radiusMiles}-mile radius. Growth rates computed from ${ACS_PRIOR_YEAR}–${ACS_YEAR} ACS comparison.`,
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/location-intelligence/fetch-census error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch Census data" },
      { status: 500 }
    );
  }
}
