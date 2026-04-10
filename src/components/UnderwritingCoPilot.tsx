"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  AlertTriangle,
  MessageCircleQuestion,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Collapsible Underwriting Co-Pilot sidebar. Three modes:
//
//   1. Challenge  — Claude reviews the current UW model and returns a list
//                   of concerns the analyst should address.
//   2. What-If    — analyst types a scenario, Claude proposes a field patch
//                   + impact summary. "Apply" merges the patch into the UW
//                   state via onApplyPatch.
//   3. Benchmarks — pure data view: shows current values next to market
//                   defaults, submarket metrics, and workspace comp medians.
//
// UX fixes (v2):
// - Close: backdrop click-to-close + prominent collapse toggle in header
// - State: all three panes render always (hidden via CSS, not unmounted)
//   so switching tabs preserves their state
// - Applied: challenge + what-if panes track which items have been applied
//   and show a green "Applied" badge on those rows

type Mode = "challenge" | "whatif" | "benchmarks";

interface UWChallenge {
  field: string;
  current_value: string;
  severity: "low" | "medium" | "high";
  concern: string;
  suggestion: string;
  suggested_value: number | null;
}

interface WhatIfResult {
  analysis: string;
  field_changes: Record<string, number>;
  key_impacts: Array<{ metric: string; before: string; after: string }>;
}

interface Benchmarks {
  property_type: string | null;
  defaults: {
    vacancy_rate: number;
    expense_ratio: number;
    management_fee_pct: number;
    cap_rate: number;
    rent_growth: number;
    expense_growth: number;
  };
  submarket: {
    submarket_name: string | null;
    market_cap_rate: number | null;
    market_vacancy: number | null;
    market_rent_growth: number | null;
  } | null;
  comps: {
    sale: {
      count: number;
      median_cap_rate: number | null;
      median_price_per_unit: number | null;
      median_price_per_sf: number | null;
    } | null;
    rent: {
      count: number;
      median_rent_per_unit: number | null;
      median_rent_per_sf: number | null;
      median_occupancy: number | null;
    } | null;
  };
}

export interface UWCoPilotProps {
  dealId: string;
  uwData: Record<string, unknown>;
  metrics: Record<string, unknown>;
  onApplyPatch: (patch: Record<string, number>) => void;
}

export function UnderwritingCoPilot({
  dealId,
  uwData,
  metrics,
  onApplyPatch,
}: UWCoPilotProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("challenge");

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full gradient-gold text-primary-foreground font-medium text-xs shadow-lifted-md hover:brightness-110 transition-all"
        >
          <Sparkles className="h-3.5 w-3.5" />
          UW Co-Pilot
        </button>
      )}

      {/* Backdrop (click to close) */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      {open && (
        <aside className="fixed top-0 right-0 z-40 h-screen w-full sm:w-[420px] bg-card border-l border-border/60 shadow-2xl flex flex-col">
          {/* Header with collapse toggle */}
          <header className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-gold flex items-center justify-center">
                <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold">UW Co-Pilot</div>
                <div className="text-[10px] text-muted-foreground">
                  AI review + scenarios + benchmarks
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Close Co-Pilot"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </header>

          {/* Mode tabs */}
          <div className="flex border-b border-border/40 shrink-0">
            <TabButton
              active={mode === "challenge"}
              onClick={() => setMode("challenge")}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="Challenge"
            />
            <TabButton
              active={mode === "whatif"}
              onClick={() => setMode("whatif")}
              icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
              label="What-If"
            />
            <TabButton
              active={mode === "benchmarks"}
              onClick={() => setMode("benchmarks")}
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="Benchmarks"
            />
          </div>

          {/* Tab content — ALL panes render always, inactive ones are hidden
              so their state (challenges, what-if history, benchmarks data)
              persists across tab switches. */}
          <div className="flex-1 overflow-y-auto">
            <div className={mode === "challenge" ? "" : "hidden"}>
              <ChallengePane
                dealId={dealId}
                metrics={metrics}
                onApplyPatch={onApplyPatch}
              />
            </div>
            <div className={mode === "whatif" ? "" : "hidden"}>
              <WhatIfPane
                dealId={dealId}
                metrics={metrics}
                onApplyPatch={onApplyPatch}
              />
            </div>
            <div className={mode === "benchmarks" ? "" : "hidden"}>
              <BenchmarksPane dealId={dealId} uwData={uwData} />
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors ${
        active
          ? "text-foreground border-b-2 border-primary -mb-px"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Challenge pane ────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<
  UWChallenge["severity"],
  { bg: string; text: string; dot: string }
> = {
  high: { bg: "bg-red-500/10", text: "text-red-300", dot: "bg-red-400" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-300", dot: "bg-amber-400" },
  low: { bg: "bg-blue-500/10", text: "text-blue-300", dot: "bg-blue-400" },
};

function ChallengePane({
  dealId,
  metrics,
  onApplyPatch,
}: {
  dealId: string;
  metrics: Record<string, unknown>;
  onApplyPatch: (patch: Record<string, number>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [challenges, setChallenges] = useState<UWChallenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track which challenges have been applied so we can show a visual badge
  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());

  const loadChallenges = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAppliedFields(new Set()); // reset applied state on re-run
    try {
      const res = await fetch(`/api/deals/${dealId}/copilot/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load challenges");
        return;
      }
      setChallenges(json.data || []);
    } catch {
      setError("Failed to load challenges");
    } finally {
      setLoading(false);
    }
  }, [dealId, metrics]);

  function applyOne(c: UWChallenge) {
    if (c.suggested_value == null) {
      toast("No numeric value suggested for this concern");
      return;
    }
    onApplyPatch({ [c.field]: c.suggested_value });
    setAppliedFields((prev) => new Set(prev).add(c.field));
    toast.success(`Applied ${c.field} = ${c.suggested_value}`);
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Claude reviews your model and flags concerns.
        </div>
        <Button
          size="sm"
          onClick={loadChallenges}
          disabled={loading}
          variant="outline"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          )}
          {challenges === null ? "Run Review" : "Re-run"}
        </Button>
      </div>

      {error && (
        <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-md p-2">
          {error}
        </div>
      )}

      {!loading && challenges === null && (
        <div className="text-[11px] text-muted-foreground py-8 text-center">
          Click <em>Run Review</em> to have Claude stress-test your
          assumptions.
        </div>
      )}

      {!loading && challenges !== null && challenges.length === 0 && (
        <div className="text-[11px] text-muted-foreground py-8 text-center">
          No concerns flagged — the model looks solid.
        </div>
      )}

      {challenges &&
        challenges.length > 0 &&
        challenges.map((c, i) => {
          const colors = SEVERITY_COLORS[c.severity];
          const isApplied = appliedFields.has(c.field);
          return (
            <div
              key={i}
              className={`border rounded-lg p-3 transition-all ${
                isApplied
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : `border-border/40 ${colors.bg}`
              }`}
            >
              <div className="flex items-start gap-2">
                {isApplied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors.dot}`} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[11px] font-semibold text-foreground">
                      {c.field}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {c.current_value}
                    </div>
                    {isApplied && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold uppercase tracking-wide">
                        Applied
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-foreground/90 mb-1">
                    {c.concern}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.suggestion}
                  </div>
                  {c.suggested_value != null && !isApplied && (
                    <button
                      onClick={() => applyOne(c)}
                      className="mt-2 flex items-center gap-1 text-[10px] text-primary hover:underline"
                    >
                      <Check className="h-2.5 w-2.5" />
                      Apply {c.field} = {c.suggested_value}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}

// ── What-If pane ──────────────────────────────────────────────────────────

function WhatIfPane({
  dealId,
  metrics,
  onApplyPatch,
}: {
  dealId: string;
  metrics: Record<string, unknown>;
  onApplyPatch: (patch: Record<string, number>) => void;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [history, setHistory] = useState<
    Array<{ q: string; r: WhatIfResult; applied: boolean }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [currentApplied, setCurrentApplied] = useState(false);

  async function handleSubmit() {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/copilot/whatif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, metrics }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to analyze");
        return;
      }
      setResult(json.data);
      setCurrentApplied(false);
      setHistory((h) =>
        [{ q: question, r: json.data, applied: false }, ...h].slice(0, 5)
      );
      setQuestion("");
    } catch {
      setError("Failed to analyze");
    } finally {
      setLoading(false);
    }
  }

  function applyPatch(r: WhatIfResult) {
    if (!r.field_changes || Object.keys(r.field_changes).length === 0) {
      toast("This scenario has no field changes to apply");
      return;
    }
    onApplyPatch(r.field_changes);
    setCurrentApplied(true);
    // Also mark in history
    setHistory((h) =>
      h.map((item) =>
        item.r === r ? { ...item, applied: true } : item
      )
    );
    toast.success(
      `Applied ${Object.keys(r.field_changes).length} field change${
        Object.keys(r.field_changes).length === 1 ? "" : "s"
      }`
    );
  }

  const suggestions = [
    "What if rents drop 5% in year 1?",
    "What if the exit cap expands 50bps?",
    "What if expenses run 10% over budget?",
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-muted-foreground">
        Ask a scenario in plain English — Claude proposes the field changes.
      </div>

      <div className="relative">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What if vacancy runs 3% higher than proforma?"
          rows={3}
          className="w-full px-3 py-2 text-xs bg-muted/20 border border-border/40 rounded-lg outline-none resize-none focus:border-primary/40 pr-10"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !question.trim()}
          className="absolute bottom-2 right-2 p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-30 hover:brightness-110 transition-all"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
        </button>
      </div>

      {!result && !loading && !history.length && (
        <div className="flex flex-col gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setQuestion(s)}
              className="text-left text-[11px] text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-muted/20 transition-colors flex items-center gap-1.5"
            >
              <ChevronRight className="h-3 w-3" />
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-md p-2">
          {error}
        </div>
      )}

      {result && (
        <WhatIfResultCard
          result={result}
          applied={currentApplied}
          onApply={() => applyPatch(result)}
        />
      )}

      {history.length > 1 && (
        <div className="pt-3 border-t border-border/30">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-2">
            Recent
          </div>
          <div className="space-y-2">
            {history.slice(1).map((h, i) => (
              <div
                key={i}
                className={`text-[11px] p-2 rounded-md ${
                  h.applied
                    ? "bg-emerald-500/5 border border-emerald-500/30"
                    : "text-muted-foreground bg-muted/10"
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="font-medium text-foreground/90 flex-1">
                    {h.q}
                  </div>
                  {h.applied && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold uppercase tracking-wide flex-shrink-0">
                      Applied
                    </span>
                  )}
                </div>
                <div className="line-clamp-2 text-muted-foreground">
                  {h.r.analysis}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WhatIfResultCard({
  result,
  applied,
  onApply,
}: {
  result: WhatIfResult;
  applied: boolean;
  onApply: () => void;
}) {
  const changes = Object.entries(result.field_changes);
  return (
    <div
      className={`border rounded-lg p-3 space-y-3 transition-all ${
        applied
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border/40 bg-primary/5"
      }`}
    >
      <div className="text-[11px] text-foreground/90 leading-relaxed">
        {result.analysis}
      </div>

      {changes.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
            {applied ? "Applied field changes" : "Proposed field changes"}
          </div>
          <div className="space-y-1">
            {changes.map(([k, v]) => (
              <div
                key={k}
                className={`flex items-center justify-between text-[11px] p-1.5 rounded ${
                  applied ? "bg-emerald-500/10" : "bg-muted/20"
                }`}
              >
                <span className="text-foreground font-mono">{k}</span>
                <span className={applied ? "text-emerald-300 font-medium" : "text-primary font-medium"}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.key_impacts.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
            Key impacts
          </div>
          <div className="space-y-1">
            {result.key_impacts.map((k, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-[11px]"
              >
                <span className="text-muted-foreground">{k.metric}</span>
                <span className="text-foreground">
                  <span className="text-muted-foreground/60">{k.before}</span>
                  {" \u2192 "}
                  <span className="font-medium">{k.after}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {changes.length > 0 && !applied && (
        <Button size="sm" onClick={onApply} className="w-full">
          <Check className="h-3.5 w-3.5 mr-1.5" />
          Apply to Model
        </Button>
      )}
      {applied && (
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-300 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Applied to model — remember to Save
        </div>
      )}
    </div>
  );
}

// ── Benchmarks pane ───────────────────────────────────────────────────────

function BenchmarksPane({
  dealId,
  uwData,
}: {
  dealId: string;
  uwData: Record<string, unknown>;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Benchmarks | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/copilot/benchmarks`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json.data || null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-4 text-[11px] text-muted-foreground">
        Benchmarks unavailable.
      </div>
    );
  }

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const rows: Array<{
    label: string;
    current: string;
    market: string;
    note?: string;
  }> = [];

  const currentVacancy = num(uwData.vacancy_rate);
  rows.push({
    label: "Vacancy Rate",
    current: currentVacancy != null ? `${currentVacancy}%` : "\u2014",
    market: `${data.defaults.vacancy_rate}%`,
    note: `${data.property_type || "multifamily"} default`,
  });

  if (data.submarket?.market_vacancy != null) {
    rows.push({
      label: "  \u21b3 Submarket",
      current: "",
      market: `${data.submarket.market_vacancy}%`,
      note: data.submarket.submarket_name || "",
    });
  }

  const currentRentGrowth = num(uwData.rent_growth_pct);
  rows.push({
    label: "Rent Growth",
    current: currentRentGrowth != null ? `${currentRentGrowth}%/yr` : "\u2014",
    market: `${data.defaults.rent_growth}%/yr`,
    note: `${data.property_type || "multifamily"} default`,
  });

  if (data.submarket?.market_rent_growth != null) {
    rows.push({
      label: "  \u21b3 Submarket",
      current: "",
      market: `${data.submarket.market_rent_growth}%/yr`,
      note: data.submarket.submarket_name || "",
    });
  }

  const currentExitCap = num(uwData.exit_cap_rate);
  rows.push({
    label: "Exit Cap Rate",
    current: currentExitCap != null ? `${currentExitCap}%` : "\u2014",
    market: `${data.defaults.cap_rate}%`,
    note: `${data.property_type || "multifamily"} default`,
  });

  if (data.submarket?.market_cap_rate != null) {
    rows.push({
      label: "  \u21b3 Submarket",
      current: "",
      market: `${data.submarket.market_cap_rate}%`,
      note: data.submarket.submarket_name || "",
    });
  }

  if (data.comps.sale?.median_cap_rate != null) {
    rows.push({
      label: "  \u21b3 Comps median",
      current: "",
      market: `${data.comps.sale.median_cap_rate.toFixed(2)}%`,
      note: `${data.comps.sale.count} sale comps`,
    });
  }

  const currentMgmt = num(uwData.management_fee_pct);
  rows.push({
    label: "Management Fee",
    current: currentMgmt != null ? `${currentMgmt}%` : "\u2014",
    market: `${data.defaults.management_fee_pct}%`,
    note: "of EGR",
  });

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-muted-foreground">
        Current values vs. property type defaults, submarket metrics, and
        workspace comp medians.
      </div>

      <div className="border border-border/40 rounded-lg overflow-hidden bg-card">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border/40 bg-muted/10">
              <th className="py-2 px-3 font-medium">Field</th>
              <th className="py-2 px-3 text-right font-medium">Current</th>
              <th className="py-2 px-3 text-right font-medium">Benchmark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/20 last:border-0">
                <td className="py-1.5 px-3">
                  <div
                    className={
                      r.label.startsWith("  \u21b3")
                        ? "text-muted-foreground"
                        : "text-foreground font-medium"
                    }
                  >
                    {r.label.replace("  \u21b3", "\u21b3")}
                  </div>
                </td>
                <td className="py-1.5 px-3 text-right font-mono text-foreground">
                  {r.current}
                </td>
                <td className="py-1.5 px-3 text-right">
                  <div className="font-mono text-foreground">{r.market}</div>
                  {r.note && (
                    <div className="text-[9px] text-muted-foreground/60">
                      {r.note}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.comps.sale && data.comps.sale.count > 0 && (
        <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/30">
          Based on {data.comps.sale.count} sale comps
          {data.comps.rent && data.comps.rent.count > 0
            ? ` and ${data.comps.rent.count} rent comps`
            : ""}{" "}
          from your workspace library.
        </div>
      )}
    </div>
  );
}
