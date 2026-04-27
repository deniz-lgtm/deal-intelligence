"use client";

import { useState } from "react";
import {
  Loader2,
  UploadCloud,
  Check,
  ArrowRight,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface PreviewRow {
  phase_key: string;
  label: string;
  is_canonical: boolean;
  existing_phase_id: string | null;
  existing_start_date: string | null;
  existing_duration_days: number | null;
  proposed_start_date: string | null;
  proposed_duration_days: number;
  source_quote: string | null;
  confidence: "high" | "medium" | "low";
}

type RowAction = "apply" | "keep_existing" | "skip";

interface Props {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitted: () => void;
}

/**
 * Two-step Acquisition-doc importer:
 *
 *   1. Upload an LOI / PSA / broker schedule / email PDF or text. The
 *      server runs the extractor (acq-schedule-extract.ts) and returns
 *      one PreviewRow per detected acq event, paired with the deal's
 *      current value for that phase.
 *
 *   2. The dialog renders existing-vs-proposed side-by-side. The
 *      analyst picks one of three actions per row:
 *
 *        - apply         → take the proposed value (PATCH or CREATE)
 *        - keep_existing → leave the deal's current value alone
 *        - skip          → drop the row entirely
 *
 *      Default action is "apply" for high-confidence rows that don't
 *      conflict with an existing value, and "keep_existing" when the
 *      proposed value differs from what's already on the deal.
 *
 * Mirrors GcScheduleImportDialog visually so analysts who use the GC
 * importer recognize the pattern, but the conflict-aware row UI is
 * specific to the Acq side where every phase usually exists already
 * (from Seed Default Phases) and the doc is updating dates rather
 * than seeding from scratch.
 */
export default function AcqScheduleImportDialog({
  dealId,
  open,
  onOpenChange,
  onCommitted,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string>("");
  const [actions, setActions] = useState<Record<string, RowAction>>({});

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSourceFilename("");
    setActions({});
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/deals/${dealId}/acq-schedule/import`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) {
        const msg = j.detail
          ? `${j.error || "Failed to extract"}: ${j.detail}`
          : j.error || "Failed to extract";
        toast.error(msg);
        return;
      }
      const rows: PreviewRow[] = Array.isArray(j.data?.rows) ? j.data.rows : [];
      setSourceFilename(j.data?.source_filename || file.name);
      if (rows.length === 0) {
        toast.error("No acquisition dates found in that document.");
        setPreview([]);
        return;
      }
      setPreview(rows);
      // Default action per row:
      //  - apply       → no conflict OR no existing value, and confidence isn't low
      //  - keep_existing → conflict (proposed differs from existing) — let the analyst opt in
      //  - skip        → low-confidence rows
      const initial: Record<string, RowAction> = {};
      for (const r of rows) {
        if (r.confidence === "low") {
          initial[r.phase_key] = "skip";
          continue;
        }
        const conflict =
          r.existing_phase_id &&
          ((r.existing_start_date ?? null) !== r.proposed_start_date ||
            (r.existing_duration_days ?? null) !== r.proposed_duration_days);
        initial[r.phase_key] = conflict ? "keep_existing" : "apply";
      }
      setActions(initial);
    } catch (err) {
      toast.error((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const rows = preview.map((r) => ({
      action: actions[r.phase_key] ?? "skip",
      phase_key: r.phase_key,
      label: r.label,
      start_date: r.proposed_start_date,
      duration_days: r.proposed_duration_days,
      source_quote: r.source_quote,
    }));
    const applyCount = rows.filter((r) => r.action === "apply").length;
    if (applyCount === 0) {
      toast.error("Select at least one row to apply.");
      return;
    }
    setCommitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/acq-schedule/import/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json();
      if (!res.ok) {
        const msg = j.detail
          ? `${j.error || "Failed to commit"}: ${j.detail}`
          : j.error || "Failed to commit";
        toast.error(msg);
        return;
      }
      const total = j.data?.total ?? applyCount;
      toast.success(
        `Acquisition schedule updated · ${total} phase${total === 1 ? "" : "s"} applied`
      );
      onCommitted();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error((err as Error).message || "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Acquisition dates from doc</DialogTitle>
          <DialogDescription>
            Upload an LOI, PSA, broker timeline, or any acquisition-side
            document. We&apos;ll pull dates and durations and let you pick
            row-by-row whether to apply each one to the schedule.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="py-4">
            <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 cursor-pointer hover:border-primary/50 transition-colors">
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {file ? file.name : "Click to select a PDF or text file"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  LOI, PSA, broker schedule, email — the model picks out the dates
                </p>
              </div>
              <input
                type="file"
                accept="application/pdf,text/plain,.txt,.eml,.md"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="gap-1.5"
              >
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {uploading ? "Extracting…" : "Extract dates"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{sourceFilename}</span>
              <span>·</span>
              <span>
                {preview.length} acquisition row{preview.length === 1 ? "" : "s"} extracted
              </span>
            </div>

            {preview.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <span>
                  No acquisition dates were extracted from this document. Try a more
                  date-dense doc (LOI / PSA) or seed the schedule manually with the
                  Default Phases button.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {preview.map((r) => (
                  <RowCard
                    key={r.phase_key}
                    row={r}
                    action={actions[r.phase_key] ?? "skip"}
                    onAction={(a) =>
                      setActions((prev) => ({ ...prev, [r.phase_key]: a }))
                    }
                  />
                ))}
              </div>
            )}

            <div className="flex justify-between items-center gap-2 pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={reset}>
                Start over
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCommit}
                  disabled={committing || preview.length === 0}
                  className="gap-1.5"
                >
                  {committing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Apply{" "}
                  {Object.values(actions).filter((a) => a === "apply").length}{" "}
                  selected
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RowCard({
  row,
  action,
  onAction,
}: {
  row: PreviewRow;
  action: RowAction;
  onAction: (a: RowAction) => void;
}) {
  const conflict =
    row.existing_phase_id &&
    ((row.existing_start_date ?? null) !== row.proposed_start_date ||
      (row.existing_duration_days ?? null) !== row.proposed_duration_days);
  const isNew = !row.existing_phase_id;

  return (
    <div
      className={`rounded-md border p-3 space-y-2 ${
        action === "apply"
          ? "border-primary/40 bg-primary/5"
          : action === "skip"
            ? "border-border opacity-60"
            : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{row.label}</span>
            {!row.is_canonical && (
              <Badge variant="outline" className="text-2xs">
                Custom phase
              </Badge>
            )}
            {isNew && (
              <Badge variant="outline" className="text-2xs">
                Will create
              </Badge>
            )}
            {row.confidence !== "high" && (
              <Badge
                variant="outline"
                className={`text-2xs ${
                  row.confidence === "low"
                    ? "text-amber-400 border-amber-400/40"
                    : "text-muted-foreground"
                }`}
              >
                {row.confidence} confidence
              </Badge>
            )}
          </div>
          <p className="text-2xs font-mono text-muted-foreground mt-0.5">
            {row.phase_key}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <ActionBtn
            label="Apply"
            active={action === "apply"}
            onClick={() => onAction("apply")}
          />
          {row.existing_phase_id && (
            <ActionBtn
              label="Keep existing"
              active={action === "keep_existing"}
              onClick={() => onAction("keep_existing")}
            />
          )}
          <ActionBtn
            label="Skip"
            active={action === "skip"}
            onClick={() => onAction("skip")}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center text-xs">
        <div className="rounded bg-muted/30 px-2 py-1.5">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-0.5">
            Existing
          </p>
          {row.existing_phase_id ? (
            <p className="font-mono">
              {row.existing_start_date ?? "—"}
              {row.existing_duration_days != null
                ? ` · ${row.existing_duration_days}d`
                : ""}
            </p>
          ) : (
            <p className="text-muted-foreground italic">Not on deal yet</p>
          )}
        </div>
        <ArrowRight
          className={`h-3.5 w-3.5 mx-auto ${
            conflict ? "text-amber-400" : "text-muted-foreground/50"
          }`}
        />
        <div
          className={`rounded px-2 py-1.5 ${
            action === "apply" ? "bg-primary/10" : "bg-muted/30"
          }`}
        >
          <p className="text-2xs uppercase tracking-wide text-muted-foreground mb-0.5">
            Proposed
          </p>
          <p className="font-mono">
            {row.proposed_start_date ?? "—"} · {row.proposed_duration_days}d
          </p>
        </div>
      </div>

      {row.source_quote && (
        <blockquote className="text-2xs text-muted-foreground italic border-l-2 border-border pl-2 line-clamp-2">
          “{row.source_quote}”
        </blockquote>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-2xs px-2 py-1 rounded border transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
