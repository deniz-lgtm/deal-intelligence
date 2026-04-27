"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  UploadCloud,
  Check,
  ArrowRight,
  AlertTriangle,
  FileText,
  FolderOpen,
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
import { DOCUMENT_CATEGORIES } from "@/lib/types";
import type { DocumentCategory } from "@/lib/types";

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

interface DealDocument {
  id: string;
  original_name: string;
  category: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}

interface Props {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitted: () => void;
}

// Document categories likely to contain acq dates. We surface these
// first in the picker; everything else is grouped under "Other".
const ACQ_RELEVANT_CATEGORIES: DocumentCategory[] = [
  "legal",
  "om",
  "title_ownership",
  "financial",
];

/**
 * Two-step Acquisition-doc importer:
 *
 *   1. Pick a doc — fresh upload OR from the deal's existing document
 *      repository. The repository tab pulls /api/deals/[id]/documents
 *      and surfaces acquisition-relevant categories first.
 *
 *   2. The server runs the extractor and returns one PreviewRow per
 *      detected acq event, paired with the deal's current value for
 *      that phase. The dialog renders existing-vs-proposed side-by-
 *      side. Per-row action: Apply / Keep existing / Skip.
 *
 *      Default actions:
 *        - low confidence → Skip
 *        - existing has a value AND proposed differs → Keep existing
 *          (real conflict — analyst opts in to overwrite)
 *        - everything else → Apply (fresh fills, matching values)
 *
 *      The "fresh fill" case (existing null, proposed real) defaults
 *      to Apply; previously it defaulted to Keep existing because the
 *      conflict check treated "null vs date" as a conflict, which
 *      meant nothing landed when the user hit the Apply button.
 *
 * If the deal has no acq phases yet the commit endpoint auto-seeds
 * the seven canonical defaults first so every patch lands on a row
 * with predecessor chains already wired.
 */
export default function AcqScheduleImportDialog({
  dealId,
  open,
  onOpenChange,
  onCommitted,
}: Props) {
  const [step, setStep] = useState<"pick" | "preview">("pick");
  const [pickerTab, setPickerTab] = useState<"upload" | "library">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<DealDocument[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string>("");
  const [actions, setActions] = useState<Record<string, RowAction>>({});
  // Default mode is replace — clean state every time. Analysts who
  // hand-tune the schedule and just want to layer in fresh dates flip
  // to merge.
  const [mode, setMode] = useState<"replace" | "merge">("replace");

  const reset = () => {
    setStep("pick");
    setPickerTab("upload");
    setFile(null);
    setPreview(null);
    setSourceFilename("");
    setActions({});
    setMode("replace");
  };

  // Lazy-load the deal's documents the first time the user switches
  // to the Library tab. Avoids a round-trip on dialog open for users
  // who only ever upload fresh.
  useEffect(() => {
    if (!open || pickerTab !== "library" || docs !== null || docsLoading) return;
    setDocsLoading(true);
    fetch(`/api/deals/${dealId}/documents`)
      .then((r) => r.json())
      .then((j) => setDocs(Array.isArray(j.data) ? j.data : []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [open, pickerTab, dealId, docs, docsLoading]);

  /**
   * Run a fresh File through the extractor. Used by both upload and
   * library-pick paths — the library path fetches the existing doc's
   * bytes via /api/documents/[id]/view, wraps them as a File, and
   * funnels into the same code path.
   */
  const extractFromFile = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
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
      setSourceFilename(j.data?.source_filename || f.name);
      if (rows.length === 0) {
        toast.error("No acquisition dates found in that document.");
        setPreview([]);
        setStep("preview");
        return;
      }
      setPreview(rows);
      setActions(defaultActions(rows));
      setStep("preview");
    } catch (err) {
      toast.error((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    await extractFromFile(file);
  };

  const handlePickDoc = async (doc: DealDocument) => {
    setUploading(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/view`);
      if (!res.ok) throw new Error("Could not load that document");
      const blob = await res.blob();
      const f = new File([blob], doc.original_name, {
        type: doc.mime_type || blob.type || "application/octet-stream",
      });
      await extractFromFile(f);
    } catch (err) {
      toast.error((err as Error).message || "Could not load document");
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
        body: JSON.stringify({ rows, mode }),
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
      const seeded = j.data?.auto_seeded
        ? " · seeded the canonical Acq chain first"
        : "";
      toast.success(
        `Acquisition schedule updated · ${total} phase${total === 1 ? "" : "s"} applied${seeded}`
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
            Pull dates from an LOI, PSA, broker timeline, or any acquisition-
            side document — uploaded fresh or already on the deal. We&apos;ll
            extract the dates and let you confirm row-by-row before applying.
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="py-2">
            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4 border-b border-border/40">
              <TabBtn
                label="Upload"
                icon={<UploadCloud className="h-3.5 w-3.5" />}
                active={pickerTab === "upload"}
                onClick={() => setPickerTab("upload")}
              />
              <TabBtn
                label="From deal documents"
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                active={pickerTab === "library"}
                onClick={() => setPickerTab("library")}
              />
            </div>

            {pickerTab === "upload" ? (
              <div className="space-y-4">
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

                <div className="flex justify-end gap-2 pt-2">
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
              <DocLibraryPicker
                docs={docs}
                loading={docsLoading || uploading}
                onPick={handlePickDoc}
                onCancel={() => onOpenChange(false)}
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{sourceFilename}</span>
              {preview && preview.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {preview.length} acquisition row
                    {preview.length === 1 ? "" : "s"} extracted
                  </span>
                </>
              )}
            </div>

            {preview && preview.length > 0 && (
              <div className="rounded-md border border-border/60 p-3 space-y-2">
                <p className="text-xs font-medium">Apply to schedule</p>
                <div className="space-y-1.5">
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={mode === "replace"}
                      onChange={() => setMode("replace")}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Replace acquisition schedule</span>
                      <span className="text-muted-foreground block text-2xs mt-0.5">
                        Wipes existing acq phases, re-seeds the seven canonical
                        defaults with predecessor chains, then applies dates from
                        this doc. Recommended for first imports and to clean up
                        broken schedules.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={mode === "merge"}
                      onChange={() => setMode("merge")}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Merge with existing</span>
                      <span className="text-muted-foreground block text-2xs mt-0.5">
                        Patches existing rows by phase key, creates rows for new
                        events, repairs missing predecessor links. Use when
                        you&apos;ve hand-tuned the schedule and just want to
                        layer in fresh dates.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            )}

            {!preview || preview.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <span>
                  No acquisition dates were extracted from this document. Try a
                  more date-dense doc (LOI / PSA) or seed the schedule manually
                  with the Default Phases button.
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
                  disabled={committing || !preview || preview.length === 0}
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

/**
 * Determine the default action for each preview row.
 *
 *  - low confidence → Skip
 *  - existing has a real value AND proposed differs → Keep existing
 *    (real conflict — analyst opts in to overwrite)
 *  - everything else → Apply (covers fresh fills where existing is
 *    null, and matching values where there's nothing to change)
 */
function defaultActions(rows: PreviewRow[]): Record<string, RowAction> {
  const out: Record<string, RowAction> = {};
  for (const r of rows) {
    if (r.confidence === "low") {
      out[r.phase_key] = "skip";
      continue;
    }
    const existingHasValue =
      r.existing_phase_id &&
      (r.existing_start_date != null || (r.existing_duration_days ?? 0) > 0);
    const conflict =
      existingHasValue &&
      ((r.existing_start_date ?? null) !== r.proposed_start_date ||
        (r.existing_duration_days ?? null) !== r.proposed_duration_days);
    out[r.phase_key] = conflict ? "keep_existing" : "apply";
  }
  return out;
}

function TabBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-[1px] ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function DocLibraryPicker({
  docs,
  loading,
  onPick,
  onCancel,
}: {
  docs: DealDocument[] | null;
  loading: boolean;
  onPick: (doc: DealDocument) => void;
  onCancel: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }
  if (!docs || docs.length === 0) {
    return (
      <div className="text-center py-10 space-y-2">
        <p className="text-sm text-muted-foreground">
          No documents on this deal yet.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Upload one through the Documents tab, or use the Upload tab here.
        </p>
        <div className="pt-3">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Acquisition-relevant categories first, others last. Within each
  // group, newest first.
  const sorted = [...docs].sort((a, b) => {
    const aRelevant = ACQ_RELEVANT_CATEGORIES.includes(
      a.category as DocumentCategory
    );
    const bRelevant = ACQ_RELEVANT_CATEGORIES.includes(
      b.category as DocumentCategory
    );
    if (aRelevant !== bRelevant) return aRelevant ? -1 : 1;
    return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pick any document on this deal. We&apos;ll extract acquisition dates
        from it. PDFs and text files work; images and spreadsheets aren&apos;t
        supported yet.
      </p>
      <div className="rounded-lg border border-border/60 max-h-80 overflow-y-auto divide-y divide-border/30">
        {sorted.map((doc) => {
          const cat = DOCUMENT_CATEGORIES[doc.category as DocumentCategory];
          const isAcqRelevant = ACQ_RELEVANT_CATEGORIES.includes(
            doc.category as DocumentCategory
          );
          const isSupported =
            doc.mime_type === "application/pdf" ||
            doc.mime_type.startsWith("text/") ||
            /\.(pdf|txt|eml|md)$/i.test(doc.original_name);
          return (
            <button
              key={doc.id}
              onClick={() => isSupported && onPick(doc)}
              disabled={!isSupported}
              className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                isSupported
                  ? "hover:bg-card/40 cursor-pointer"
                  : "opacity-50 cursor-not-allowed"
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {doc.original_name}
                  </span>
                  {cat && (
                    <Badge
                      variant="outline"
                      className={`text-2xs ${
                        isAcqRelevant ? "border-primary/40 text-primary" : ""
                      }`}
                    >
                      {cat.icon} {cat.label}
                    </Badge>
                  )}
                  {!isSupported && (
                    <Badge variant="outline" className="text-2xs text-muted-foreground">
                      Unsupported format
                    </Badge>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {new Date(doc.uploaded_at).toLocaleDateString()}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
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
  const existingHasValue =
    row.existing_phase_id &&
    (row.existing_start_date != null || (row.existing_duration_days ?? 0) > 0);
  const conflict =
    existingHasValue &&
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
