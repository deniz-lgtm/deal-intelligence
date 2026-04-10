import { NextResponse } from "next/server";
import { getFredSeries, FRED_SERIES } from "@/lib/fred";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/market-data
 *
 * Returns a snapshot of macro series used in the Today-strip market widgets
 * (10Y Treasury, 5Y Treasury, S&P 500, 30Y Mortgage). Data is fetched from
 * FRED — free, public, and on the server-side fetch allowlist.
 *
 * We fetch ~400 days so the client can compute 1D/1W/1M/3M/1Y deltas without
 * re-hitting the API when the user switches range.
 *
 * If FRED_API_KEY is not configured the endpoint still succeeds but returns
 * empty series so the UI degrades gracefully.
 */
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const fredConfigured = Boolean(process.env.FRED_API_KEY);

    // If FRED isn't configured, return early with a clear diagnostic
    if (!fredConfigured) {
      return NextResponse.json({
        data: {
          treasury_10y: null,
          treasury_5y: null,
          sp500: null,
          mortgage_30y: null,
          fred_configured: false,
        },
      });
    }

    // Fetch ~13 months so 1Y lookback always has enough headroom for
    // weekends/holidays and series that publish on a lag (e.g. MORTGAGE30US
    // is weekly).
    const DAYS = 400;

    const [treasury10y, treasury5y, sp500, mortgage] = await Promise.all([
      getFredSeries(FRED_SERIES.TREASURY_10Y.id, FRED_SERIES.TREASURY_10Y.label, DAYS),
      getFredSeries(FRED_SERIES.TREASURY_5Y.id, FRED_SERIES.TREASURY_5Y.label, DAYS),
      getFredSeries(FRED_SERIES.SP500.id, FRED_SERIES.SP500.label, DAYS),
      getFredSeries(FRED_SERIES.MORTGAGE_30Y.id, FRED_SERIES.MORTGAGE_30Y.label, DAYS),
    ]);

    // Count how many series actually loaded
    const loaded = [treasury10y, treasury5y, sp500, mortgage].filter(Boolean).length;

    return NextResponse.json({
      data: {
        treasury_10y: treasury10y,
        treasury_5y: treasury5y,
        sp500,
        mortgage_30y: mortgage,
        fred_configured: true,
        series_loaded: loaded,
      },
    });
  } catch (error) {
    console.error("GET /api/workspace/market-data error:", error);
    return NextResponse.json(
      { error: "Failed to fetch market data" },
      { status: 500 }
    );
  }
}
