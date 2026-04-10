// FRED (Federal Reserve Economic Data) client.
//
// Used to pull macro data for the Today-strip market widgets (Treasury 10Y,
// S&P 500, etc.). FRED is a free, public-data source hosted by the St. Louis
// Fed and explicitly on our server-side fetch allowlist — see
// src/lib/web-allowlist.ts for the rationale.
//
// API docs: https://fred.stlouisfed.org/docs/api/fred/
//
// This client requires the FRED_API_KEY env var. If it's missing, every call
// returns null so the UI can degrade gracefully to "market data unavailable"
// instead of erroring out.

import { assertAllowedFetchUrl } from "./web-allowlist";

export interface FredObservation {
  date: string;   // YYYY-MM-DD
  value: number;  // null-safe: missing/NA observations are skipped
}

export interface FredSeries {
  series_id: string;
  label: string;
  observations: FredObservation[];
  latest: { date: string; value: number } | null;
  change_1d: number | null;    // delta from latest to previous observation
  change_30d: number | null;   // delta from latest to value 30 days ago
}

// In-memory cache — FRED data doesn't change intraday for our purposes
interface CacheEntry {
  data: FredSeries;
  expires: number;
}
const _cache: Record<string, CacheEntry> = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch a series from FRED. Returns null if the API key isn't configured,
 * the fetch fails, or the response is malformed.
 *
 * @param seriesId FRED series ID (e.g. "DGS10", "SP500", "MORTGAGE30US")
 * @param label    Human-readable label for the UI
 * @param days     Number of days of history to return (default 90)
 */
export async function getFredSeries(
  seriesId: string,
  label: string,
  days = 90
): Promise<FredSeries | null> {
  const cacheKey = `${seriesId}:${days}`;
  const cached = _cache[cacheKey];
  if (cached && cached.expires > Date.now()) return cached.data;

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.warn("FRED_API_KEY not set — market data unavailable");
    return null;
  }

  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().slice(0, 10);

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${apiKey}&file_type=json&observation_start=${startStr}&sort_order=asc`;

  // Defensive: run through the allowlist even though FRED is expected to pass
  try {
    assertAllowedFetchUrl(url);
  } catch (err) {
    console.error("FRED URL rejected by allowlist:", err);
    return null;
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`FRED fetch failed (${seriesId}): HTTP ${res.status} — ${body.slice(0, 200)}`);
      return null;
    }
    const json = (await res.json()) as {
      observations?: Array<{ date: string; value: string }>;
    };

    const observations: FredObservation[] = (json.observations || [])
      .filter((o) => o.value !== "." && o.value !== "")
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .filter((o) => Number.isFinite(o.value));

    if (observations.length === 0) return null;

    const latest = observations[observations.length - 1];
    const previous =
      observations.length >= 2 ? observations[observations.length - 2] : null;
    const thirtyDaysAgoIdx = Math.max(0, observations.length - 30);
    const thirtyDaysAgo = observations[thirtyDaysAgoIdx];

    const series: FredSeries = {
      series_id: seriesId,
      label,
      observations,
      latest: { date: latest.date, value: latest.value },
      change_1d: previous ? latest.value - previous.value : null,
      change_30d: thirtyDaysAgo ? latest.value - thirtyDaysAgo.value : null,
    };

    _cache[cacheKey] = { data: series, expires: Date.now() + CACHE_TTL_MS };
    return series;
  } catch (err) {
    console.error(`FRED fetch error (${seriesId}):`, err);
    return null;
  }
}

/** Commonly-used FRED series for CRE underwriters. */
export const FRED_SERIES = {
  TREASURY_10Y: { id: "DGS10", label: "10Y Treasury Yield" },
  TREASURY_2Y: { id: "DGS2", label: "2Y Treasury Yield" },
  SOFR: { id: "SOFR", label: "SOFR" },
  MORTGAGE_30Y: { id: "MORTGAGE30US", label: "30Y Mortgage Rate" },
  SP500: { id: "SP500", label: "S&P 500" },
  FED_FUNDS: { id: "FEDFUNDS", label: "Fed Funds Rate" },
} as const;
