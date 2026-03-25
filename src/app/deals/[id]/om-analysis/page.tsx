"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Send,
  ExternalLink,
  TrendingUp,
  DollarSign,
  Percent,
  Building2,
  MessageSquare,
  Lightbulb,
  XCircle,
  BookOpen,
  ChevronRight,
  Star,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RedFlag {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description: string;
  recommendation: string;
}

interface OmAnalysis {
  id: string;
  deal_id: string;
  status: "pending" | "processing" | "complete" | "error";
  deal_context: string | null;
  // Property
  property_name: string | null;
  address: string | null;
  property_type: string | null;
  year_built: number | null;
  sf: number | null;
  unit_count: number | null;
  // Financials
  asking_price: number | null;
  noi: number | null;
  cap_rate: number | null;
  grm: number | null;
  cash_on_cash: number | null;
  irr: number | null;
  equity_multiple: number | null;
  dscr: number | null;
  vacancy_rate: number | null;
  expense_ratio: number | null;
  price_per_sf: number | null;
  price_per_unit: number | null;
  // Assumptions
  rent_growth: string | null;
  hold_period: string | null;
  leverage: string | null;
  exit_cap_rate: string | null;
  // Results
  deal_score: number | null;
  score_reasoning: string | null;
  summary: string | null;
  recommendations: string[] | null;
  red_flags: RedFlag[] | null;
  // Meta
  model_used: string | null;
  tokens_used: number | null;
  cost_estimate: number | null;
  processing_ms: number | null;
  error_message: string | null;
  created_at: string;
}

interface QaEntry {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
}

function fmtPct(n: number | null | undefined, isDecimal = true): string {
  if (n == null) return "—";
  const val = isDecimal ? Number(n) * 100 : Number(n);
  return `${val.toFixed(2)}%`;
}

function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return Number(n).toFixed(decimals);
}

function fmtSf(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Number(n).toLocaleString()} SF`;
}

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-600";
  if (score >= 6) return "text-amber-500";
  if (score >= 4) return "text-orange-500";
  return "text-rose-600";
}

function scoreBg(score: number): string {
  if (score >= 8) return "bg-emerald-50 border-emerald-200";
  if (score >= 6) return "bg-amber-50 border-amber-200";
  if (score >= 4) return "bg-orange-50 border-orange-200";
  return "bg-rose-50 border-rose-200";
}

function severityConfig(severity: string) {
  switch (severity) {
    case "critical":
      return { label: "Critical", bg: "bg-rose-100 text-rose-800 border-rose-200", dot: "bg-rose-500" };
    case "high":
      return { label: "High", bg: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" };
    case "medium":
      return { label: "Medium", bg: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-400" };
    default:
      return { label: "Low", bg: "bg-blue-100 text-blue-800 border-blue-200", dot: "bg-blue-400" };
  }
}

const SUGGESTED_QUESTIONS = [
  "What are the biggest risks with this deal?",
  "How does the cap rate compare to market?",
  "What are the key assumptions in the projections?",
  "What should I verify before making an offer?",
];

// ─── Business Plan types ──────────────────────────────────────────────────────

interface BusinessPlan {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
}

// ─── Two-Layer Deal Context Panel ─────────────────────────────────────────────

function DealContextPanel({
  basePlan,
  setBasePlan,
  addendum,
  setAddendum,
}: {
  basePlan: BusinessPlan | null;
  setBasePlan: (plan: BusinessPlan | null) => void;
  addendum: string;
  setAddendum: (v: string) => void;
}) {
  const [plans, setPlans] = useState<BusinessPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/business-plans");
        const json = await res.json();
        if (json.data) {
          setPlans(json.data);
          // Auto-select the default plan if none chosen yet
          if (!basePlan) {
            const defaultPlan = json.data.find((p: BusinessPlan) => p.is_default) ?? null;
            setBasePlan(defaultPlan);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoadingPlans(false);
      }
    }
    loadPlans();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noPlansSaved = !loadingPlans && plans.length === 0;

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Base Plan selector */}
      <div className="border rounded-xl bg-amber-50/60 border-amber-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-900">Base Business Plan</p>
          </div>
          {loadingPlans ? (
            <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin flex-shrink-0" />
          ) : noPlansSaved ? (
            <Link
              href="/business-plans"
              target="_blank"
              className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 underline"
            >
              <ExternalLink className="h-3 w-3" />
              Create a plan
            </Link>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowPlanPicker((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 font-medium"
              >
                Change
                <ChevronRight className={cn("h-3 w-3 transition-transform", showPlanPicker && "rotate-90")} />
              </button>
              {showPlanPicker && (
                <div className="absolute right-0 top-full mt-1 z-10 w-64 bg-white border rounded-xl shadow-lg py-1 text-sm max-h-60 overflow-y-auto">
                  <button
                    onClick={() => {
                      setBasePlan(null);
                      setShowPlanPicker(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-muted-foreground text-xs"
                  >
                    None (no base plan)
                  </button>
                  {plans.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setBasePlan(p);
                        setShowPlanPicker(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2",
                        basePlan?.id === p.id && "bg-amber-50"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {p.is_default && (
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400 flex-shrink-0" />
                          )}
                          <span className="font-medium text-xs truncate">{p.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {p.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {basePlan ? (
          <div className="border-t border-amber-200 px-4 py-2.5 bg-amber-50">
            <div className="flex items-center gap-2 mb-1.5">
              {basePlan.is_default && (
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              )}
              <p className="text-xs font-semibold text-amber-800">{basePlan.name}</p>
            </div>
            <div className={cn("text-xs text-amber-700 leading-relaxed", !expanded && "line-clamp-3")}>
              {basePlan.description ?? ""}
            </div>
            {(basePlan.description?.length ?? 0) > 120 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-amber-600 hover:underline mt-1"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        ) : (
          <div className="border-t border-amber-200 px-4 py-2 bg-amber-50/30">
            <p className="text-xs text-amber-700/70 italic">
              {noPlansSaved
                ? "No business plans saved yet — create one to pre-fill strategy context on every analysis."
                : "No base plan selected — analysis will run without strategy context."}
            </p>
          </div>
        )}
      </div>

      {/* Deal-specific addendum */}
      <div className="border rounded-xl p-4 bg-card flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded-sm bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold text-primary">+</span>
          </div>
          <p className="text-sm font-semibold">Deal-Specific Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></p>
        </div>
        <Textarea
          value={addendum}
          onChange={(e) => setAddendum(e.target.value)}
          placeholder="Anything specific to this deal? e.g. Seller is motivated — been on market 6+ months. Building has deferred roof. We've already walked it once. Do not flag roof as a surprise."
          className="min-h-[72px] resize-none text-sm"
        />
      </div>
    </div>
  );
}

// ─── Upload Panel ─────────────────────────────────────────────────────────────

function UploadPanel({
  dealId,
  onAnalysisCreated,
  processing,
}: {
  dealId: string;
  onAnalysisCreated: () => void;
  processing: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basePlan, setBasePlan] = useState<BusinessPlan | null>(null);
  const [addendum, setAddendum] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function buildDealContext(): string {
    const parts: string[] = [];
    if (basePlan?.description?.trim()) {
      parts.push(`BASE BUSINESS PLAN — ${basePlan.name}:\n${basePlan.description.trim()}`);
    }
    if (addendum.trim()) {
      parts.push(`DEAL-SPECIFIC NOTES:\n${addendum.trim()}`);
    }
    return parts.join("\n\n");
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const ctx = buildDealContext();
      if (ctx) fd.append("deal_context", ctx);
      const res = await fetch(`/api/deals/${dealId}/om-upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      onAnalysisCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    upload(files[0]);
  }

  return (
    <div className="max-w-2xl mx-auto py-10 flex flex-col items-center gap-5">
      {processing ? (
        <div className="text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
          </div>
          <div>
            <p className="font-semibold text-lg">Analyzing OM…</p>
            <p className="text-muted-foreground text-sm mt-1">
              Running 4-stage AI analysis. This takes 15–40 seconds.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 mt-2">
            {["Extracting metrics", "Finding red flags", "Scoring deal", "Recommendations"].map(
              (stage, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {stage}
                </span>
              )
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Two-layer context */}
          <DealContextPanel
            basePlan={basePlan}
            setBasePlan={setBasePlan}
            addendum={addendum}
            setAddendum={setAddendum}
          />

          {/* Drop zone */}
          <div
            className={cn(
              "w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-4 cursor-pointer transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/30"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <FileText className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-semibold">Upload Offering Memorandum</p>
              <p className="text-sm text-muted-foreground mt-1">
                Drag & drop or click to select — PDF or DOCX
              </p>
            </div>
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading & analyzing…
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5 w-full">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="text-xs text-muted-foreground text-center">
            AI will extract metrics, identify red flags calibrated to your strategy, score the deal 1–10,
            and suggest next steps.
          </div>
        </>
      )}
    </div>
  );
}

// ─── Score Card ───────────────────────────────────────────────────────────────

function ScoreCard({ analysis }: { analysis: OmAnalysis }) {
  const score = analysis.deal_score ?? 0;
  const criticalCount = analysis.red_flags?.filter((f) => f.severity === "critical").length ?? 0;

  // Split score reasoning into bullet points (by sentence or newline)
  const reasoningBullets = (analysis.score_reasoning ?? "")
    .split(/(?:\.\s+|\n+)/)
    .map((s) => s.replace(/\.+$/, "").trim())
    .filter((s) => s.length > 0);

  return (
    <Card className={cn("border", scoreBg(score))}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground mb-1">Deal Score</p>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-6xl font-bold tabular-nums", scoreColor(score))}>
                {score}
              </span>
              <span className="text-2xl text-muted-foreground">/10</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end flex-shrink-0">
            {criticalCount > 0 && (
              <div className="flex items-center gap-1.5 text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" />
                {criticalCount} critical flag{criticalCount > 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* Score bar */}
        <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              score >= 8 ? "bg-emerald-500" : score >= 6 ? "bg-amber-500" : score >= 4 ? "bg-orange-500" : "bg-rose-500"
            )}
            style={{ width: `${score * 10}%` }}
          />
        </div>

        {/* Summary + reasoning bullets */}
        {(analysis.summary || reasoningBullets.length > 0) && (
          <div className="mt-4 space-y-2">
            {analysis.summary && (
              <p className="text-sm text-muted-foreground leading-relaxed">{analysis.summary}</p>
            )}
            {reasoningBullets.length > 0 && (
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {reasoningBullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Metric Cards ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  icon?: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="bg-card border rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />}
      </div>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─── Red Flags Section ────────────────────────────────────────────────────────

function RedFlagsSection({ flags }: { flags: RedFlag[] }) {
  const [open, setOpen] = useState(true);

  const sorted = [...flags].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });

  const counts = {
    critical: flags.filter((f) => f.severity === "critical").length,
    high: flags.filter((f) => f.severity === "high").length,
    medium: flags.filter((f) => f.severity === "medium").length,
    low: flags.filter((f) => f.severity === "low").length,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-between w-full"
        >
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Red Flags
            <span className="text-muted-foreground font-normal text-sm">
              ({flags.length})
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {counts.critical > 0 && (
              <span className="text-xs font-medium text-rose-700 bg-rose-100 border border-rose-200 rounded-full px-2 py-0.5">
                {counts.critical} critical
              </span>
            )}
            {counts.high > 0 && (
              <span className="text-xs font-medium text-orange-700 bg-orange-100 border border-orange-200 rounded-full px-2 py-0.5">
                {counts.high} high
              </span>
            )}
            {open ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 flex flex-col gap-3">
          {sorted.map((flag, i) => {
            const cfg = severityConfig(flag.severity);
            return (
              <div key={i} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0", cfg.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full border",
                          cfg.bg
                        )}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-xs text-muted-foreground font-medium">
                        {flag.category}
                      </span>
                    </div>
                    <p className="text-sm">{flag.description}</p>
                    {flag.recommendation && (
                      <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1">
                        <Lightbulb className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-500" />
                        {flag.recommendation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Recommendations Section ──────────────────────────────────────────────────

function RecommendationsSection({ recommendations }: { recommendations: string[] }) {
  const [open, setOpen] = useState(true);

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-between w-full"
        >
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Next Steps
          </CardTitle>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          <ol className="flex flex-col gap-2">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed">{rec}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Q&A Chat ─────────────────────────────────────────────────────────────────

function QaChat({
  dealId,
  analysisId,
  history,
  onNewEntry,
}: {
  dealId: string;
  analysisId: string;
  history: QaEntry[];
  onNewEntry: (entry: QaEntry) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function send(question: string) {
    if (!question.trim() || sending) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/deals/${dealId}/om-qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, analysis_id: analysisId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onNewEntry(json.data.qa);
    } catch (err) {
      console.error("Q&A error:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-primary" />
          Ask About This Deal
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col gap-4">
        {/* History */}
        {history.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            Ask any question about the OM analysis.
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-h-96 overflow-y-auto">
            {history.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-2">
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 text-sm max-w-[80%]">
                    {entry.question}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[90%] prose prose-sm max-w-none">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: entry.answer
                          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                          .replace(/\*(.*?)\*/g, "<em>$1</em>")
                          .replace(/\n/g, "<br/>"),
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Suggested questions */}
        {history.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="text-xs px-3 py-1.5 bg-accent hover:bg-accent/80 rounded-full transition-colors text-accent-foreground border"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about this OM…"
            className="min-h-[60px] resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => send(input)}
            disabled={!input.trim() || sending}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Re-analyze Panel ─────────────────────────────────────────────────────────

function ReanalyzePanel({
  dealId,
  onDone,
  onCancel,
}: {
  dealId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [basePlan, setBasePlan] = useState<BusinessPlan | null>(null);
  const [addendum, setAddendum] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function buildDealContext(): string {
    const parts: string[] = [];
    if (basePlan?.description?.trim()) {
      parts.push(`BASE BUSINESS PLAN — ${basePlan.name}:\n${basePlan.description.trim()}`);
    }
    if (addendum.trim()) {
      parts.push(`DEAL-SPECIFIC NOTES:\n${addendum.trim()}`);
    }
    return parts.join("\n\n");
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const ctx = buildDealContext();
      if (ctx) fd.append("deal_context", ctx);
      const res = await fetch(`/api/deals/${dealId}/om-upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4 text-primary" />
          Re-analyze with Updated Context
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col gap-4">
        <DealContextPanel
          basePlan={basePlan}
          setBasePlan={setBasePlan}
          addendum={addendum}
          setAddendum={setAddendum}
        />

        <div className="flex items-center gap-3">
          <Button
            variant="default"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Choose OM File
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={uploading}>
            Cancel
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files[0]) upload(files[0]);
            }}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function OmAnalysisPage() {
  const params = useParams<{ id: string }>();
  const dealId = params.id;

  const [analysis, setAnalysis] = useState<OmAnalysis | null>(null);
  const [qaHistory, setQaHistory] = useState<QaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notionExporting, setNotionExporting] = useState(false);
  const [notionResult, setNotionResult] = useState<{ url: string } | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showReanalyze, setShowReanalyze] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/om-analysis`);
      const json = await res.json();
      if (res.ok && json.data?.analysis) {
        setAnalysis(json.data.analysis);
        return json.data.analysis as OmAnalysis;
      }
    } catch {}
    return null;
  }, [dealId]);

  const fetchQa = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/om-qa`);
      const json = await res.json();
      if (res.ok) setQaHistory(json.data.history ?? []);
    } catch {}
  }, [dealId]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const a = await fetchAnalysis();
      if (a?.status === "complete") await fetchQa();
      setLoading(false);
    }
    init();
  }, [fetchAnalysis, fetchQa]);

  // Polling when status is processing
  useEffect(() => {
    if (analysis?.status === "processing") {
      pollRef.current = setInterval(async () => {
        const a = await fetchAnalysis();
        if (a && a.status !== "processing") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (a.status === "complete") await fetchQa();
        }
      }, 3000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [analysis?.status, fetchAnalysis, fetchQa]);

  async function handleExportNotion() {
    setNotionExporting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/om-notion`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setNotionResult({ url: json.data.notion_url });
    } catch (err) {
      console.error("Notion export failed:", err);
      alert("Notion export failed. Check that NOTION_API_KEY and NOTION_DEALS_DATABASE_ID are configured.");
    } finally {
      setNotionExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No analysis yet
  if (!analysis) {
    return (
      <UploadPanel
        dealId={dealId}
        processing={false}
        onAnalysisCreated={async () => {
          const a = await fetchAnalysis();
          if (a) setAnalysis(a);
        }}
      />
    );
  }

  // Processing
  if (analysis.status === "processing" || analysis.status === "pending") {
    return (
      <UploadPanel
        dealId={dealId}
        processing={true}
        onAnalysisCreated={fetchAnalysis}
      />
    );
  }

  // Error
  if (analysis.status === "error") {
    return (
      <div className="max-w-2xl mx-auto py-12 flex flex-col items-center gap-6">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center">
            <XCircle className="h-7 w-7 text-rose-600" />
          </div>
          <div>
            <p className="font-semibold text-rose-700">Analysis Failed</p>
            {analysis.error_message && (
              <p className="text-sm text-muted-foreground mt-1">{analysis.error_message}</p>
            )}
          </div>
        </div>
        <UploadPanel
          dealId={dealId}
          processing={false}
          onAnalysisCreated={async () => {
            const a = await fetchAnalysis();
            if (a) setAnalysis(a);
          }}
        />
      </div>
    );
  }

  // Complete
  const redFlags = analysis.red_flags ?? [];
  const recommendations = analysis.recommendations ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">OM Analysis</h1>
          {analysis.property_name && (
            <p className="text-sm text-muted-foreground mt-0.5">{analysis.property_name}</p>
          )}
          {analysis.address && (
            <p className="text-xs text-muted-foreground">{analysis.address}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {notionResult ? (
            <a
              href={notionResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 hover:bg-emerald-100 transition-colors"
            >
              <CheckCircle2 className="h-4 w-4" />
              Exported to Notion
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportNotion}
              disabled={notionExporting}
            >
              {notionExporting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-2" />
              )}
              Export to Notion
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReanalyze((v) => !v)}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Re-analyze
          </Button>
        </div>
      </div>

      {/* Deal context badge (if present) */}
      {analysis.deal_context && !showReanalyze && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <BookOpen className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-800 mb-0.5">Business Plan Context Used</p>
            <p className="text-amber-700 leading-relaxed">{analysis.deal_context}</p>
          </div>
        </div>
      )}

      {/* Re-analyze panel */}
      {showReanalyze && (
        <ReanalyzePanel
          dealId={dealId}
          onDone={async () => {
            setShowReanalyze(false);
            const a = await fetchAnalysis();
            if (a) setAnalysis(a);
          }}
          onCancel={() => setShowReanalyze(false)}
        />
      )}

      {/* Score */}
      <ScoreCard analysis={analysis} />

      {/* Property strip */}
      <div className="flex flex-wrap gap-3 items-center text-sm text-muted-foreground bg-card border rounded-xl px-4 py-3">
        {analysis.property_type && (
          <span className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            {analysis.property_type?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </span>
        )}
        {analysis.year_built && <span>Built {analysis.year_built}</span>}
        {analysis.sf && <span>{fmtSf(analysis.sf)}</span>}
        {analysis.unit_count && <span>{Number(analysis.unit_count).toLocaleString()} units</span>}
      </div>

      {/* Key Financials — in-place metrics only */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Key Financials
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard
            label="Asking Price"
            value={fmt$(analysis.asking_price)}
            icon={DollarSign}
          />
          <MetricCard
            label="NOI"
            value={fmt$(analysis.noi)}
            icon={TrendingUp}
            sub="per year"
          />
          <MetricCard
            label="Cap Rate"
            value={fmtPct(analysis.cap_rate)}
            icon={Percent}
          />
          <MetricCard label="GRM" value={fmtNum(analysis.grm, 1)} />
          <MetricCard label="Vacancy" value={fmtPct(analysis.vacancy_rate)} />
          <MetricCard label="Price/SF" value={fmt$(analysis.price_per_sf)} />
        </div>
      </div>

      {/* Assumptions */}
      {(analysis.rent_growth || analysis.hold_period || analysis.leverage || analysis.exit_cap_rate) && (
        <Card>
          <CardHeader className="pb-3">
            <button
              onClick={() => setShowAssumptions((o) => !o)}
              className="flex items-center justify-between w-full"
            >
              <CardTitle className="text-base">Assumptions</CardTitle>
              {showAssumptions ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {showAssumptions && (
            <CardContent className="pt-0 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {analysis.rent_growth && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Rent Growth</p>
                  <p className="font-medium">{analysis.rent_growth}</p>
                </div>
              )}
              {analysis.hold_period && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Hold Period</p>
                  <p className="font-medium">{analysis.hold_period}</p>
                </div>
              )}
              {analysis.leverage && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Leverage</p>
                  <p className="font-medium">{analysis.leverage}</p>
                </div>
              )}
              {analysis.exit_cap_rate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Exit Cap Rate</p>
                  <p className="font-medium">{analysis.exit_cap_rate}</p>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Red flags */}
      {redFlags.length > 0 && <RedFlagsSection flags={redFlags} />}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <RecommendationsSection recommendations={recommendations} />
      )}

      {/* Q&A Chat */}
      <QaChat
        dealId={dealId}
        analysisId={analysis.id}
        history={qaHistory}
        onNewEntry={(entry) => setQaHistory((h) => [...h, entry])}
      />

      {/* Go to Underwriting CTA */}
      <div className="flex justify-center pt-2 pb-4">
        <Link href={`/deals/${dealId}/underwriting`}>
          <Button size="lg" className="gap-2">
            <Calculator className="h-4 w-4" />
            Go to Underwriting
          </Button>
        </Link>
      </div>
    </div>
  );
}
