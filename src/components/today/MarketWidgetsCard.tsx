"use client";

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";

interface Series {
  series_id: string;
  label: string;
  observations: Array<{ date: string; value: number }>;
  latest: { date: string; value: number } | null;
  change_1d: number | null;
  change_30d: number | null;
}

interface MarketData {
  treasury_10y: Series | null;
  treasury_2y: Series | null;
  sp500: Series | null;
  mortgage_30y: Series | null;
  fred_configured: boolean;
}

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
    <div className="border border-border/40 rounded-lg bg-card/60 backdrop-blur-sm p-3 min-h-[180px]">
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
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Metric series={data.treasury_10y} suffix="%" />
          <Metric series={data.treasury_2y} suffix="%" />
          <Metric series={data.sp500} />
          <Metric series={data.mortgage_30y} suffix="%" />
        </div>
      )}
    </div>
  );
}

function Metric({
  series,
  suffix = "",
}: {
  series: Series | null;
  suffix?: string;
}) {
  if (!series || !series.latest) {
    return (
      <div className="bg-muted/20 rounded-md p-2">
        <div className="text-[9px] text-muted-foreground uppercase tracking-wide">
          —
        </div>
      </div>
    );
  }

  const change = series.change_30d ?? 0;
  const up = change > 0;
  const flat = change === 0;

  return (
    <div className="bg-muted/20 rounded-md p-2 relative overflow-hidden">
      {/* Sparkline background */}
      <Sparkline points={series.observations.slice(-30).map((o) => o.value)} />
      <div className="relative">
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
          {flat ? (
            <Minus className="h-2.5 w-2.5" />
          ) : up ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" />
          )}
          {change > 0 ? "+" : ""}
          {formatValue(change, suffix)} 30d
        </div>
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
        stroke={up ? "currentColor" : "currentColor"}
        strokeWidth="1.5"
        className={up ? "text-emerald-400" : "text-red-400"}
      />
    </svg>
  );
}
