"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Info,
  ShieldAlert,
  ChevronRight,
  SlidersHorizontal,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mirror of FactorBreakdown / McDistribution from src/lib/quant-score —
// importing values would force a server module into the client bundle, so
// we re-declare the shapes here.
interface CategoryInput {
  id: string;
  label: string;
  stage: string;
  raw: number | string | null;
  score: number | null;
  weight: number;
  fatalFlaw?: boolean;
  source?: string;
}

interface CategoryResult {
  category: string;
  score: number;
  confidence: number;
  notched: boolean;
  inputs: CategoryInput[];
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

interface McHistogramBin {
  low: number;
  high: number;
  count: number;
}

interface McHistogram {
  bins: McHistogramBin[];
  range: [number, number];
  bin_count: number;
}

interface McDistribution {
  trials: number;
  irr_valid?: boolean;
  irr_sample_count?: number;
  irr: { p10: number; p25: number; p50: number; p75: number; p90: number; mean: number; std: number };
  irr_histogram?: McHistogram;
  em: { p10: number; p50: number; p90: number; mean: number };
  prob_hit_target_irr: number | null;
  prob_capital_loss: number;
  prob_refi_failure: number | null;
  expected_shortfall_5pct: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  risk_free_pct: number;
  sortino_target_pct: number;
  target_irr_pct?: number | null;
  inputs_distribution_summary: Record<string, { mu: number; sigma: number; bounds?: [number, number]; kind: string }>;
  correlation_matrix_version: string;
  rng_seed: number;
}

function hasValidIrr(mc: McDistribution): boolean {
  return mc.irr_valid !== false && (mc.irr_sample_count ?? 1) > 0;
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

// Mirror of DEFAULT_WEIGHTS in src/lib/quant-score/weights.ts. Kept in sync
// here so the client editor can reset to a strategy's defaults without
// importing server-only modules.
type Strategy = "ground_up_dev" | "value_add" | "core" | "student_housing";

const STRATEGY_LABELS: Record<Strategy, string> = {
  ground_up_dev: "Ground-Up Development",
  value_add: "Value-Add",
  core: "Core",
  student_housing: "Student Housing",
};

const CATEGORY_ORDER = [
  "return",
  "capstack",
  "construction",
  "leaseup",
  "market",
  "physical",
  "exit",
  "sponsor",
  "macro",
  "regulatory",
] as const;

const DEFAULT_WEIGHTS: Record<Strategy, Record<string, number>> = {
  ground_up_dev: { return: 15, capstack: 18, construction: 18, leaseup: 13, market: 10, physical: 4, exit: 8, sponsor: 3, macro: 6, regulatory: 5 },
  value_add:     { return: 20, capstack: 16, construction: 4,  leaseup: 16, market: 11, physical: 9, exit: 9, sponsor: 5, macro: 5, regulatory: 5 },
  core:          { return: 23, capstack: 14, construction: 0,  leaseup: 14, market: 13, physical: 11, exit: 12, sponsor: 5, macro: 5, regulatory: 3 },
  student_housing: { return: 18, capstack: 16, construction: 9,  leaseup: 20, market: 13, physical: 4, exit: 6, sponsor: 3, macro: 6, regulatory: 5 },
};

interface Props {
  dealId: string;
  /** Optional — when provided, an "Edit weights" button appears that opens
   *  the per-business-plan weight editor. */
  businessPlanId?: string | null;
  /** Optional — display name for the BP, surfaced in the editor copy. */
  businessPlanName?: string | null;
  initialStage?: "om" | "uw" | "final";
}

export function QuantScoreCard({ dealId, businessPlanId, businessPlanName, initialStage = "uw" }: Props) {
  const [stage, setStage] = useState<"om" | "uw" | "final">(initialStage);
  const [row, setRow] = useState<QuantScoreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<CategoryResult | null>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);

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
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Deal Score
            <ScoreInfoButton mc={row?.mc_distribution} algorithmVersion={row?.algorithm_version} />
          </CardTitle>
          {row?.factor_breakdown.strategy && (
            <Badge variant="outline" className="text-2xs font-normal">
              {row.factor_breakdown.strategy.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {businessPlanId && row && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWeightsOpen(true)}
              title="Edit category weights for this business plan"
              className="text-2xs gap-1.5"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Weights
            </Button>
          )}
          <StageSelector stage={stage} onChange={setStage} />
          <Button size="sm" variant="ghost" onClick={recompute} disabled={recomputing} title="Recompute">
            {recomputing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="flex items-center gap-2 text-2xs text-rose-400">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        {!row ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No Deal Score for this stage yet.{" "}
            <button onClick={recompute} className="text-primary underline hover:opacity-80">
              Run recompute
            </button>
            .
          </div>
        ) : (
          <>
            <Hero breakdown={row.factor_breakdown} mc={row.mc_distribution} />
            <CategoryBars
              breakdown={row.factor_breakdown}
              onPick={(cat) => setDrillDown(cat)}
            />
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

      <BreakdownSheet category={drillDown} onClose={() => setDrillDown(null)} />
      {businessPlanId && row && (
        <WeightsEditor
          open={weightsOpen}
          onClose={() => setWeightsOpen(false)}
          businessPlanId={businessPlanId}
          businessPlanName={businessPlanName ?? null}
          currentWeights={row.factor_breakdown.weights}
          currentStrategy={row.factor_breakdown.strategy as Strategy | null}
          onSaved={async () => {
            setWeightsOpen(false);
            await recompute();
          }}
        />
      )}
    </Card>
  );
}

// ─── Stage selector ─────────────────────────────────────────────────────────

function StageSelector({
  stage,
  onChange,
}: {
  stage: "om" | "uw" | "final";
  onChange: (s: "om" | "uw" | "final") => void;
}) {
  return (
    <div className="flex items-center gap-px rounded-md overflow-hidden border border-border/60 bg-card">
      {(["om", "uw", "final"] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "text-2xs px-3 py-1.5 uppercase tracking-wider font-medium transition-colors",
            s === stage ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ─── Hero (composite + headline risk sentence) ──────────────────────────────

function Hero({
  breakdown,
  mc,
}: {
  breakdown: FactorBreakdown;
  mc: McDistribution | null;
}) {
  const band = BAND_STYLES[breakdown.band] || BAND_STYLES.marginal;
  const headline = useMemo(() => buildHeadline(breakdown, mc), [breakdown, mc]);
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-1">
      <div className="flex items-baseline gap-3">
        <div className="text-5xl font-bold tabular-nums tracking-tight leading-none">
          {breakdown.composite.toFixed(1)}
          <span className="text-base text-muted-foreground/50 font-normal ml-1.5">/100</span>
        </div>
        <Badge className={cn("text-2xs border", band.cls)} variant="outline">
          {band.label}
        </Badge>
      </div>
      <div className="md:text-right">
        <p className="text-xs text-foreground/90 leading-snug">{headline}</p>
        <p className="text-2xs text-muted-foreground/70 mt-0.5">
          Confidence {(breakdown.confidence * 100).toFixed(0)}%{" "}
          <span className="text-muted-foreground/40">·</span> {breakdown.algorithmVersion}
        </p>
      </div>
    </div>
  );
}

function buildHeadline(breakdown: FactorBreakdown, mc: McDistribution | null): string {
  const notched = breakdown.categories.filter((c) => c.notched).map((c) => CATEGORY_LABELS[c.category] ?? c.category);
  if (notched.length > 0) {
    return `Red flag in ${notched.slice(0, 2).join(", ")}${notched.length > 2 ? `, +${notched.length - 2} more` : ""}.`;
  }
  if (mc) {
    const parts: string[] = [];
    if (!hasValidIrr(mc)) {
      parts.push("IRR simulation unavailable");
    } else if (mc.target_irr_pct != null && mc.prob_hit_target_irr != null) {
      parts.push(
        `${(mc.prob_hit_target_irr * 100).toFixed(0)}% chance of hitting the ${mc.target_irr_pct.toFixed(0)}% target IRR`
      );
    } else {
      parts.push(`Median IRR ${mc.irr.p50.toFixed(1)}%`);
    }
    parts.push(`${(mc.prob_capital_loss * 100).toFixed(1)}% chance of capital loss`);
    return parts.join(" · ");
  }
  return `Composite ${breakdown.composite.toFixed(1)} (${BAND_STYLES[breakdown.band]?.label ?? breakdown.band}).`;
}

// ─── Score info popover ─────────────────────────────────────────────────────

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
              Weighted average of 10 risk categories. Each category rolls up from individual inputs
              mapped to 0–100 via piecewise thresholds. Category weights come from the business
              plan's strategy. A single red-flag input (DSCR &lt; 1.0, breakeven occupancy &gt; 95%, or
              a critical environmental flag) drops the whole category by 15.
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
                vacancy, exit cap, and rate sampled from calibrated distributions and correlated via
                Cholesky decomposition. Each trial outputs an IRR/EM; the percentiles, Sharpe,
                Sortino, and probability stats summarize that distribution. Sharpe uses risk-free ={" "}
                {mc.risk_free_pct}%; Sortino uses target = {mc.sortino_target_pct}% and divides by
                downside-only deviation.
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

// ─── Category bars (weight-proportional widths + drill-down) ────────────────

function CategoryBars({
  breakdown,
  onPick,
}: {
  breakdown: FactorBreakdown;
  onPick: (cat: CategoryResult) => void;
}) {
  const visible = breakdown.categories.filter((c) => (breakdown.weights[c.category] ?? 0) > 0);
  const maxWeight = Math.max(...visible.map((c) => breakdown.weights[c.category] ?? 0), 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-2xs uppercase tracking-wider text-muted-foreground/70 mb-1">
        <span>Factor breakdown</span>
        <span>Bar width = weight · click any row to inspect</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1">
        {visible.map((c) => (
          <CategoryRow
            key={c.category}
            cat={c}
            weight={breakdown.weights[c.category] ?? 0}
            maxWeight={maxWeight}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryRow({
  cat,
  weight,
  maxWeight,
  onClick,
}: {
  cat: CategoryResult;
  weight: number;
  maxWeight: number;
  onClick: () => void;
}) {
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
  // Bar container width is proportional to weight (relative to the heaviest
  // category in the profile). Floor at 12% so the smallest categories still
  // show a visible track.
  const containerPct = Math.max(12, (weight / maxWeight) * 100);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left flex flex-col gap-1 py-1 px-1 -mx-1 rounded hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center justify-between text-2xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span className="font-medium text-foreground/90">{CATEGORY_LABELS[cat.category] || cat.category}</span>
          <span className="text-muted-foreground/50">{weight.toFixed(0)}%</span>
          {cat.notched && (
            <span
              title="Red flag: a single 0-score input dropped this category 15 points"
              className="inline-flex items-center gap-0.5 text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded px-1 py-0 text-[9px] uppercase tracking-wider"
            >
              <Flag className="h-2.5 w-2.5" /> Red Flag
            </span>
          )}
        </span>
        <span className="tabular-nums font-medium flex items-center gap-1">
          {cat.confidence > 0 ? score.toFixed(0) : "—"}
          {total > 0 && (
            <span className="text-muted-foreground/50 ml-0.5 font-normal">
              {present}/{total}
            </span>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/70" />
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted/30 overflow-hidden" style={{ width: `${containerPct}%` }}>
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: cat.confidence > 0 ? `${score}%` : "0%" }}
        />
      </div>
    </button>
  );
}

// ─── Monte Carlo section (histogram + stats grid + footer) ──────────────────

function McSection({ mc }: { mc: McDistribution }) {
  const irrValid = hasValidIrr(mc);
  return (
    <div className="border-t border-border/40 pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">Monte Carlo Return Distribution</h4>
        <span className="text-2xs text-muted-foreground">
          {mc.trials.toLocaleString()} trials
          {irrValid && mc.irr_sample_count != null && mc.irr_sample_count !== mc.trials
            ? `, ${mc.irr_sample_count.toLocaleString()} IRR samples`
            : ""}
        </span>
      </div>

      {!irrValid && (
        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          IRR did not converge in any trial, so IRR percentiles and risk ratios are hidden. Equity multiple and capital-loss stats still reflect the simulated outcomes.
        </div>
      )}

      {irrValid && mc.irr_histogram && mc.irr_histogram.bins.length > 0 && (
        <IrrHistogram mc={mc} />
      )}

      <McStatsGrid mc={mc} />

      <p className="text-2xs text-muted-foreground/70">
        Stochastic inputs: rent growth ±{mc.inputs_distribution_summary.rent_growth?.sigma}pp ·
        vacancy triangular · exit cap ±{mc.inputs_distribution_summary.exit_cap?.sigma}pp · rate ±
        {mc.inputs_distribution_summary.rate?.sigma}pp.{" "}
        CVaR 5% IRR: {mc.expected_shortfall_5pct == null ? "n/a" : `${mc.expected_shortfall_5pct.toFixed(1)}%`}.{" "}
        {mc.prob_refi_failure != null && `Refi failure: ${(mc.prob_refi_failure * 100).toFixed(1)}%.`}
      </p>
    </div>
  );
}

// ─── IRR histogram (SVG, no chart lib) ──────────────────────────────────────

function IrrHistogram({ mc }: { mc: McDistribution }) {
  const hist = mc.irr_histogram!;
  const [lo, hi] = hist.range;
  const span = hi - lo;
  if (span <= 0) return null;
  const W = 600;
  const H = 110;
  const PAD_L = 20;
  const PAD_R = 12;
  const PAD_T = 8;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const maxCount = Math.max(...hist.bins.map((b) => b.count), 1);
  const xFor = (irr: number) => PAD_L + ((irr - lo) / span) * innerW;
  const target = mc.target_irr_pct;

  return (
    <div className="rounded-md border border-border/50 bg-card/60 p-2 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[110px]">
        {/* Zero baseline (loss/no-loss) */}
        {lo < 0 && hi > 0 && (
          <line
            x1={xFor(0)}
            x2={xFor(0)}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="rgb(244 63 94 / 0.35)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {/* Histogram bars — color shifts from rose (loss) → amber (below target) → emerald (above target) */}
        {hist.bins.map((b, i) => {
          const x = xFor(b.low);
          const w = Math.max(1, xFor(b.high) - x - 1);
          const h = (b.count / maxCount) * innerH;
          const y = H - PAD_B - h;
          const mid = (b.low + b.high) / 2;
          let fill: string;
          if (mid < 0) fill = "rgb(244 63 94 / 0.55)"; // rose
          else if (target != null && mid < target) fill = "rgb(245 158 11 / 0.55)"; // amber
          else fill = "rgb(16 185 129 / 0.6)"; // emerald
          return <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />;
        })}
        {/* P10 / P50 / P90 markers */}
        <PercentileMarker x={xFor(mc.irr.p10)} label={`P10 ${mc.irr.p10.toFixed(0)}%`} accent="muted" yTop={PAD_T} yBot={H - PAD_B} />
        <PercentileMarker x={xFor(mc.irr.p50)} label={`P50 ${mc.irr.p50.toFixed(0)}%`} accent="primary" yTop={PAD_T} yBot={H - PAD_B} />
        <PercentileMarker x={xFor(mc.irr.p90)} label={`P90 ${mc.irr.p90.toFixed(0)}%`} accent="muted" yTop={PAD_T} yBot={H - PAD_B} />
        {/* Target IRR marker */}
        {target != null && target >= lo && target <= hi && (
          <g>
            <line
              x1={xFor(target)}
              x2={xFor(target)}
              y1={PAD_T - 2}
              y2={H - PAD_B}
              stroke="rgb(99 102 241)"
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
            <text
              x={xFor(target)}
              y={PAD_T - 1}
              fontSize="9"
              fill="rgb(165 180 252)"
              textAnchor="middle"
            >
              Target {target.toFixed(0)}%
            </text>
          </g>
        )}
        {/* Axis range labels */}
        <text x={PAD_L} y={H - 6} fontSize="9" fill="rgb(148 163 184 / 0.7)">
          {lo.toFixed(0)}%
        </text>
        <text x={W - PAD_R} y={H - 6} fontSize="9" fill="rgb(148 163 184 / 0.7)" textAnchor="end">
          {hi.toFixed(0)}%
        </text>
      </svg>
    </div>
  );
}

function PercentileMarker({
  x,
  label,
  accent,
  yTop,
  yBot,
}: {
  x: number;
  label: string;
  accent: "primary" | "muted";
  yTop: number;
  yBot: number;
}) {
  const stroke = accent === "primary" ? "rgb(34 197 94)" : "rgb(148 163 184 / 0.6)";
  const text = accent === "primary" ? "rgb(74 222 128)" : "rgb(148 163 184 / 0.85)";
  return (
    <g>
      <line x1={x} x2={x} y1={yTop} y2={yBot} stroke={stroke} strokeWidth={accent === "primary" ? 1.5 : 1} />
      <text x={x} y={yBot + 14} fontSize="9" fill={text} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

// ─── MC stats grid with 5-band Sharpe/Sortino + verdict ─────────────────────

function McStatsGrid({ mc }: { mc: McDistribution }) {
  const irrValid = hasValidIrr(mc);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-md overflow-hidden border border-border/60">
      <McStat
        label="P10 IRR"
        value={irrValid ? `${mc.irr.p10.toFixed(1)}%` : "n/a"}
        accent={irrValid && mc.irr.p10 < 0 ? "rose" : "muted"}
        tip={`Worst-decile annualized IRR. 10% of the ${mc.trials.toLocaleString()} trials returned ≤ this.`}
      />
      <McStat
        label="P50 IRR"
        value={irrValid ? `${mc.irr.p50.toFixed(1)}%` : "n/a"}
        accent={irrValid ? "emerald" : "muted"}
        highlight
        tip={`Median annualized IRR across ${mc.trials.toLocaleString()} trials. Each trial draws rent growth (μ=${mc.inputs_distribution_summary.rent_growth?.mu}%, σ=${mc.inputs_distribution_summary.rent_growth?.sigma}pp), vacancy (triangular), exit cap (μ=${mc.inputs_distribution_summary.exit_cap?.mu}%, σ=${mc.inputs_distribution_summary.exit_cap?.sigma}pp), and rate (σ=${mc.inputs_distribution_summary.rate?.sigma}pp) — correlated via Cholesky — and re-runs the underwriting model.`}
      />
      <McStat
        label="P90 IRR"
        value={irrValid ? `${mc.irr.p90.toFixed(1)}%` : "n/a"}
        accent={irrValid ? "emerald" : "muted"}
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
      <RatioStat
        label="Sharpe"
        value={mc.sharpe_ratio}
        kind="sharpe"
        rfPct={mc.risk_free_pct}
      />
      <RatioStat
        label="Sortino"
        value={mc.sortino_ratio}
        kind="sortino"
        rfPct={mc.sortino_target_pct}
      />
    </div>
  );
}

function ratioVerdict(r: number | null): { word: string; accent: "muted" | "rose" | "amber" | "blue" | "emerald" } {
  if (r == null) return { word: "—", accent: "muted" };
  if (r < 0) return { word: "Negative", accent: "rose" };
  if (r < 0.5) return { word: "Weak", accent: "rose" };
  if (r < 1) return { word: "Adequate", accent: "amber" };
  if (r < 2) return { word: "Strong", accent: "emerald" };
  return { word: "Excellent", accent: "emerald" };
}

function RatioStat({
  label,
  value,
  kind,
  rfPct,
}: {
  label: string;
  value: number | null;
  kind: "sharpe" | "sortino";
  rfPct: number;
}) {
  const { word, accent } = ratioVerdict(value);
  const tip =
    kind === "sharpe"
      ? `Sharpe = (mean IRR − ${rfPct}% risk-free) / σ(IRR). Penalises both upside and downside variance. Bands: <0 negative · 0–0.5 weak · 0.5–1 adequate · 1–2 strong · 2+ excellent.`
      : `Sortino = (mean IRR − ${rfPct}% target) / σ_downside. Only counts variance from outcomes BELOW the target — fairer for asymmetric, right-skewed real-estate returns. Same band thresholds as Sharpe.`;
  const colors: Record<string, string> = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    blue: "text-blue-300",
    amber: "text-amber-300",
    muted: "text-muted-foreground",
  };
  return (
    <div className="bg-card p-2" title={tip}>
      <p className="text-2xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {label}
        <Info className="h-2.5 w-2.5 text-muted-foreground/40" />
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className={cn("text-sm font-bold tabular-nums", colors[accent])}>
          {value != null ? value.toFixed(2) : "—"}
        </span>
        <span className={cn("text-2xs uppercase tracking-wider", colors[accent])}>{word}</span>
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
    <div className={cn("bg-card p-2", highlight && "bg-muted/20")} title={tip}>
      <p className="text-2xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {label}
        {tip && <Info className="h-2.5 w-2.5 text-muted-foreground/40" />}
      </p>
      <p className={cn("text-sm font-bold tabular-nums", colors[accent])}>{value}</p>
    </div>
  );
}

// ─── Strengths / Weaknesses ─────────────────────────────────────────────────

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

// ─── Drill-down sheet (per-category input audit) ────────────────────────────

function BreakdownSheet({
  category,
  onClose,
}: {
  category: CategoryResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!category} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {category && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {CATEGORY_LABELS[category.category] || category.category}
                {category.notched && (
                  <Badge variant="outline" className="text-2xs border-rose-500/30 text-rose-300 bg-rose-500/10">
                    <Flag className="h-3 w-3 mr-1" /> Red Flag
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                Category score{" "}
                <span className="font-medium text-foreground/90">{category.score.toFixed(1)}</span>{" "}
                · confidence{" "}
                <span className="font-medium text-foreground/90">{(category.confidence * 100).toFixed(0)}%</span>{" "}
                ({category.inputs.filter((i) => i.score != null).length} of{" "}
                {category.inputs.length} inputs present). Each input maps to 0–100 via piecewise
                thresholds; the category score is the weighted average. Missing inputs are
                excluded — never imputed.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-2xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Input</th>
                    <th className="text-right px-3 py-2 font-medium w-[80px]">Raw</th>
                    <th className="text-right px-3 py-2 font-medium w-[60px]">Score</th>
                    <th className="text-right px-3 py-2 font-medium w-[50px]">Weight</th>
                    <th className="text-left px-3 py-2 font-medium w-[60px]">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {category.inputs.map((i) => (
                    <BreakdownRow key={i.id} input={i} />
                  ))}
                  {category.inputs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted-foreground py-6">
                        No inputs defined for this category at this stage.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BreakdownRow({ input }: { input: CategoryInput }) {
  const score = input.score;
  const scoreColor =
    score == null
      ? "text-muted-foreground/40"
      : score >= 80
      ? "text-emerald-300"
      : score >= 65
      ? "text-blue-300"
      : score >= 50
      ? "text-amber-300"
      : "text-rose-300";
  const rawDisplay =
    input.raw == null
      ? "—"
      : typeof input.raw === "number"
      ? Number.isFinite(input.raw) ? formatNumber(input.raw) : "—"
      : String(input.raw);
  return (
    <tr className="border-t border-border/40 hover:bg-muted/20">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground/90">{input.label}</span>
          {input.fatalFlaw && (
            <span title="Red-flag input: a 0 here drops the whole category by 15">
              <Flag className="h-3 w-3 text-rose-400/80" />
            </span>
          )}
        </div>
        {input.source && (
          <p className="text-2xs text-muted-foreground/60 mt-0.5">{input.source}</p>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{rawDisplay}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums font-medium", scoreColor)}>
        {score == null ? "—" : score.toFixed(0)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{input.weight.toFixed(1)}</td>
      <td className="px-3 py-2 uppercase text-2xs tracking-wider text-muted-foreground">{input.stage}</td>
    </tr>
  );
}

function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

// ─── Weights editor (modify category weights for the business plan) ─────────

function WeightsEditor({
  open,
  onClose,
  businessPlanId,
  businessPlanName,
  currentWeights,
  currentStrategy,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  businessPlanId: string;
  businessPlanName: string | null;
  currentWeights: Record<string, number>;
  currentStrategy: Strategy | null;
  onSaved: () => void | Promise<void>;
}) {
  const [strategy, setStrategy] = useState<Strategy>(currentStrategy ?? "value_add");
  const [weights, setWeights] = useState<Record<string, number>>(currentWeights);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed local state whenever the modal opens with fresh data — covers
  // the case where the analyst edits weights, recomputes, then reopens.
  useEffect(() => {
    if (open) {
      setStrategy(currentStrategy ?? "value_add");
      setWeights({ ...currentWeights });
      setError(null);
    }
  }, [open, currentStrategy, currentWeights]);

  const total = CATEGORY_ORDER.reduce((s, c) => s + (weights[c] || 0), 0);
  const totalRounded = Math.round(total * 10) / 10;

  const setWeight = (cat: string, v: number) => {
    setWeights((w) => ({ ...w, [cat]: Math.max(0, Math.min(50, isFinite(v) ? v : 0)) }));
  };

  const loadStrategyDefaults = (s: Strategy) => {
    setStrategy(s);
    setWeights({ ...DEFAULT_WEIGHTS[s] });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Normalize to exactly 100 on save so the engine receives a clean
      // distribution regardless of how the user tweaked the sliders.
      const sum = total;
      const normalized: Record<string, number> = {};
      for (const c of CATEGORY_ORDER) {
        normalized[c] = sum > 0 ? Math.round(((weights[c] || 0) / sum) * 1000) / 10 : 0;
      }
      const res = await fetch(`/api/business-plans/${businessPlanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy, factor_weights: normalized }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "save failed");
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const totalOk = Math.abs(totalRounded - 100) < 0.5;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Edit Scoring Weights
          </DialogTitle>
          <DialogDescription>
            These weights control how much each factor category contributes to the composite score.
            Changes apply to <span className="text-foreground/80">all deals on the {businessPlanName ?? "selected"} business plan</span>.
            Pick a strategy preset to populate the sliders, then tune individual categories. Weights
            are normalized to 100 on save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Strategy preset</span>
            <select
              value={strategy}
              onChange={(e) => loadStrategyDefaults(e.target.value as Strategy)}
              className="bg-card border border-border/60 rounded px-2 py-1 text-xs"
            >
              {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => loadStrategyDefaults(strategy)}
              className="text-2xs text-primary hover:underline"
            >
              Reset to {STRATEGY_LABELS[strategy]} defaults
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {CATEGORY_ORDER.map((cat) => (
              <WeightSlider
                key={cat}
                category={cat}
                value={weights[cat] || 0}
                onChange={(v) => setWeight(cat, v)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between text-xs border-t border-border/40 pt-3">
            <span className="text-muted-foreground">
              Total{" "}
              <span className={cn("tabular-nums font-semibold", totalOk ? "text-emerald-400" : "text-amber-400")}>
                {totalRounded.toFixed(1)}
              </span>
              <span className="text-muted-foreground/60"> / 100</span>
              {!totalOk && <span className="text-muted-foreground/70 ml-2">(will be normalized on save)</span>}
            </span>
            {error && <span className="text-rose-400 text-2xs">{error}</span>}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || total <= 0}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save & recompute"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WeightSlider({
  category,
  value,
  onChange,
}: {
  category: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-[110px] text-muted-foreground">{CATEGORY_LABELS[category] || category}</span>
      <input
        type="range"
        min={0}
        max={50}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-primary"
      />
      <input
        type="number"
        min={0}
        max={50}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-12 bg-card border border-border/60 rounded px-1.5 py-0.5 text-right tabular-nums text-2xs"
      />
    </label>
  );
}
