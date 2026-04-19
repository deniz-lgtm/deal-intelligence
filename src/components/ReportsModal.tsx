"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Reports hub modal.
//
// Every time an investment-package or DD-abstract export runs, a row is
// written to generated_reports with a snapshot of the sections + metadata.
// This modal lists those rows for the current deal, newest first, and lets
// the analyst re-download the exact file or delete the record.
//
// Mounted on the investment-package page behind a "Reports" button so a
// second generation doesn't orphan the first — the first one is one click
// away whenever they want it.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from "react";
import {
  X,
  FileText,
  Download,
  Trash2,
  Loader2,
  FolderOpen,
  Presentation,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ReportRow {
  id: string;
  deal_id: string;
  title: string;
  report_type: string;
  format: string;
  audience: string | null;
  deal_name: string | null;
  section_count: number;
  file_size_bytes: number | null;
  created_at: string;
}

interface ReportsModalProps {
  dealId: string;
  open: boolean;
  onClose: () => void;
}

function prettyReportType(t: string): string {
  const map: Record<string, string> = {
    investment_memo: "Investment Memo",
    pitch_deck: "Pitch Deck",
    one_pager: "One-Pager",
    dd_abstract: "DD Abstract",
  };
  return map[t] || t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyAudience(a: string | null): string {
  if (!a) return "";
  const map: Record<string, string> = {
    investment_committee: "Investment Committee",
    lp_investor: "LP Investors",
    lender: "Lender",
    internal_review: "Internal Review",
  };
  return map[a] || a;
}

function formatBytes(b: number | null): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(reportType: string) {
  if (reportType === "pitch_deck") return Presentation;
  if (reportType === "dd_abstract") return ClipboardList;
  return FileText;
}

export default function ReportsModal({ dealId, open, onClose }: ReportsModalProps) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/reports`);
      const j = await res.json();
      if (Array.isArray(j.data)) setReports(j.data);
    } catch (e) {
      console.error("Failed to load reports:", e);
    } finally {
      setLoading(false);
    }
  }, [dealId, open]);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (row: ReportRow) => {
    setDownloadingId(row.id);
    try {
      const res = await fetch(`/api/deals/${dealId}/reports/${row.id}/download`);
      if (!res.ok) {
        toast.error("Download failed");
        return;
      }
      const blob = await res.blob();
      const ext = row.format === "docx" ? "docx" : "pptx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 80)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${ext.toUpperCase()} downloaded`);
    } catch (e) {
      console.error(e);
      toast.error("Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const remove = async (row: ReportRow) => {
    if (!confirm(`Delete "${row.title}" from Reports?`)) return;
    try {
      const res = await fetch(`/api/deals/${dealId}/reports/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Delete failed");
        return;
      }
      setReports((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      toast.error("Delete failed");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl border shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg">Reports</h2>
            <span className="text-xs text-muted-foreground">
              ({reports.length} {reports.length === 1 ? "report" : "reports"})
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border/40 rounded-lg">
              <FileText className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                No reports generated yet.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Export a memo, pitch deck, or DD abstract and it will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => {
                const Icon = iconFor(r.report_type);
                const dt = new Date(r.created_at);
                const dateLabel = dt.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                const isExpanded = expandedId === r.id;
                return (
                  <div
                    key={r.id}
                    className="border border-border/40 rounded-lg bg-background/60 overflow-hidden"
                  >
                    <div className="flex items-start gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate">
                            {r.title}
                          </span>
                          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">
                            {r.format}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                          <span>{prettyReportType(r.report_type)}</span>
                          {r.audience && (
                            <>
                              <span>·</span>
                              <span>{prettyAudience(r.audience)}</span>
                            </>
                          )}
                          <span>·</span>
                          <span>
                            {r.section_count} {r.section_count === 1 ? "section" : "sections"}
                          </span>
                          {r.file_size_bytes ? (
                            <>
                              <span>·</span>
                              <span>{formatBytes(r.file_size_bytes)}</span>
                            </>
                          ) : null}
                          <span>·</span>
                          <span>{dateLabel}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => download(r)}
                          disabled={downloadingId === r.id}
                          className="gap-1.5 text-xs"
                        >
                          {downloadingId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          Download
                        </Button>
                        <button
                          onClick={() => remove(r)}
                          className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                          title="Delete from Reports"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground px-4 py-2 border-t border-border/30 bg-muted/10 transition-colors"
                    >
                      {isExpanded ? "Hide" : "Show"} section list
                    </button>
                    {isExpanded && (
                      <SectionList
                        dealId={dealId}
                        reportId={r.id}
                        sectionCount={r.section_count}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Lazy-loads the full sections payload for a single report when the user
// expands the row. Fetches from the download route with a HEAD-style
// companion query — we reuse the reports list endpoint with a ?id= filter.
// Implemented here rather than inline so the list renders instantly even
// when reports carry long-form content.
function SectionList({
  dealId,
  reportId,
  sectionCount,
}: {
  dealId: string;
  reportId: string;
  sectionCount: number;
}) {
  const [sections, setSections] = useState<Array<{ id: string; title: string }> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/deals/${dealId}/reports/${reportId}/sections`);
        const j = await res.json();
        if (!cancelled && Array.isArray(j.data)) setSections(j.data);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId, reportId]);

  if (loading) {
    return (
      <div className="px-4 py-3 text-[11px] text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!sections || sections.length === 0) {
    return (
      <div className="px-4 py-3 text-[11px] text-muted-foreground">
        {sectionCount} sections saved (titles unavailable).
      </div>
    );
  }
  return (
    <div className="px-4 py-3 space-y-1">
      {sections.map((s, i) => (
        <div key={s.id || i} className="text-[11px] flex items-baseline gap-2">
          <span className="text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
          <span>{s.title}</span>
        </div>
      ))}
    </div>
  );
}
