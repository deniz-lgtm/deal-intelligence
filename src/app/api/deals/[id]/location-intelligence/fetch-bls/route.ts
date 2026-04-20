import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── BLS Quarterly Census of Employment and Wages (QCEW) ─────────────────────
//
// Free, no API key. Returns current employment counts, wages, and
// establishment counts by county. Much more current than Census ACS
// (quarterly vs 1-2 year lag).
//
// Docs: https://www.bls.gov/cew/downloadable-data-files.htm
// API:  https://data.bls.gov/cew/data/api/YEAR/QTR/area/FIPS.csv
//
// The QCEW "area" FIPS for a county is the 5-digit state+county code
// (e.g., "06037" = Los Angeles County, CA).

interface QcewData {
  year: number;
  quarter: number;
  total_employment: number | null;
  total_wages: number | null;
  avg_weekly_wage: number | null;
  total_establishments: number | null;
  // Top industries by employment (NAICS supersectors)
  top_industries: Array<{
    name: string;
    employment: number;
    avg_weekly_wage: number | null;
  }>;
}

// NAICS supersector codes → human-readable names
const NAICS_SUPERSECTORS: Record<string, string> = {
  "1011": "Natural Resources & Mining",
  "1012": "Construction",
  "1013": "Manufacturing",
  "1021": "Trade, Transportation & Utilities",
  "1022": "Information",
  "1023": "Financial Activities",
  "1024": "Professional & Business Services",
  "1025": "Education & Health Services",
  "1026": "Leisure & Hospitality",
  "1027": "Other Services",
  "1028": "Public Administration",
  "1029": "Unclassified",
};

/**
 * Resolve lat/lng to county FIPS (5-digit) using Census geocoder.
 */
async function getCountyFips5(
  lat: number,
  lng: number
): Promise<string | null> {
  const url =
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
    `?x=${lng}&y=${lat}` +
    `&benchmark=Public_AR_Current` +
    `&vintage=Current_Current` +
    `&format=json`;

  try {
    assertAllowedFetchUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const geo = json.result?.geographies;
    const counties = geo?.["Counties"] || [];
    const first = counties[0];
    if (!first) return null;
    const state = first.STATE || first.STATEFP || "";
    const county = first.COUNTY || first.COUNTYFP || "";
    return state + county; // e.g., "06037"
  } catch {
    return null;
  }
}

/**
 * Fetch QCEW data for a county. Tries current year first, falls back
 * to prior year if data isn't published yet.
 */
async function fetchQcew(fips5: string): Promise<QcewData | null> {
  const now = new Date();
  const currentYear = now.getFullYear();
  // QCEW data has ~6 month lag. Try most recent quarters.
  const attempts = [
    { year: currentYear - 1, qtr: 4 },
    { year: currentYear - 1, qtr: 3 },
    { year: currentYear - 1, qtr: 2 },
    { year: currentYear - 1, qtr: 1 },
    { year: currentYear - 2, qtr: 4 },
  ];

  for (const { year, qtr } of attempts) {
    const result = await fetchQcewQuarter(fips5, year, qtr);
    if (result) return result;
  }
  return null;
}

async function fetchQcewQuarter(
  fips5: string,
  year: number,
  quarter: number
): Promise<QcewData | null> {
  // BLS QCEW CSV API — returns CSV for a single area
  const url = `https://data.bls.gov/cew/data/api/${year}/${quarter}/area/${fips5}.csv`;

  try {
    assertAllowedFetchUrl(url);
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;

    // Parse CSV headers
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

    const colIdx = (name: string) => headers.indexOf(name);
    const iOwn = colIdx("own_code"); // 0 = total all ownership
    const iInd = colIdx("industry_code"); // "10" = total all industries
    const iEmp = colIdx("month3_emplvl"); // end-of-quarter employment
    const iWage = colIdx("total_qtrly_wages");
    const iAww = colIdx("avg_wkly_wage");
    const iEst = colIdx("qtrly_estabs");

    if (iOwn < 0 || iInd < 0 || iEmp < 0) return null;

    let totalEmployment: number | null = null;
    let totalWages: number | null = null;
    let avgWeeklyWage: number | null = null;
    let totalEstablishments: number | null = null;

    const industryData: Array<{
      code: string;
      name: string;
      employment: number;
      avg_weekly_wage: number | null;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      // Simple CSV parsing (QCEW fields don't contain commas)
      const cols = lines[i].split(",").map((c) => c.trim().replace(/"/g, ""));
      const own = cols[iOwn];
      const ind = cols[iInd];

      // Total all ownership (own_code=0), total all industries (industry_code=10)
      if (own === "0" && ind === "10") {
        totalEmployment = safeInt(cols[iEmp]);
        totalWages = safeInt(cols[iWage]);
        avgWeeklyWage = safeInt(cols[iAww]);
        totalEstablishments = safeInt(cols[iEst]);
      }

      // Supersector rows (own_code=0, industry_code matches our map)
      if (own === "0" && NAICS_SUPERSECTORS[ind]) {
        const emp = safeInt(cols[iEmp]);
        if (emp != null && emp > 0) {
          industryData.push({
            code: ind,
            name: NAICS_SUPERSECTORS[ind],
            employment: emp,
            avg_weekly_wage: safeInt(cols[iAww]),
          });
        }
      }
    }

    if (totalEmployment == null) return null;

    // Sort industries by employment, take top 8
    industryData.sort((a, b) => b.employment - a.employment);

    return {
      year,
      quarter,
      total_employment: totalEmployment,
      total_wages: totalWages,
      avg_weekly_wage: avgWeeklyWage,
      total_establishments: totalEstablishments,
      top_industries: industryData.slice(0, 8).map((i) => ({
        name: i.name,
        employment: i.employment,
        avg_weekly_wage: i.avg_weekly_wage,
      })),
    };
  } catch (err) {
    console.error(`QCEW fetch error (${fips5}, ${year}Q${quarter}):`, err);
    return null;
  }
}

function safeInt(v: string | undefined): number | null {
  if (!v || v === "" || v === "N" || v === "n") return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
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

    const deal = await dealQueries.getById(params.id);
    if (!deal?.lat || !deal?.lng) {
      return NextResponse.json(
        { error: "Deal has no coordinates. Geocode the deal first." },
        { status: 400 }
      );
    }

    // Resolve to county FIPS
    const fips5 = await getCountyFips5(Number(deal.lat), Number(deal.lng));
    if (!fips5) {
      return NextResponse.json(
        { error: "Could not determine county for this location." },
        { status: 502 }
      );
    }

    // Fetch QCEW data
    const qcew = await fetchQcew(fips5);
    if (!qcew) {
      return NextResponse.json(
        { error: "BLS QCEW data not available for this county. Data may not yet be published for the most recent quarters." },
        { status: 404 }
      );
    }

    // Merge BLS data into existing location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      radiusMiles
    );

    if (existing) {
      const data =
        typeof existing.data === "string"
          ? JSON.parse(existing.data)
          : existing.data || {};

      // Overlay BLS employment data onto the snapshot
      data.labor_force = data.labor_force; // keep Census for labor force (includes non-employed)
      data.total_employed = qcew.total_employment ?? data.total_employed;
      data.avg_weekly_wage = qcew.avg_weekly_wage;
      data.total_establishments = qcew.total_establishments;
      data.bls_year = qcew.year;
      data.bls_quarter = qcew.quarter;

      // Replace industry data with BLS (more current than Census)
      if (qcew.top_industries.length > 0) {
        const totalEmp = qcew.top_industries.reduce(
          (s, i) => s + i.employment,
          0
        );
        data.top_industries = qcew.top_industries.map((i) => ({
          name: i.name,
          share_pct:
            totalEmp > 0
              ? Math.round((i.employment / totalEmp) * 1000) / 10
              : 0,
          employment: i.employment,
          avg_weekly_wage: i.avg_weekly_wage,
        }));
      }

      const projections =
        typeof existing.projections === "string"
          ? JSON.parse(existing.projections)
          : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id,
        existing.id,
        radiusMiles,
        data,
        projections,
        "mixed",
        existing.source_year,
        `${existing.source_notes || ""}; BLS QCEW ${qcew.year}Q${qcew.quarter} (county ${fips5})`
      );
    }

    return NextResponse.json({
      data: qcew,
      meta: {
        source: "BLS QCEW",
        period: `${qcew.year} Q${qcew.quarter}`,
        county_fips: fips5,
        note: `Current employment data from BLS Quarterly Census of Employment & Wages. County-level (FIPS ${fips5}).`,
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/location-intelligence/fetch-bls error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch BLS data" },
      { status: 500 }
    );
  }
}
