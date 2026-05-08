"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface RollupRow {
  deal_id: string;
  deal_name: string;
  total_budget: number;
  total_eac: number;
  total_incurred: number;
  variance: number;
  line_count: number;
}

const tone = (variance: number, budget: number) => {
  if (budget <= 0) return "text-muted-foreground";
  const pct = (variance / budget) * 100;
  if (pct > 5) return "text-red-400";
  if (pct > 0) return "text-amber-400";
  if (pct < 0) return "text-emerald-400";
  return "text-muted-foreground";
};

export function VarianceRollup() {
  const [rows, setRows] = useState<RollupRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/construction/variance-rollup");
        const j = await res.json();
        if (!cancelled) setRows(j.data || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="h-32 rounded-xl border border-border/30 bg-card/30 animate-pulse" />;
  }

  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (a, r) => ({
      budget: a.budget + Number(r.total_budget),
      eac: a.eac + Number(r.total_eac),
      incurred: a.incurred + Number(r.total_incurred),
      variance: a.variance + Number(r.variance),
    }),
    { budget: 0, eac: 0, incurred: 0, variance: 0 }
  );
  const totalVariancePct = totals.budget > 0 ? (totals.variance / totals.budget) * 100 : 0;

  return (
    <section className="rounded-xl border border-border/40 bg-card/40 mb-6">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" style={{ color: "hsl(var(--phase-con))" }} />
          <span className="font-medium text-sm">Portfolio Hard-Cost Variance</span>
          <span className="text-2xs text-muted-foreground">{rows.length} project{rows.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-4 text-xs tabular-nums">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Budget</span>
            <span className="font-medium">{formatCurrency(totals.budget)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">EAC</span>
            <span className="font-medium">{formatCurrency(totals.eac)}</span>
          </div>
          <div className={cn("flex items-center gap-1.5 font-medium", tone(totals.variance, totals.budget))}>
            <span>Variance</span>
            <span>
              {totals.variance >= 0 ? "+" : ""}{formatCurrency(totals.variance)}
              <span className="text-2xs ml-1">({totalVariancePct >= 0 ? "+" : ""}{totalVariancePct.toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      </header>

      <div className="divide-y divide-border/20">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-2xs uppercase tracking-wider text-muted-foreground/70">
          <div className="col-span-5">Project</div>
          <div className="col-span-2 text-right">Budget</div>
          <div className="col-span-2 text-right">Incurred</div>
          <div className="col-span-2 text-right">EAC</div>
          <div className="col-span-1 text-right">Variance</div>
        </div>
        {rows.map((r) => {
          const variancePct = Number(r.total_budget) > 0 ? (Number(r.variance) / Number(r.total_budget)) * 100 : 0;
          const t = tone(Number(r.variance), Number(r.total_budget));
          const Icon = Number(r.variance) > 0 ? TrendingUp : Number(r.variance) < 0 ? TrendingDown : Minus;
          return (
            <Link
              key={r.deal_id}
              href={`/deals/${r.deal_id}/construction/budget`}
              className="grid grid-cols-12 gap-2 px-4 py-2.5 text-xs items-center hover:bg-muted/20 transition-colors"
            >
              <div className="col-span-5 truncate font-medium">{r.deal_name}</div>
              <div className="col-span-2 text-right tabular-nums text-muted-foreground">{formatCurrency(Number(r.total_budget))}</div>
              <div className="col-span-2 text-right tabular-nums text-muted-foreground">{formatCurrency(Number(r.total_incurred))}</div>
              <div className="col-span-2 text-right tabular-nums">{formatCurrency(Number(r.total_eac))}</div>
              <div className={cn("col-span-1 text-right tabular-nums font-medium flex items-center justify-end gap-1", t)}>
                <Icon className="h-3 w-3" />
                <span>{variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
