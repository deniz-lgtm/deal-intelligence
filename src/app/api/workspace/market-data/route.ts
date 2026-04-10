import { NextResponse } from "next/server";
import { getFredSeries, FRED_SERIES } from "@/lib/fred";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/market-data
 *
 * Returns a snapshot of macro series used in the Today-strip market widgets
 * (10Y Treasury, 2Y Treasury, S&P 500, 30Y Mortgage). Data is fetched from
 * FRED — free, public, and on the server-side fetch allowlist.
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
          treasury_2y: null,
          sp500: null,
          mortgage_30y: null,
          fred_configured: false,
        },
      });
    }

    const [treasury10y, treasury2y, sp500, mortgage] = await Promise.all([
      getFredSeries(FRED_SERIES.TREASURY_10Y.id, FRED_SERIES.TREASURY_10Y.label, 90),
      getFredSeries(FRED_SERIES.TREASURY_2Y.id, FRED_SERIES.TREASURY_2Y.label, 90),
      getFredSeries(FRED_SERIES.SP500.id, FRED_SERIES.SP500.label, 90),
      getFredSeries(FRED_SERIES.MORTGAGE_30Y.id, FRED_SERIES.MORTGAGE_30Y.label, 90),
    ]);

    // Count how many series actually loaded
    const loaded = [treasury10y, treasury2y, sp500, mortgage].filter(Boolean).length;

    return NextResponse.json({
      data: {
        treasury_10y: treasury10y,
        treasury_2y: treasury2y,
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
