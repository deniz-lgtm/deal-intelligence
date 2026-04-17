"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Loader2,
  Upload,
  ClipboardPaste,
  Trash2,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Building2,
  FileSearch,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Market Intelligence Panel
//
// Drag in (or paste) a broker research PDF — CBRE MarketBeat, JLL Research,
// Cushman & Wakefield, Colliers, Newmark, Marcus & Millichap, Berkadia,
// Yardi Matrix, RealPage — and the server runs extractMarketReport() to
// normalize it into structured submarket metrics. Reports accumulate as
// rows so the analyst can watch QoQ deltas on the metrics that matter.
//
// This panel intentionally does NOT scrape publishers; it deep-links their
// public research landing pages with a search-hint the analyst copies into
// the publisher's own search box. That keeps us off the wrong side of
// terms-of-service and gives the analyst the latest vintage.
// ─────────────────────────────────────────────────────────────────────────────

interface MarketReport {
  id: string;
  publisher: string | null;
  report_name: string | null;
  asset_class: string | null;
  msa: string | null;
  submarket: string | null;
  as_of_date: string | null;
  source_url: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  top_employers: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  top_deliveries: any[];
  narrative: string | null;
  created_at: string;
}

interface Suggestion {
  publisher: string;
  publisher_label: string;
  report_series: string;
  url: string;
  why: string;
  free: boolean;
  asset_classes: string[];
}

interface SuggestionsPayload {
  asset_class: string;
  market: string | null;
  search_hint: string;
  suggestions: Suggestion[];
}

// Metric rows rendered in the report card. Order reflects reader priority
// for a developer-focused audience (supply first, then rent, then pricing).
const METRIC_ROWS: Array<{ key: string; label: string; format: "pct" | "weeks" | "units" | "sf" | "money" | "money_per_unit" | "money_per_sf" }> = [
  { key: "vacancy_pct", label: "Vacancy", format: "pct" },
  { key: "occupancy_pct", label: "Occupancy", format: "pct" },
  { key: "under_construction_units", label: "Under Construction", format: "units" },
  { key: "under_construction_sf", label: "Under Construction", format: "sf" },
  { key: "deliveries_units_ytd", label: "Deliveries YTD", format: "units" },
  { key: "deliveries_sf_ytd", label: "Deliveries YTD", format: "sf" },
  { key: "absorption_units_ytd", label: "Absorption YTD", format: "units" },
  { key: "absorption_sf_ytd", label: "Absorption YTD", format: "sf" },
  { key: "rent_growth_yoy_pct", label: "Rent Growth YoY", format: "pct" },
  { key: "rent_growth_qoq_pct", label: "Rent Growth QoQ", format: "pct" },
  { key: "effective_rent_per_unit", label: "Effective Rent", format: "money_per_unit" },
  { key: "effective_rent_per_sf", label: "Effective Rent", format: "money_per_sf" },
  { key: "concessions_weeks", label: "Concessions", format: "weeks" },
  { key: "cap_rate_avg_pct", label: "Cap Rate (avg)", format: "pct" },
  { key: "price_per_unit_avg", label: "Avg $/Unit", format: "money" },
  { key: "price_per_sf_avg", label: "Avg $/SF", format: "money" },
  { key: "sales_volume_ytd", label: "Sales Volume YTD", format: "money" },
  { key: "job_growth_yoy_pct", label: "Job Growth", format: "pct" },
  { key: "unemployment_pct", label: "Unemployment", format: "pct" },
];

function formatMetric(val: unknown, fmt: string): string {
  if (val == null || val === "") return "—";
  const n = typeof val === "number" ? val : Number(val);
  if (isNaN(n)) return String(val);
  switch (fmt) {
    case "pct": return `${n.toFixed(1)}%`;
    case "weeks": return `${n.toFixed(1)} wks`;
    case "units": return `${Math.round(n).toLocaleString()} units`;
    case "sf": return `${Math.round(n).toLocaleString()} SF`;
    case "money": return `$${Math.round(n).toLocaleString()}`;
    case "money_per_unit": return `$${Math.round(n).toLocaleString()}/unit`;
    case "money_per_sf": return `$${n.toFixed(2)}/SF`;
    default: return String(val);
  }
}

function publisherLabel(p: string | null): string {
  if (!p) return "Report";
  const map: Record<string, string> = {
    cbre: "CBRE",
    jll: "JLL",
    cushman_wakefield: "Cushman & Wakefield",
    colliers: "Colliers",
    newmark: "Newmark",
    marcus_millichap: "Marcus & Millichap",
    berkadia: "Berkadia",
    yardi_matrix: "Yardi Matrix",
    realpage: "RealPage",
    costar: "CoStar",
    green_street: "Green Street",
    other: "Other",
  };
  return map[p] || p.toUpperCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function MarketIntelligencePanel({ dealId }: { dealId: string }) {
  const [reports, setReports] = useState<MarketReport[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePublisher, setPastePublisher] = useState<string>("");
  const [pasteUrl, setPasteUrl] = useState("");
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/market-reports`);
      const j = await res.json();
      if (Array.isArray(j.data)) {
        // Normalize JSONB fields that come back as strings depending on driver.
        const rows: MarketReport[] = j.data.map((r: MarketReport) => ({
          ...r,
          metrics: typeof r.metrics === "string" ? JSON.parse(r.metrics) : (r.metrics || {}),
          pipeline: typeof r.pipeline === "string" ? JSON.parse(r.pipeline) : (r.pipeline || []),
          top_employers: typeof r.top_employers === "string" ? JSON.parse(r.top_employers) : (r.top_employers || []),
          top_deliveries: typeof r.top_deliveries === "string" ? JSON.parse(r.top_deliveries) : (r.top_deliveries || []),
        }));
        setReports(rows);
      }
    } catch (e) {
      console.error("Failed to load market reports:", e);
    }
  }, [dealId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await fetchReports();
      try {
        const res = await fetch(`/api/deals/${dealId}/market-reports/suggestions`);
        const j = await res.json();
        if (mounted && j.data) setSuggestions(j.data);
      } catch (e) {
        console.error("Failed to load suggestions:", e);
      }
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [dealId, fetchReports]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/deals/${dealId}/market-reports`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Extraction failed");
        return;
      }
      toast.success("Market report extracted");
      await fetchReports();
    } catch (e) {
      console.error(e);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const uploadText = async () => {
    if (!pasteText.trim()) {
      toast.error("Paste the research text first");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/market-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: pasteText,
          source_url: pasteUrl || null,
          publisher: pastePublisher || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Extraction failed");
        return;
      }
      toast.success("Market report extracted");
      setPasteText("");
      setPasteUrl("");
      setPastePublisher("");
      setPasteMode(false);
      await fetchReports();
    } catch (e) {
      console.error(e);
      toast.error("Extraction failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteReport = async (id: string) => {
    if (!confirm("Delete this extracted market report?")) return;
    try {
      const res = await fetch(`/api/deals/${dealId}/market-reports/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Delete failed");
        return;
      }
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error("Delete failed");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("PDF files only");
      return;
    }
    uploadFile(file);
  };

  const copyHint = () => {
    if (!suggestions?.search_hint) return;
    navigator.clipboard.writeText(suggestions.search_hint);
    toast.success("Search hint copied");
  };

  // ── QoQ delta summary — shows the key metrics' trend across vintages so
  // the developer can see at a glance whether the submarket is softening,
  // stable, or tightening. Only renders if at least two reports exist.
  const qoqDeltas = useMemo(() => {
    if (reports.length < 2) return [];
    const keys = ["vacancy_pct", "rent_growth_yoy_pct", "cap_rate_avg_pct", "under_construction_units", "deliveries_units_ytd"];
    const labelMap: Record<string, string> = {
      vacancy_pct: "Vacancy",
      rent_growth_yoy_pct: "Rent Growth YoY",
      cap_rate_avg_pct: "Cap Rate",
      under_construction_units: "Under Construction",
      deliveries_units_ytd: "Deliveries YTD",
    };
    const out: Array<{ label: string; latest: string; prev: string; delta: number; direction: "up" | "down" | "flat"; goodBad: "good" | "bad" | "neutral" }> = [];
    for (const key of keys) {
      const series = reports
        .map((r) => ({ as_of: r.as_of_date, v: r.metrics[key] }))
        .filter((x) => x.v != null && x.v !== "");
      if (series.length < 2) continue;
      const latest = Number(series[0].v);
      const prev = Number(series[1].v);
      if (isNaN(latest) || isNaN(prev)) continue;
      const delta = latest - prev;
      const direction: "up" | "down" | "flat" = Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down";
      // For a developer, falling vacancy/UC/deliveries is good, rising rent growth is good.
      const goodBadMap: Record<string, "good" | "bad" | "neutral"> = {
        vacancy_pct: direction === "down" ? "good" : direction === "up" ? "bad" : "neutral",
        under_construction_units: direction === "down" ? "good" : direction === "up" ? "bad" : "neutral",
        deliveries_units_ytd: direction === "down" ? "good" : direction === "up" ? "bad" : "neutral",
        rent_growth_yoy_pct: direction === "up" ? "good" : direction === "down" ? "bad" : "neutral",
        cap_rate_avg_pct: direction === "down" ? "good" : direction === "up" ? "bad" : "neutral",
      };
      out.push({
        label: labelMap[key] || key,
        latest: String(series[0].v),
        prev: String(series[1].v),
        delta,
        direction,
        goodBad: goodBadMap[key] || "neutral",
      });
    }
    return out;
  }, [reports]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading market intelligence…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Suggested reports ──────────────────────────────────────────── */}
      {suggestions && suggestions.suggestions.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileSearch className="h-4 w-4 text-primary" />
                Recommended research to pull
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Free submarket reports for {suggestions.market || "this market"} ·{" "}
                {suggestions.asset_class.replace("_", " ")}. Open the publisher, search the hint, drop the PDF back here.
              </div>
            </div>
            {suggestions.search_hint && (
              <Button size="sm" variant="outline" onClick={copyHint} className="gap-1.5 text-[11px]">
                <ClipboardPaste className="h-3 w-3" />
                Copy search hint
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {suggestions.suggestions.map((s) => (
              <a
                key={s.publisher}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-2 p-2.5 rounded-md border border-border/40 bg-background/60 hover:bg-background hover:border-primary/40 transition-colors"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs font-medium truncate">
                    {s.publisher_label}
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{s.report_series}</div>
                  <div className="text-[10px] text-muted-foreground/80 mt-0.5 line-clamp-2">{s.why}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Upload zone ─────────────────────────────────────────────────── */}
      {!pasteMode ? (
        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragActive ? "border-primary bg-primary/5" : "border-border/40 bg-muted/10"
          }`}
        >
          <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <div className="text-sm font-medium">Drop a broker research PDF</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            We&apos;ll extract vacancy, rent growth, absorption, deliveries, supply pipeline, cap rates, and more.
          </div>
          <div className="flex items-center justify-center gap-2 mt-3">
            <label className="cursor-pointer">
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                  e.target.value = "";
                }}
              />
              <Button size="sm" variant="outline" asChild>
                <span className="gap-1.5">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Choose PDF
                </span>
              </Button>
            </label>
            <Button size="sm" variant="ghost" onClick={() => setPasteMode(true)} className="gap-1.5">
              <ClipboardPaste className="h-3.5 w-3.5" />
              Paste text instead
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/40 bg-muted/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Paste research text</div>
            <Button size="sm" variant="ghost" onClick={() => setPasteMode(false)}>
              Cancel
            </Button>
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder="Paste the full text of a research report (or just the relevant sections)…"
            className="w-full px-3 py-2 text-xs bg-background border border-border/40 rounded-md outline-none focus:border-primary/40 font-mono"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={pastePublisher}
              onChange={(e) => setPastePublisher(e.target.value)}
              className="px-3 py-2 text-xs bg-background border border-border/40 rounded-md outline-none"
            >
              <option value="">Publisher (optional)</option>
              <option value="cbre">CBRE</option>
              <option value="jll">JLL</option>
              <option value="cushman_wakefield">Cushman &amp; Wakefield</option>
              <option value="colliers">Colliers</option>
              <option value="newmark">Newmark</option>
              <option value="marcus_millichap">Marcus &amp; Millichap</option>
              <option value="berkadia">Berkadia</option>
              <option value="yardi_matrix">Yardi Matrix</option>
              <option value="realpage">RealPage</option>
              <option value="other">Other</option>
            </select>
            <input
              type="url"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              placeholder="Source URL (optional)"
              className="px-3 py-2 text-xs bg-background border border-border/40 rounded-md outline-none"
            />
          </div>
          <Button size="sm" onClick={uploadText} disabled={uploading} className="gap-1.5">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
            Extract
          </Button>
        </div>
      )}

      {/* ── Trend summary (QoQ deltas) ─────────────────────────────────── */}
      {qoqDeltas.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            Trend across {reports.length} vintages
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {qoqDeltas.map((d) => {
              const color = d.goodBad === "good" ? "text-emerald-400" : d.goodBad === "bad" ? "text-red-400" : "text-muted-foreground";
              const Arrow = d.direction === "up" ? TrendingUp : d.direction === "down" ? TrendingDown : null;
              return (
                <div key={d.label} className="rounded-md border border-border/30 bg-background/60 p-2.5">
                  <div className="text-[10px] text-muted-foreground">{d.label}</div>
                  <div className="text-sm font-semibold mt-0.5">{d.latest}</div>
                  <div className={`flex items-center gap-1 text-[10px] mt-0.5 ${color}`}>
                    {Arrow ? <Arrow className="h-3 w-3" /> : null}
                    <span>vs {d.prev}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Extracted reports ──────────────────────────────────────────── */}
      {reports.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center border border-dashed border-border/30 rounded-lg">
          <AlertCircle className="h-3.5 w-3.5" />
          No broker research extracted yet. Drop a PDF above to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-lg border border-border/40 bg-card overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-4 py-3 bg-muted/10">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {publisherLabel(r.publisher)}
                    </span>
                    <span className="text-sm font-semibold truncate">
                      {r.report_name || "Untitled report"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                    {r.as_of_date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(r.as_of_date)}
                      </span>
                    )}
                    {(r.submarket || r.msa) && (
                      <span>{[r.submarket, r.msa].filter(Boolean).join(" / ")}</span>
                    )}
                    {r.asset_class && <span className="capitalize">{r.asset_class.replace("_", " ")}</span>}
                    {r.source_url && (
                      <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-0.5">
                        source <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteReport(r.id)}
                  className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Delete report"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {r.narrative && (
                <div className="px-4 py-2.5 text-xs leading-relaxed text-muted-foreground border-b border-border/30">
                  {r.narrative}
                </div>
              )}

              {/* Metrics grid */}
              <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                {METRIC_ROWS.filter((m) => r.metrics[m.key] != null && r.metrics[m.key] !== "").map((m) => (
                  <div key={m.key} className="text-xs">
                    <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    <div className="font-semibold">{formatMetric(r.metrics[m.key], m.format)}</div>
                  </div>
                ))}
              </div>

              {/* Supply pipeline — the single thing a developer cares most about */}
              {r.pipeline && r.pipeline.length > 0 && (
                <div className="px-4 py-3 border-t border-border/30 bg-muted/5">
                  <div className="text-[11px] font-semibold text-muted-foreground mb-2">
                    SUPPLY PIPELINE ({r.pipeline.length})
                  </div>
                  <div className="space-y-1">
                    {r.pipeline.slice(0, 8).map((p, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="font-medium truncate">{p.project_name || "Unnamed"}</span>
                          {p.developer && <span className="text-muted-foreground text-[10px]">by {p.developer}</span>}
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground text-[10px] flex-shrink-0">
                          {p.units && <span>{p.units} units</span>}
                          {p.sf && !p.units && <span>{Number(p.sf).toLocaleString()} SF</span>}
                          {p.expected_delivery && <span>→ {p.expected_delivery}</span>}
                          {p.status && (
                            <span className="px-1.5 py-0.5 rounded bg-muted/30 capitalize">
                              {p.status.replace("_", " ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {r.pipeline.length > 8 && (
                      <div className="text-[10px] text-muted-foreground pt-1">
                        + {r.pipeline.length - 8} more projects
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={fetchReports} className="gap-1.5 text-[11px]">
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>
    </div>
  );
}
