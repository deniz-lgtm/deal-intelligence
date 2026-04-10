"use client";

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";

interface Observation {
  date: string;
  value: number;
}

interface Series {
  series_id: string;
  label: string;
  observations: Observation[];
  latest: { date: string; value: number } | null;
  change_1d: number | null;
  change_30d: number | null;
}

interface MarketData {
  treasury_10y: Series | null;
  treasury_5y: Series | null;
  sp500: Series | null;
  mortgage_30y: Series | null;
  fred_configured: boolean;
}

type Range = "1D" | "1W" | "1M" | "3M" | "1Y";

const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y"];

const RANGE_DAYS: Record<Range, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

export function MarketWidgetsCard() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/workspace/market-data")
      .then((r) => r.json())
      .then((j) => setData(j.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="border border-border/40 rounded-lg bg-card/60 backdrop-blur-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Market</span>
        </div>
        <span className="text-[10px] text-muted-foreground">FRED</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <div className="text-[11px] text-muted-foreground py-6 text-center">
          Market data unavailable.
        </div>
      ) : !data.fred_configured ? (
        <div className="text-[11px] text-muted-foreground py-4 text-center">
          Set <code className="text-[10px] bg-muted/30 px-1 rounded">FRED_API_KEY</code>{" "}
          to enable market widgets.
          <div className="text-[10px] mt-1 opacity-70">
            Free key: fred.stlouisfed.org/docs/api/api_key.html
          </div>
        </div>
      ) : !data.treasury_10y && !data.treasury_5y && !data.sp500 && !data.mortgage_30y ? (
        <div className="text-[11px] text-muted-foreground py-4 text-center">
          FRED API key is configured but data failed to load. This
          may be a temporary outage or network issue — try reloading.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Metric series={data.treasury_10y} suffix="%" />
          <Metric series={data.treasury_5y} suffix="%" />
          <Metric series={data.sp500} />
          <Metric series={data.mortgage_30y} suffix="%" />
        </div>
      )}
    </div>
  );
}

/**
 * Find the observation at or before `daysAgo` days from the latest observation.
 * Returns null if we don't have enough history.
 */
function findPastObservation(
  observations: Observation[],
  daysAgo: number
): Observation | null {
  if (observations.length < 2) return null;

  // 1D special case — just the previous observation, whatever the calendar gap
  if (daysAgo <= 1) {
    return observations[observations.length - 2];
  }

  const latest = observations[observations.length - 1];
  const latestMs = new Date(latest.date).getTime();
  const targetMs = latestMs - daysAgo * 24 * 60 * 60 * 1000;

  // Walk backwards to find the last observation on or before the target
  for (let i = observations.length - 1; i >= 0; i--) {
    const obsMs = new Date(observations[i].date).getTime();
    if (obsMs <= targetMs) return observations[i];
  }
  return null;
}

/** Slice observations to roughly the last N days for the sparkline. */
function sliceForRange(observations: Observation[], range: Range): Observation[] {
  if (observations.length < 2) return observations;

  if (range === "1D") {
    // Just the last 2 points — not enough to show a meaningful line, but we
    // render it anyway so the sparkline doesn't disappear.
    return observations.slice(-2);
  }

  const days = RANGE_DAYS[range];
  const latestMs = new Date(observations[observations.length - 1].date).getTime();
  const cutoffMs = latestMs - days * 24 * 60 * 60 * 1000;

  const startIdx = observations.findIndex(
    (o) => new Date(o.date).getTime() >= cutoffMs
  );
  return startIdx === -1 ? observations : observations.slice(startIdx);
}

function Metric({
  series,
  suffix = "",
}: {
  series: Series | null;
  suffix?: string;
}) {
  const [range, setRange] = useState<Range>("1M");

  if (!series || !series.latest) {
    return (
      <div className="bg-muted/20 rounded-md p-2 min-h-[92px]">
        <div className="text-[9px] text-muted-foreground uppercase tracking-wide">
          —
        </div>
      </div>
    );
  }

  const past = findPastObservation(series.observations, RANGE_DAYS[range]);
  const change = past ? series.latest.value - past.value : null;
  const sparkPoints = sliceForRange(series.observations, range).map((o) => o.value);

  const up = (change ?? 0) > 0;
  const flat = change === 0 || change === null;

  return (
    <div className="bg-muted/20 rounded-md p-2 relative overflow-hidden min-h-[92px] flex flex-col">
      {/* Sparkline background */}
      <Sparkline points={sparkPoints} />
      <div className="relative flex-1">
        <div className="text-[9px] text-muted-foreground uppercase tracking-wide truncate">
          {series.label}
        </div>
        <div className="text-sm font-semibold text-foreground">
          {formatValue(series.latest.value, suffix)}
        </div>
        <div
          className={`text-[9px] flex items-center gap-0.5 ${
            flat
              ? "text-muted-foreground"
              : up
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {flat || change === null ? (
            <Minus className="h-2.5 w-2.5" />
          ) : up ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" />
          )}
          {change === null ? (
            <span>no {range} data</span>
          ) : (
            <>
              {change > 0 ? "+" : ""}
              {formatValue(change, suffix)} {range}
            </>
          )}
        </div>
      </div>

      {/* Range selector */}
      <div className="relative mt-1.5 flex items-center gap-0.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`text-[8px] font-medium px-1 py-0.5 rounded transition-colors ${
              range === r
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatValue(v: number, suffix: string): string {
  if (suffix === "%") return v.toFixed(2) + "%";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

// Minimal inline sparkline — pure SVG, no deps.
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const W = 100;
  const H = 40;
  const step = W / (points.length - 1);

  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = H - ((v - min) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const up = points[points.length - 1] >= points[0];

  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-20"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={up ? "text-emerald-400" : "text-red-400"}
      />
    </svg>
  );
}
