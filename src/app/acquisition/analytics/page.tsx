"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Clock, Skull, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_LABELS } from "@/lib/types";

interface Analytics {
  window_months: number;
  funnel: { status: string; count: number }[];
  conversions: { from: string; to: string; pct: number | null }[];
  time_in_stage: { status: string; median_days: number; samples: number }[];
  dead_reasons: { reason: string; count: number }[];
  sourced_trend: { week: string; count: number }[];
}

const WINDOWS = [3, 6, 12, 24] as const;

const REASON_LABEL: Record<string, string> = {
  pricing: "Pricing",
  physical: "Physical",
  market: "Market",
  legal_zoning: "Legal / Zoning",
  process: "Process",
  lost_to_competitor: "Lost to competitor",
  other: "Other",
  unspecified: "Unspecified",
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [months, setMonths] = useState<number>(12);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/acquisition/analytics?months=${months}`);
        const j = await res.json();
        if (!cancelled) setData(j.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [months]);

  const maxFunnel = data ? Math.max(1, ...data.funnel.map((f) => f.count)) : 1;
  const maxTrend = data ? Math.max(1, ...data.sourced_trend.map((t) => t.count)) : 1;
  const totalDead = data ? data.dead_reasons.reduce((s, r) => s + r.count, 0) : 0;

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <header className="border-b border-border/40 px-6 sm:px-8 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/acquisition" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <BarChart3 className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl">Pipeline Analytics</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Window:</span>
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setMonths(w)}
                className={cn(
                  "px-2.5 py-1 rounded-md border tabular-nums",
                  months === w ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30"
                )}
              >
                {w}m
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 sm:px-8 py-8 space-y-6">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-64 rounded-xl border border-border/30 bg-card/30 animate-pulse" />
              ))}
            </div>
          ) : !data ? (
            <p className="text-muted-foreground text-sm">No data.</p>
          ) : (
            <>
              {/* Funnel */}
              <section className="rounded-xl border border-border/40 bg-card/40 p-5">
                <header className="flex items-center gap-2 mb-4">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">Conversion Funnel</h2>
                  <span className="text-2xs text-muted-foreground ml-auto">deals that ever reached each stage in window</span>
                </header>
                <div className="space-y-2">
                  {data.funnel.map((f, i) => {
                    const conv = data.conversions[i - 1];
                    const widthPct = (f.count / maxFunnel) * 100;
                    return (
                      <div key={f.status} className="grid grid-cols-12 gap-3 items-center text-xs">
                        <div className="col-span-3 truncate">{DEAL_STAGE_LABELS[f.status as keyof typeof DEAL_STAGE_LABELS] || f.status}</div>
                        <div className="col-span-7">
                          <div className="h-5 rounded bg-muted/20 overflow-hidden">
                            <div
                              className="h-full gradient-gold transition-all"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </div>
                        <div className="col-span-1 tabular-nums text-right">{f.count}</div>
                        <div className="col-span-1 tabular-nums text-right text-muted-foreground">
                          {conv && conv.pct !== null ? `${conv.pct.toFixed(0)}%` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Time in stage */}
                <section className="rounded-xl border border-border/40 bg-card/40 p-5">
                  <header className="flex items-center gap-2 mb-4">
                    <Clock className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-medium">Median Time in Stage</h2>
                  </header>
                  {data.time_in_stage.every((t) => t.samples === 0) ? (
                    <p className="text-xs text-muted-foreground italic py-4">
                      Not enough completed transitions yet to compute median time.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.time_in_stage.map((t) => {
                        const max = Math.max(1, ...data.time_in_stage.map((x) => x.median_days));
                        const widthPct = (t.median_days / max) * 100;
                        return (
                          <div key={t.status} className="grid grid-cols-12 gap-3 items-center text-xs">
                            <div className="col-span-4 truncate">
                              {DEAL_STAGE_LABELS[t.status as keyof typeof DEAL_STAGE_LABELS] || t.status}
                            </div>
                            <div className="col-span-6">
                              <div className="h-4 rounded bg-muted/20 overflow-hidden">
                                <div className="h-full bg-blue-400/70" style={{ width: `${widthPct}%` }} />
                              </div>
                            </div>
                            <div className="col-span-1 tabular-nums text-right">{t.median_days}d</div>
                            <div className="col-span-1 tabular-nums text-right text-muted-foreground text-2xs">
                              n={t.samples}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Dead reasons */}
                <section className="rounded-xl border border-border/40 bg-card/40 p-5">
                  <header className="flex items-center gap-2 mb-4">
                    <Skull className="h-4 w-4 text-red-400" />
                    <h2 className="text-sm font-medium">Dead Deals — Reasons</h2>
                    <span className="ml-auto text-2xs text-muted-foreground tabular-nums">{totalDead} total</span>
                  </header>
                  {totalDead === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-4">No dead deals in window.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.dead_reasons.map((r) => {
                        const widthPct = (r.count / Math.max(1, ...data.dead_reasons.map((x) => x.count))) * 100;
                        return (
                          <div key={r.reason} className="grid grid-cols-12 gap-3 items-center text-xs">
                            <div className="col-span-4 truncate text-muted-foreground">
                              {REASON_LABEL[r.reason] || r.reason}
                            </div>
                            <div className="col-span-6">
                              <div className="h-4 rounded bg-muted/20 overflow-hidden">
                                <div className="h-full bg-red-400/60" style={{ width: `${widthPct}%` }} />
                              </div>
                            </div>
                            <div className="col-span-1 tabular-nums text-right">{r.count}</div>
                            <div className="col-span-1 tabular-nums text-right text-muted-foreground text-2xs">
                              {totalDead > 0 ? `${Math.round((r.count / totalDead) * 100)}%` : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              {/* Sourcing trend */}
              <section className="rounded-xl border border-border/40 bg-card/40 p-5">
                <header className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">Sourcing — Deals Created per Week</h2>
                </header>
                {data.sourced_trend.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-4">No deals sourced in window.</p>
                ) : (
                  <div className="flex items-end gap-1 h-32 px-1">
                    {data.sourced_trend.map((t, i) => {
                      const heightPct = (t.count / maxTrend) * 100;
                      const date = new Date(t.week);
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                          <span className="text-2xs tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">{t.count}</span>
                          <div
                            className="w-full bg-primary/30 group-hover:bg-primary/60 rounded-t transition-colors"
                            style={{ height: `${heightPct}%`, minHeight: t.count > 0 ? "2px" : "0" }}
                            title={`${date.toLocaleDateString()} — ${t.count} deal${t.count !== 1 ? "s" : ""}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </AppShell>
  );
}
