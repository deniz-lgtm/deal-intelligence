import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { assertAllowedFetchUrl } from "@/lib/web-allowlist";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── BLS Local Area Unemployment Statistics (LAUS) ────────────────────────────
//
// Monthly unemployment rate and labor force by county. More current than
// QCEW (~1 month lag vs 6 months). Free, no key required.
//
// API: https://api.bls.gov/publicAPI/v2/timeseries/data/
// Series ID format: LAUCN{FIPS5}0000000{measure}
//   measure: 3=unemployment rate, 4=unemployment, 5=employment, 6=labor force

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

interface LausData {
  county_fips: string;
  latest_month: string;
  unemployment_rate: number | null;
  labor_force: number | null;
  employed: number | null;
  unemployed: number | null;
  // 12-month trend
  trend: Array<{ month: string; rate: number }>;
  yoy_rate_change: number | null; // percentage point change
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

    const fips5 = await getCountyFips(Number(deal.lat), Number(deal.lng));
    if (!fips5) {
      return NextResponse.json({ error: "Could not determine county." }, { status: 502 });
    }

    // BLS LAUS series IDs for this county
    const rateSeries = `LAUCN${fips5}0000000003`; // unemployment rate
    const lfSeries = `LAUCN${fips5}0000000006`;   // labor force
    const empSeries = `LAUCN${fips5}0000000005`;  // employment
    const unempSeries = `LAUCN${fips5}0000000004`; // unemployment count

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 2;

    // BLS public API (no key needed, 25 requests/day limit for v2 without key)
    const url = `https://api.bls.gov/publicAPI/v2/timeseries/data/`;
    const payload = {
      seriesid: [rateSeries, lfSeries, empSeries, unempSeries],
      startyear: String(startYear),
      endyear: String(currentYear),
    };

    let seriesData: Record<string, Array<{ year: string; period: string; value: string }>> = {};

    try {
      assertAllowedFetchUrl(url);
      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return NextResponse.json({ error: "BLS API returned an error." }, { status: 502 });
      }

      const json = await res.json();
      if (json.status !== "REQUEST_SUCCEEDED" || !json.Results?.series) {
        return NextResponse.json(
          { error: json.message?.[0] || "BLS LAUS data not available." },
          { status: 404 }
        );
      }

      for (const s of json.Results.series) {
        seriesData[s.seriesID] = s.data || [];
      }
    } catch (err) {
      console.error("BLS LAUS fetch error:", err);
      return NextResponse.json({ error: "Failed to fetch BLS LAUS data." }, { status: 502 });
    }

    // Parse the data — BLS returns newest first
    const rateData = seriesData[rateSeries] || [];
    const lfData = seriesData[lfSeries] || [];
    const empData = seriesData[empSeries] || [];
    const unempData = seriesData[unempSeries] || [];

    const latestRate = rateData[0];
    const latestLf = lfData[0];
    const latestEmp = empData[0];
    const latestUnemp = unempData[0];

    const parseVal = (v: string | undefined) => {
      if (!v) return null;
      const n = parseFloat(v.replace(/,/g, ""));
      return isNaN(n) ? null : n;
    };

    const monthLabel = (d: { year: string; period: string }) =>
      `${d.year}-${d.period.replace("M", "")}`;

    // Build 12-month trend
    const trend = rateData
      .slice(0, 13)
      .reverse()
      .map((d) => ({
        month: monthLabel(d),
        rate: parseFloat(d.value) || 0,
      }));

    // YoY rate change
    const currentRate = parseVal(latestRate?.value);
    const yearAgoRate = rateData.length >= 13 ? parseVal(rateData[12]?.value) : null;
    const yoyChange = currentRate != null && yearAgoRate != null
      ? Math.round((currentRate - yearAgoRate) * 10) / 10
      : null;

    const result: LausData = {
      county_fips: fips5,
      latest_month: latestRate ? monthLabel(latestRate) : "N/A",
      unemployment_rate: currentRate,
      labor_force: parseVal(latestLf?.value),
      employed: parseVal(latestEmp?.value),
      unemployed: parseVal(latestUnemp?.value),
      trend,
      yoy_rate_change: yoyChange,
    };

    // Merge into location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(params.id, radiusMiles);
    if (existing) {
      const data = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data || {};
      // LAUS is more current than Census — overlay
      if (currentRate != null) data.unemployment_rate = currentRate;
      if (result.labor_force != null) data.labor_force = result.labor_force;
      if (result.employed != null) data.total_employed = result.employed;
      data.laus_month = result.latest_month;
      data.laus_trend = trend;
      data.unemployment_yoy_change = yoyChange;

      const projections = typeof existing.projections === "string" ? JSON.parse(existing.projections) : existing.projections || {};

      await locationIntelligenceQueries.upsert(
        params.id, existing.id, radiusMiles, data, projections,
        "mixed", existing.source_year,
        `${existing.source_notes || ""}; BLS LAUS ${result.latest_month} (county ${fips5})`
      );
    }

    return NextResponse.json({
      data: result,
      meta: {
        source: "BLS Local Area Unemployment Statistics",
        month: result.latest_month,
        note: `Monthly unemployment data for county FIPS ${fips5}. Rate: ${currentRate ?? "N/A"}% (${result.latest_month}).`,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/location-intelligence/fetch-laus error:", error);
    return NextResponse.json({ error: "Failed to fetch LAUS data" }, { status: 500 });
  }
}
