import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── Census ACS Race/Ethnicity & Age Distribution ─────────────────────────────
// Detailed diversity data from ACS 5-Year at the county level.
// B03002 = Hispanic or Latino by Race
// B01001 = Sex by Age (for age distribution)
// B16001 = Language Spoken at Home

const ACS_YEAR = 2023;

// Race/ethnicity variables (B03002 — Hispanic/Latino by Race)
const RACE_VARS: Record<string, string> = {
  B03002_001E: "_total",
  B03002_003E: "white_alone",
  B03002_004E: "black_alone",
  B03002_005E: "native_alone",
  B03002_006E: "asian_alone",
  B03002_007E: "pacific_islander_alone",
  B03002_008E: "other_race_alone",
  B03002_009E: "two_or_more",
  B03002_012E: "hispanic_latino",
};

// Age distribution variables (B01001 — Sex by Age, simplified buckets)
const AGE_VARS: Record<string, string> = {
  B01001_001E: "_age_total",
  // Under 18 (sum male + female groups)
  B01001_003E: "_m_under5", B01001_004E: "_m_5to9", B01001_005E: "_m_10to14", B01001_006E: "_m_15to17",
  B01001_027E: "_f_under5", B01001_028E: "_f_5to9", B01001_029E: "_f_10to14", B01001_030E: "_f_15to17",
  // 18-24
  B01001_007E: "_m_18to19", B01001_008E: "_m_20", B01001_009E: "_m_21", B01001_010E: "_m_22to24",
  B01001_031E: "_f_18to19", B01001_032E: "_f_20", B01001_033E: "_f_21", B01001_034E: "_f_22to24",
  // 25-44
  B01001_011E: "_m_25to29", B01001_012E: "_m_30to34", B01001_013E: "_m_35to39", B01001_014E: "_m_40to44",
  B01001_035E: "_f_25to29", B01001_036E: "_f_30to34", B01001_037E: "_f_35to39", B01001_038E: "_f_40to44",
  // 45-64
  B01001_015E: "_m_45to49", B01001_016E: "_m_50to54", B01001_017E: "_m_55to59", B01001_018E: "_m_60to61", B01001_019E: "_m_62to64",
  B01001_039E: "_f_45to49", B01001_040E: "_f_50to54", B01001_041E: "_f_55to59", B01001_042E: "_f_60to61", B01001_043E: "_f_62to64",
  // 65+
  B01001_020E: "_m_65to66", B01001_021E: "_m_67to69", B01001_022E: "_m_70to74", B01001_023E: "_m_75to79", B01001_024E: "_m_80to84", B01001_025E: "_m_85plus",
  B01001_044E: "_f_65to66", B01001_045E: "_f_67to69", B01001_046E: "_f_70to74", B01001_047E: "_f_75to79", B01001_048E: "_f_80to84", B01001_049E: "_f_85plus",
};

// Language variables (B16001 — Language Spoken at Home)
const LANG_VARS: Record<string, string> = {
  B16001_001E: "_lang_total",
  B16001_002E: "english_only",
  B16001_003E: "spanish",
  B16001_006E: "french_creole",
  B16001_009E: "german",
  B16001_012E: "chinese",
  B16001_015E: "japanese",
  B16001_018E: "korean",
  B16001_021E: "vietnamese",
  B16001_024E: "tagalog",
  B16001_027E: "arabic",
  B16001_030E: "other_asian",
  B16001_033E: "other_languages",
};

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

function safeNum(v: unknown): number {
  if (v == null || v === "" || v === "-666666666") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function pctOf(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return Math.round((num / denom) * 1000) / 10;
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

    const base = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;

    // Fetch race, age, and language data in parallel
    const fetchVars = async (vars: Record<string, string>) => {
      const codes = Object.keys(vars).join(",");
      const url = `${base}?get=${codes}&for=county:${fips.county}&in=state:${fips.state}`;
      try {
        assertAllowedFetchUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return {};
        const json = await res.json();
        if (!Array.isArray(json) || json.length < 2) return {};
        const headers = json[0] as string[];
        const values = json[1];
        const result: Record<string, number> = {};
        for (let i = 0; i < headers.length; i++) {
          result[headers[i]] = safeNum(values[i]);
        }
        return result;
      } catch { return {}; }
    };

    const [raceRaw, ageRaw, langRaw] = await Promise.all([
      fetchVars(RACE_VARS),
      fetchVars(AGE_VARS),
      fetchVars(LANG_VARS),
    ]);

    // Process race/ethnicity
    const raceTotal = raceRaw.B03002_001E || 1;
    const race = {
      white_pct: pctOf(raceRaw.B03002_003E || 0, raceTotal),
      black_pct: pctOf(raceRaw.B03002_004E || 0, raceTotal),
      asian_pct: pctOf(raceRaw.B03002_006E || 0, raceTotal),
      hispanic_pct: pctOf(raceRaw.B03002_012E || 0, raceTotal),
      native_pct: pctOf(raceRaw.B03002_005E || 0, raceTotal),
      pacific_islander_pct: pctOf(raceRaw.B03002_007E || 0, raceTotal),
      two_or_more_pct: pctOf(raceRaw.B03002_009E || 0, raceTotal),
      other_pct: pctOf(raceRaw.B03002_008E || 0, raceTotal),
      // Diversity index (1 - sum of squared proportions, 0=homogeneous, 1=diverse)
      diversity_index: (() => {
        const props = [
          (raceRaw.B03002_003E || 0) / raceTotal,
          (raceRaw.B03002_004E || 0) / raceTotal,
          (raceRaw.B03002_006E || 0) / raceTotal,
          (raceRaw.B03002_012E || 0) / raceTotal,
          (raceRaw.B03002_005E || 0) / raceTotal,
          (raceRaw.B03002_007E || 0) / raceTotal,
          (raceRaw.B03002_009E || 0) / raceTotal,
          (raceRaw.B03002_008E || 0) / raceTotal,
        ];
        const sumSq = props.reduce((s, p) => s + p * p, 0);
        return Math.round((1 - sumSq) * 100) / 100;
      })(),
    };

    // Process age distribution
    const ageTotal = ageRaw.B01001_001E || 1;
    const sumKeys = (keys: string[]) => keys.reduce((s, k) => s + (ageRaw[k] || 0), 0);
    const under18 = sumKeys(["B01001_003E","B01001_004E","B01001_005E","B01001_006E","B01001_027E","B01001_028E","B01001_029E","B01001_030E"]);
    const age18to24 = sumKeys(["B01001_007E","B01001_008E","B01001_009E","B01001_010E","B01001_031E","B01001_032E","B01001_033E","B01001_034E"]);
    const age25to44 = sumKeys(["B01001_011E","B01001_012E","B01001_013E","B01001_014E","B01001_035E","B01001_036E","B01001_037E","B01001_038E"]);
    const age45to64 = sumKeys(["B01001_015E","B01001_016E","B01001_017E","B01001_018E","B01001_019E","B01001_039E","B01001_040E","B01001_041E","B01001_042E","B01001_043E"]);
    const age65plus = sumKeys(["B01001_020E","B01001_021E","B01001_022E","B01001_023E","B01001_024E","B01001_025E","B01001_044E","B01001_045E","B01001_046E","B01001_047E","B01001_048E","B01001_049E"]);

    const age = {
      under_18_pct: pctOf(under18, ageTotal),
      age_18_24_pct: pctOf(age18to24, ageTotal),
      age_25_44_pct: pctOf(age25to44, ageTotal),
      age_45_64_pct: pctOf(age45to64, ageTotal),
      age_65_plus_pct: pctOf(age65plus, ageTotal),
      working_age_pct: pctOf(age18to24 + age25to44 + age45to64, ageTotal),
    };

    // Process language
    const langTotal = langRaw.B16001_001E || 1;
    const topLanguages = [
      { language: "English Only", count: langRaw.B16001_002E || 0, pct: pctOf(langRaw.B16001_002E || 0, langTotal) },
      { language: "Spanish", count: langRaw.B16001_003E || 0, pct: pctOf(langRaw.B16001_003E || 0, langTotal) },
      { language: "Chinese", count: langRaw.B16001_012E || 0, pct: pctOf(langRaw.B16001_012E || 0, langTotal) },
      { language: "Vietnamese", count: langRaw.B16001_021E || 0, pct: pctOf(langRaw.B16001_021E || 0, langTotal) },
      { language: "Korean", count: langRaw.B16001_018E || 0, pct: pctOf(langRaw.B16001_018E || 0, langTotal) },
      { language: "Tagalog", count: langRaw.B16001_024E || 0, pct: pctOf(langRaw.B16001_024E || 0, langTotal) },
      { language: "Arabic", count: langRaw.B16001_027E || 0, pct: pctOf(langRaw.B16001_027E || 0, langTotal) },
      { language: "French/Creole", count: langRaw.B16001_006E || 0, pct: pctOf(langRaw.B16001_006E || 0, langTotal) },
    ].filter((l) => l.count > 0).sort((a, b) => b.count - a.count);

    const result = { race, age, languages: topLanguages };

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.race_ethnicity = race;
      data.age_distribution = age;
      data.languages = topLanguages;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};
      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; Census Diversity (${ACS_YEAR})`
      );
    }

    return NextResponse.json({
      data: result,
      meta: { source: `Census ACS ${ACS_YEAR}`, note: `Diversity index: ${race.diversity_index} (0=homogeneous, 1=fully diverse).` },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-diversity error:", error);
    return NextResponse.json({ error: "Failed to fetch diversity data" }, { status: 500 });
  }
}
