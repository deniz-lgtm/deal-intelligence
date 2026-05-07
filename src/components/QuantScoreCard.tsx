"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Mirror of FactorBreakdown / McDistribution from src/lib/quant-score —
// imported as values would force a server module into the client bundle, so
// we re-declare the shapes here.
interface CategoryResult {
  category: string;
  score: number;
  confidence: number;
  notched: boolean;
  inputs: Array<{
    id: string;
    label: string;
    stage: string;
    raw: number | string | null;
    score: number | null;
    weight: number;
    fatalFlaw?: boolean;
    source?: string;
  }>;
}

interface FactorBreakdown {
  composite: number;
  band: "institutional" | "actionable" | "marginal" | "pass";
  confidence: number;
  categories: CategoryResult[];
  weights: Record<string, number>;
  strategy: string | null;
  algorithmVersion: string;
}

interface McDistribution {
  trials: number;
  irr: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; std: number };
  em: { p10: number; p50: number; p90: number; mean: number };
  prob_hit_target_irr: number | null;
  prob_capital_loss: number;
  prob_refi_failure: number | null;
  expected_shortfall_5pct: number;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  risk_free_pct: number;
  sortino_target_pct: number;
  inputs_distribution_summary: Record<string, { mu: number; sigma: number; bounds?: [number, number]; kind: string }>;
  correlation_matrix_version: string;
  rng_seed: number;
}

interface ScoreNarrative {
  strengths: string[];
  weaknesses: string[];
  generated_at: string;
}

interface QuantScoreRow {
  id: string;
  stage: "om" | "uw" | "final";
  composite: number;
  confidence: number;
  band: string;
  factor_breakdown: FactorBreakdown;
  mc_distribution: McDistribution | null;
  narrative: ScoreNarrative | null;
  algorithm_version: string;
  mc_version: string | null;
  computed_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  return: "Return",
  capstack: "Capital Stack",
  construction: "Construction",
  leaseup: "Lease-Up",
  market: "Market",
  physical: "Physical",
  exit: "Exit",
  sponsor: "Sponsor",
  macro: "Macro",
  regulatory: "Regulatory",
};

const BAND_STYLES: Record<string, { label: string; cls: string }> = {
  institutional: { label: "Institutional", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  actionable: { label: "Actionable", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  marginal: { label: "Marginal", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  pass: { label: "Pass", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

interface Props {
  dealId: string;
  initialStage?: "om" | "uw" | "final";
}

export function QuantScoreCard({ dealId, initialStage = "uw" }: Props) {
  const [stage, setStage] = useState<"om" | "uw" | "final">(initialStage);
  const [row, setRow] = useState<QuantScoreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLatest = useCallback(
    async (s: "om" | "uw" | "final") => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/quant-score?stage=${s}`);
        const json = await res.json();
        setRow(json.data ?? null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [dealId]
  );

  useEffect(() => {
    void fetchLatest(stage);
  }, [stage, fetchLatest]);

  const recompute = async () => {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/quant-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "recompute failed");
      setRow(json.data ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecomputing(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Deal Score
            <ScoreInfoButton mc={row?.mc_distribution} algorithmVersion={row?.algorithm_version} />
            {row?.factor_breakdown.strategy && (
              <Badge variant="outline" className="text-2xs font-normal">
                {row.factor_breakdown.strategy.replace(/_/g, " ")}
              </Badge>
            )}
          </CardTitle>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {row?.algorithm_version || "—"} · multi-factor + Monte Carlo
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-px rounded-md overflow-hidden border border-border/60 bg-card">
            {(["om", "uw", "final"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={cn(
                  "text-2xs px-2 py-1 uppercase tracking-wide",
                  s === stage
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/40"
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={recompute} disabled={recomputing}>
            {recomputing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-2xs text-rose-400">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        {!row ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No score for this stage yet.{" "}
            <button onClick={recompute} className="text-primary underline hover:opacity-80">
              Run recompute
            </button>
            .
          </div>
        ) : (
          <>
            <CompositeHeader breakdown={row.factor_breakdown} />
            <CategoryBars breakdown={row.factor_breakdown} />
            {row.mc_distribution && <McSection mc={row.mc_distribution} />}
            {row.narrative && (row.narrative.strengths.length > 0 || row.narrative.weaknesses.length > 0) && (
              <NarrativeSection narrative={row.narrative} />
            )}
            <p className="text-2xs text-muted-foreground/70 text-right">
              Last computed {row.computed_at ? new Date(row.computed_at).toLocaleString() : "—"}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreInfoButton({
  mc,
  algorithmVersion,
}: {
  mc: McDistribution | null | undefined;
  algorithmVersion: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="What is the deal score?"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <Info className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute left-6 top-0 z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-border/60 bg-popover text-popover-foreground shadow-lifted p-4 text-xs leading-relaxed space-y-2.5"
        >
          <div>
            <p className="font-semibold text-sm">How this score works</p>
            <p className="text-2xs text-muted-foreground mt-0.5">
              Algorithm {algorithmVersion || "—"} · deterministic + Monte Carlo
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Composite (0–100)</p>
            <p className="text-muted-foreground">
              Weighted average of 10 risk categories (return quality, capital stack, construction,
              lease-up, market, physical, exit, sponsor, macro, regulatory). Each category rolls up
              from individual inputs mapped to 0–100 via piecewise thresholds. Category weights come
              from the business plan's strategy. Inputs that hit a single fatal flaw (DSCR &lt; 1.0,
              breakeven occupancy &gt; 95%, critical environmental flag) notch the category by 15.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Bands</p>
            <p className="text-muted-foreground">
              80+ Institutional · 65–80 Actionable · 50–65 Marginal · &lt;50 Pass.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Confidence</p>
            <p className="text-muted-foreground">
              Share of inputs the engine could actually extract (present ÷ total). Missing inputs
              are excluded — never imputed — so an OM-stage 72 isn't the same as a Final-stage 72.
            </p>
          </div>
          {mc && (
            <div>
              <p className="font-medium text-foreground">Monte Carlo</p>
              <p className="text-muted-foreground">
                Runs the underwriting model {mc.trials.toLocaleString()} times with rent growth,
                vacancy, exit cap, and rate sampled from calibrated distributions and correlated
                via Cholesky decomposition. Each trial outputs an IRR/EM; the percentiles
                (P10/P50/P90), Sharpe, Sortino, and probability stats above summarize that
                distribution. Sharpe uses risk-free = {mc.risk_free_pct}%; Sortino uses target =
                {" "}{mc.sortino_target_pct}% and divides by downside-only deviation.
              </p>
            </div>
          )}
          <div>
            <p className="font-medium text-foreground">What Claude does</p>
            <p className="text-muted-foreground">
              Only writes the strengths/weaknesses bullets — grounded in the deterministic numbers.
              Never assigns scores or estimates returns.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CompositeHeader({ breakdown }: { breakdown: FactorBreakdown }) {
  const band = BAND_STYLES[breakdown.band] || BAND_STYLES.marginal;
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-3xl font-bold tabular-nums tracking-tight">
        {breakdown.composite.toFixed(1)}
        <span className="text-sm text-muted-foreground/60 font-normal ml-1">/100</span>
      </div>
      <Badge className={cn("text-2xs border", band.cls)} variant="outline">
        {band.label}
      </Badge>
      <span className="text-2xs text-muted-foreground ml-auto">
        Confidence {(breakdown.confidence * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function CategoryBars({ breakdown }: { breakdown: FactorBreakdown }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {breakdown.categories
        .filter((c) => (breakdown.weights[c.category] ?? 0) > 0)
        .map((c) => (
          <CategoryRow key={c.category} cat={c} weight={breakdown.weights[c.category] ?? 0} />
        ))}
    </div>
  );
}

function CategoryRow({ cat, weight }: { cat: CategoryResult; weight: number }) {
  const present = cat.inputs.filter((i) => i.score != null).length;
  const total = cat.inputs.length;
  const score = cat.score;
  const color =
    score >= 80
      ? "bg-emerald-500"
      : score >= 65
      ? "bg-blue-500"
      : score >= 50
      ? "bg-amber-500"
      : "bg-rose-500";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-2xs">
        <span className="text-muted-foreground">
          {CATEGORY_LABELS[cat.category] || cat.category}
          <span className="text-muted-foreground/50 ml-1">{weight.toFixed(0)}%</span>
        </span>
        <span className="tabular-nums font-medium">
          {cat.confidence > 0 ? score.toFixed(0) : "—"}
          {cat.notched && <span title="Fatal flaw notched" className="text-rose-400 ml-0.5">▼</span>}
          {total > 0 && (
            <span className="text-muted-foreground/50 ml-1 font-normal">
              {present}/{total}
            </span>
          )}
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: cat.confidence > 0 ? `${score}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function McSection({ mc }: { mc: McDistribution }) {
  const sharpeAccent = mc.sharpe_ratio == null ? "muted" : mc.sharpe_ratio >= 0.5 ? "emerald" : "rose";
  const sortinoAccent = mc.sortino_ratio == null ? "muted" : mc.sortino_ratio >= 0.5 ? "emerald" : "rose";
  return (
    <div className="border-t border-border/40 pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold">Monte Carlo Return Distribution</h4>
        <span className="text-2xs text-muted-foreground">{mc.trials.toLocaleString()} trials</span>
      </div>
      <div className="grid grid-cols-4 gap-px bg-border rounded-md overflow-hidden border border-border/60">
        <McStat
          label="P10 IRR"
          value={`${mc.irr.p10.toFixed(1)}%`}
          accent="rose"
          tip={`Worst-decile annualized IRR. 10% of the ${mc.trials.toLocaleString()} simulated trials returned ≤ this number — a realistic downside benchmark.`}
        />
        <McStat
          label="P50 IRR"
          value={`${mc.irr.p50.toFixed(1)}%`}
          accent="emerald"
          highlight
          tip={`Median annualized IRR across ${mc.trials.toLocaleString()} simulated trials. Each trial draws rent growth (μ=${mc.inputs_distribution_summary.rent_growth?.mu}%, σ=${mc.inputs_distribution_summary.rent_growth?.sigma}pp), vacancy (triangular), exit cap (μ=${mc.inputs_distribution_summary.exit_cap?.mu}%, σ=${mc.inputs_distribution_summary.exit_cap?.sigma}pp), and rate (σ=${mc.inputs_distribution_summary.rate?.sigma}pp) — correlated via Cholesky — and re-runs the underwriting model.`}
        />
        <McStat
          label="P90 IRR"
          value={`${mc.irr.p90.toFixed(1)}%`}
          accent="emerald"
          tip="Upside-decile IRR. Only 10% of trials beat this number — the realistic upside ceiling."
        />
        <McStat
          label="P50 EM"
          value={`${mc.em.p50.toFixed(2)}x`}
          accent="blue"
          tip="Median equity multiple (total dollars returned ÷ equity invested) across the simulated trials."
        />
        <McStat
          label="P(loss)"
          value={`${(mc.prob_capital_loss * 100).toFixed(1)}%`}
          accent={mc.prob_capital_loss > 0.1 ? "rose" : "muted"}
          tip="Share of trials where equity multiple finished below 1.0× — the deal lost money on a nominal basis."
        />
        <McStat
          label="P(hit IRR)"
          value={mc.prob_hit_target_irr != null ? `${(mc.prob_hit_target_irr * 100).toFixed(0)}%` : "—"}
          accent="blue"
          tip="Share of trials that cleared the business plan's target IRR. Set the target on the business plan to enable this."
        />
        <McStat
          label="Sharpe"
          value={mc.sharpe_ratio != null ? mc.sharpe_ratio.toFixed(2) : "—"}
          accent={sharpeAccent}
          tip={`Sharpe ratio = (mean IRR − risk-free) / σ(IRR). Risk-free = ${mc.risk_free_pct}% (10yr Treasury proxy). >1 is strong, 0–0.5 is weak. Penalizes both upside and downside variance.`}
        />
        <McStat
          label="Sortino"
          value={mc.sortino_ratio != null ? mc.sortino_ratio.toFixed(2) : "—"}
          accent={sortinoAccent}
          tip={`Sortino ratio = (mean IRR − target) / σ_downside. Target = ${mc.sortino_target_pct}%. Only counts variance from outcomes BELOW the target — a fairer measure for asymmetric, right-skewed real-estate returns.`}
        />
      </div>
      <p className="text-2xs text-muted-foreground/70 mt-1.5">
        Stochastic inputs: rent growth ±{mc.inputs_distribution_summary.rent_growth?.sigma}pp · vacancy
        triangular · exit cap ±{mc.inputs_distribution_summary.exit_cap?.sigma}pp · rate ±
        {mc.inputs_distribution_summary.rate?.sigma}pp.{" "}
        CVaR 5% IRR: {mc.expected_shortfall_5pct.toFixed(1)}%.{" "}
        {mc.prob_refi_failure != null && `Refi failure: ${(mc.prob_refi_failure * 100).toFixed(1)}%.`}
      </p>
    </div>
  );
}

function McStat({
  label,
  value,
  accent,
  highlight,
  tip,
}: {
  label: string;
  value: string;
  accent: "emerald" | "rose" | "blue" | "muted";
  highlight?: boolean;
  tip?: string;
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    blue: "text-blue-300",
    muted: "text-muted-foreground",
  };
  return (
    <div
      className={cn("bg-card p-2", highlight && "bg-muted/20")}
      title={tip}
    >
      <p className="text-2xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {label}
        {tip && <Info className="h-2.5 w-2.5 text-muted-foreground/40" />}
      </p>
      <p className={cn("text-sm font-bold tabular-nums", colors[accent])}>{value}</p>
    </div>
  );
}

function NarrativeSection({ narrative }: { narrative: ScoreNarrative }) {
  return (
    <div className="border-t border-border/40 pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <h5 className="text-2xs uppercase tracking-wide text-emerald-300/80 flex items-center gap-1 mb-1.5">
          <TrendingUp className="h-3 w-3" /> Strengths
        </h5>
        <ul className="space-y-1 text-xs">
          {narrative.strengths.map((s, i) => (
            <li key={i} className="text-foreground/80 leading-snug">
              · {s}
            </li>
          ))}
          {narrative.strengths.length === 0 && (
            <li className="text-2xs text-muted-foreground/60">—</li>
          )}
        </ul>
      </div>
      <div>
        <h5 className="text-2xs uppercase tracking-wide text-rose-300/80 flex items-center gap-1 mb-1.5">
          <TrendingDown className="h-3 w-3" /> Weaknesses
        </h5>
        <ul className="space-y-1 text-xs">
          {narrative.weaknesses.map((s, i) => (
            <li key={i} className="text-foreground/80 leading-snug">
              · {s}
            </li>
          ))}
          {narrative.weaknesses.length === 0 && (
            <li className="text-2xs text-muted-foreground/60">—</li>
          )}
        </ul>
      </div>
    </div>
  );
}
