import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// ── BLS Quarterly Census of Employment & Wages (QCEW) ────────────────────────
//
// Covered employment + wages by NAICS industry by county. QCEW is the
// Census-of-employment series: it's a complete tally from state unemployment-
// insurance records, so it covers >95% of employment (unlike survey-based
// series). Published quarterly with a ~6-month lag.
//
// Developer relevance:
//   - Top industries by employment share — who drives housing demand here?
//   - YoY industry-level job growth — is the submarket expanding or shrinking?
//   - Average weekly wage — is income rising enough to support rent growth?
//   - Total employment level — scale of the labor market.
//
// API: https://data.bls.gov/cew/data/api/{year}/{qtr}/area/{area_code}.csv
// No API key required. Free + unauthenticated. JSON endpoint is also available.
//
// Area code is 5-digit FIPS for counties, prefixed "C" in some endpoints but
// the plain FIPS works on the /api/ endpoint.

async function getCountyFips(lat: number, lng: number): Promise<string | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const counties = json.result?.geographies?.["Counties"] || [];
    const first = counties[0];
    if (!first) return null;
    return (first.STATE || first.STATEFP) + (first.COUNTY || first.COUNTYFP);
  } catch { return null; }
}

// ── Curated NAICS 2-digit supersectors ──────────────────────────────────────
// QCEW returns data at every NAICS level (2-digit "supersector" through
// 6-digit industry). 2-digit is the right grain for a broker memo — it
// captures "Health Care & Social Assistance" without drowning the page in
// 6-digit "Offices of Physicians". Ownership code "5" = private sector.
const NAICS_SUPERSECTORS: Record<string, string> = {
  "11": "Agriculture, Forestry, Fishing & Hunting",
  "21": "Mining, Quarrying, & Oil and Gas Extraction",
  "22": "Utilities",
  "23": "Construction",
  "31-33": "Manufacturing",
  "42": "Wholesale Trade",
  "44-45": "Retail Trade",
  "48-49": "Transportation and Warehousing",
  "51": "Information",
  "52": "Finance and Insurance",
  "53": "Real Estate and Rental and Leasing",
  "54": "Professional, Scientific, and Technical Services",
  "55": "Management of Companies and Enterprises",
  "56": "Administrative and Support and Waste Management Services",
  "61": "Educational Services",
  "62": "Health Care and Social Assistance",
  "71": "Arts, Entertainment, and Recreation",
  "72": "Accommodation and Food Services",
  "81": "Other Services (except Public Administration)",
  "92": "Public Administration",
};

interface QcewIndustryRow {
  naics: string;
  label: string;
  employment: number;
  employment_share_pct: number;      // share of county's private-sector total
  avg_weekly_wage: number | null;
  yoy_employment_pct: number | null; // vs. same quarter prior year
}

interface QcewData {
  county_fips: string;
  reporting_period: string;          // e.g. "2024-Q2"
  total_employment: number | null;
  avg_weekly_wage: number | null;
  industries: QcewIndustryRow[];     // Top N by employment
  yoy_employment_pct: number | null; // all-industry YoY
}

// BLS QCEW returns "the most recent complete quarter" with ~6 month lag.
// We try the most recent 4 quarters in descending order.
function recentQuarters(n: number): Array<{ year: number; qtr: number }> {
  const out: Array<{ year: number; qtr: number }> = [];
  const now = new Date();
  // Conservatively assume publication is 2 quarters back from today.
  let year = now.getFullYear();
  let qtr = Math.ceil((now.getMonth() + 1) / 3) - 2;
  while (qtr < 1) { qtr += 4; year -= 1; }
  for (let i = 0; i < n; i++) {
    out.push({ year, qtr });
    qtr -= 1;
    if (qtr < 1) { qtr = 4; year -= 1; }
  }
  return out;
}

// Fetch a single (year, quarter, FIPS) QCEW area-level CSV. Returns the
// parsed rows keyed by NAICS industry code. Ownership code "5" = private.
async function fetchQuarter(year: number, qtr: number, fips: string): Promise<Array<Record<string, string>> | null> {
  const url = `https://data.bls.gov/cew/data/api/${year}/${qtr}/area/${fips}.csv`;
  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const text = await res.text();
    // Simple CSV parser — QCEW fields are unquoted integers/strings, no
    // embedded commas in our columns of interest. Parses the header then
    // each data line into a column-indexed object.
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const rows: Array<Record<string, string>> = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, ""));
      if (cols.length < headers.length - 1) continue;
      const obj: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] || "";
      rows.push(obj);
    }
    return rows;
  } catch (err) {
    console.error(`QCEW fetch error (${year}Q${qtr} ${fips}):`, err);
    return null;
  }
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

    const fips = await getCountyFips(Number(deal.lat), Number(deal.lng));
    if (!fips) {
      return NextResponse.json({ error: "Could not determine county." }, { status: 502 });
    }

    // Try recent quarters until one has data. QCEW lag + holiday publishing
    // means the "expected" current quarter sometimes returns an empty file.
    const candidates = recentQuarters(5);
    let currentRows: Array<Record<string, string>> | null = null;
    let period = { year: 0, qtr: 0 };
    for (const c of candidates) {
      const r = await fetchQuarter(c.year, c.qtr, fips);
      if (r && r.length > 0) {
        currentRows = r;
        period = c;
        break;
      }
    }
    if (!currentRows) {
      return NextResponse.json(
        { error: "QCEW data not available for this county (try again later — publication has a ~6-month lag)." },
        { status: 404 }
      );
    }

    // Same quarter one year earlier — for YoY deltas.
    const yearAgoRows = await fetchQuarter(period.year - 1, period.qtr, fips);

    // Filter to private-sector (ownership code "5") supersector rows.
    // QCEW has multiple rows per industry for different aggregation levels
    // ("agglvl_code"); private-sector supersector is agglvl_code 74 (private
    // sector by supersector).
    const isPrivateSupersector = (r: Record<string, string>) =>
      r.own_code === "5" && r.agglvl_code === "74";

    const supersectorRows = currentRows.filter(isPrivateSupersector);
    const yearAgoSupersectorRows = yearAgoRows?.filter(isPrivateSupersector) ?? [];

    // County-level private-sector total — agglvl_code 71.
    const countyTotalRow = currentRows.find(
      (r) => r.own_code === "5" && r.agglvl_code === "71"
    );
    const countyTotalYoyRow = yearAgoRows?.find(
      (r) => r.own_code === "5" && r.agglvl_code === "71"
    );

    const totalEmployment = countyTotalRow ? parseInt(countyTotalRow.month3_emplvl || "0", 10) : null;
    const totalEmploymentYoy = countyTotalYoyRow ? parseInt(countyTotalYoyRow.month3_emplvl || "0", 10) : null;
    const yoyAllIndustries = totalEmployment && totalEmploymentYoy
      ? Math.round(((totalEmployment - totalEmploymentYoy) / totalEmploymentYoy) * 1000) / 10
      : null;
    const avgWeeklyWage = countyTotalRow && countyTotalRow.avg_wkly_wage
      ? parseInt(countyTotalRow.avg_wkly_wage, 10) || null
      : null;

    const industries: QcewIndustryRow[] = supersectorRows
      .map((r) => {
        const naics = r.industry_code || "";
        const label = NAICS_SUPERSECTORS[naics] || r.industry_title || naics;
        const employment = parseInt(r.month3_emplvl || "0", 10) || 0;
        const wage = parseInt(r.avg_wkly_wage || "0", 10) || null;
        const yoyRow = yearAgoSupersectorRows.find((y) => y.industry_code === naics);
        const yearAgoEmp = yoyRow ? parseInt(yoyRow.month3_emplvl || "0", 10) : 0;
        const yoyPct = yearAgoEmp > 0
          ? Math.round(((employment - yearAgoEmp) / yearAgoEmp) * 1000) / 10
          : null;
        const share = totalEmployment && totalEmployment > 0
          ? Math.round((employment / totalEmployment) * 1000) / 10
          : 0;
        return {
          naics,
          label,
          employment,
          employment_share_pct: share,
          avg_weekly_wage: wage,
          yoy_employment_pct: yoyPct,
        };
      })
      .filter((r) => r.employment > 0)
      .sort((a, b) => b.employment - a.employment);

    const result: QcewData = {
      county_fips: fips,
      reporting_period: `${period.year}-Q${period.qtr}`,
      total_employment: totalEmployment,
      avg_weekly_wage: avgWeeklyWage,
      industries,
      yoy_employment_pct: yoyAllIndustries,
    };

    // Merge into location_intelligence.data.qcew so downstream helpers
    // (formatLocationIntelContext, buildMarketSummary) pick it up without
    // a separate read.
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      data.qcew = result;

      // Also overlay "top_industries" in the shape formatLocationIntelContext
      // already renders, so the memo context picks up QCEW even where it was
      // previously relying on a different source. Don't overwrite if ACS
      // top_industries already populated it.
      if (!Array.isArray(data.top_industries) || data.top_industries.length === 0) {
        data.top_industries = industries.slice(0, 5).map((i) => ({
          name: i.label,
          share_pct: i.employment_share_pct,
          yoy_pct: i.yoy_employment_pct,
          employment: i.employment,
        }));
      }

      const projections = typeof existing.projections === "string"
        ? JSON.parse(existing.projections)
        : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; BLS QCEW ${result.reporting_period} (county ${fips})`
      );
    }

    return NextResponse.json({
      data: result,
      meta: {
        source: "BLS Quarterly Census of Employment and Wages",
        period: result.reporting_period,
        note: `Private-sector employment by NAICS supersector for county FIPS ${fips}. Total private employment: ${totalEmployment?.toLocaleString() || "N/A"} (${yoyAllIndustries ?? "?"}% YoY).`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-qcew error:", error);
    return NextResponse.json({ error: "Failed to fetch QCEW data" }, { status: 500 });
  }
}
