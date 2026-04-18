import { NextRequest, NextResponse } from "next/server";
import { locationIntelligenceQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getFredSeries } from "@/lib/fred";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── FHFA House Price Index via FRED ──────────────────────────────────────────
//
// The Federal Housing Finance Agency publishes quarterly House Price Indexes
// by MSA and state. These are available through the FRED API which we already
// have integrated. More current than Census ACS median home values (~1 quarter
// lag vs 1-2 year lag).
//
// Series ID patterns:
//   - National:  USSTHPI
//   - State:     {ST}STHPI  (e.g., CASTHPI for California)
//   - MSA:       ATNHPIUS{CBSA_CODE}A  (e.g., ATNHPIUS31080A for LA)
//
// We fetch the state-level HPI since MSA codes require a lookup table.
// The index shows relative appreciation — we compute YoY and 5-year growth.

// State abbreviation → FRED HPI series ID
function stateHpiSeriesId(stateAbbr: string): string {
  return `${stateAbbr.toUpperCase()}STHPI`;
}

interface HpiResult {
  state: string;
  series_id: string;
  current_index: number | null;
  current_date: string | null;
  yoy_change_pct: number | null;       // year-over-year %
  five_year_change_pct: number | null;  // 5-year cumulative %
  annual_5yr_avg_pct: number | null;    // annualized 5-year %
  // Recent trend (last 4 quarters)
  quarterly_values: Array<{ date: string; value: number }>;
}

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
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!deal.state) {
      return NextResponse.json(
        { error: "Deal has no state set. Update the deal address first." },
        { status: 400 }
      );
    }

    // Map state name to abbreviation if needed
    const stateAbbr = deal.state.length === 2
      ? deal.state
      : STATE_ABBREVS[deal.state.toLowerCase()] || deal.state;

    const seriesId = stateHpiSeriesId(stateAbbr);

    // Fetch 6 years of data so we can compute 5-year growth + YoY
    const series = await getFredSeries(seriesId, `${stateAbbr} HPI`, 365 * 6);

    if (!series || !series.latest) {
      return NextResponse.json(
        {
          error: `FHFA House Price Index not available for ${stateAbbr}. Make sure FRED_API_KEY is configured.`,
        },
        { status: 404 }
      );
    }

    const obs = series.observations;
    const latest = obs[obs.length - 1];

    // Find value from ~1 year ago and ~5 years ago
    const oneYearAgo = findClosestObs(obs, 365);
    const fiveYearsAgo = findClosestObs(obs, 365 * 5);

    const yoyPct = oneYearAgo
      ? Math.round(((latest.value - oneYearAgo.value) / oneYearAgo.value) * 1000) / 10
      : null;

    const fiveYrPct = fiveYearsAgo
      ? Math.round(((latest.value - fiveYearsAgo.value) / fiveYearsAgo.value) * 1000) / 10
      : null;

    const annualized5yr = fiveYrPct != null ? Math.round((fiveYrPct / 5) * 10) / 10 : null;

    // Last 4 quarters for sparkline
    const quarterly = obs.slice(-8).filter((_, i) => i % 2 === 0).slice(-4);

    const result: HpiResult = {
      state: stateAbbr,
      series_id: seriesId,
      current_index: latest.value,
      current_date: latest.date,
      yoy_change_pct: yoyPct,
      five_year_change_pct: fiveYrPct,
      annual_5yr_avg_pct: annualized5yr,
      quarterly_values: quarterly,
    };

    // Merge HPI growth into existing location intelligence
    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      radiusMiles
    );

    if (existing) {
      const data =
        typeof existing.data === "string"
          ? JSON.parse(existing.data)
          : existing.data || {};

      // Update home value growth with FHFA data (more current than Census)
      data.home_value_growth_pct = yoyPct;
      data.hpi_index = latest.value;
      data.hpi_date = latest.date;
      data.hpi_5yr_pct = fiveYrPct;

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
        `${existing.source_notes || ""}; FHFA HPI ${stateAbbr} (${latest.date})`
      );
    }

    return NextResponse.json({
      data: result,
      meta: {
        source: "FHFA House Price Index (via FRED)",
        state: stateAbbr,
        series_id: seriesId,
        note: `State-level house price index for ${stateAbbr}. YoY: ${yoyPct ?? "N/A"}%, 5yr annualized: ${annualized5yr ?? "N/A"}%.`,
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/location-intelligence/fetch-hpi error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch HPI data" },
      { status: 500 }
    );
  }
}

function findClosestObs(
  obs: Array<{ date: string; value: number }>,
  daysAgo: number
): { date: string; value: number } | null {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  const targetTime = target.getTime();

  let closest: { date: string; value: number } | null = null;
  let closestDiff = Infinity;

  for (const o of obs) {
    const diff = Math.abs(new Date(o.date).getTime() - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = o;
    }
  }
  return closest;
}

// Common state name → abbreviation map
const STATE_ABBREVS: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
