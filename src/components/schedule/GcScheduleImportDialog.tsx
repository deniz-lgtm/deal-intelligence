"use client";

import { useState } from "react";
import { Loader2, UploadCloud, FileText, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ExtractedPhase {
  label: string;
  start_date: string | null;
  duration_days: number;
  /** phase_key of the preceding activity (in this extracted set) — null if none. */
  predecessor_key: string | null;
  phase_key: string;
}

interface Props {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitted: () => void;
}

/**
 * Two-step GC schedule import: (1) upload PDF, server extracts via
 * Claude and returns a preview list; (2) analyst toggles rows and
 * chooses replace-vs-append before committing. We never write phases
 * to the DB from step 1 — the preview keeps the analyst in the loop.
 */
export default function GcScheduleImportDialog({
  dealId,
  open,
  onOpenChange,
  onCommitted,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ExtractedPhase[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setMode("replace");
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/import`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "extract failed");
      const rows: ExtractedPhase[] = Array.isArray(j.data) ? j.data : [];
      if (rows.length === 0) {
        toast.error("No activities found in that PDF.");
        return;
      }
      setPreview(rows);
      // Pre-select everything — analyst opts rows out rather than in.
      setSelected(new Set(rows.map((r) => r.phase_key)));
    } catch (err) {
      toast.error((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const approved = preview.filter((r) => selected.has(r.phase_key));
    if (approved.length === 0) {
      toast.error("Select at least one row.");
      return;
    }
    setCommitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/import/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, phases: approved }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "commit failed");
      toast.success(`${approved.length} activities imported`);
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
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import GC schedule (PDF)</DialogTitle>
          <DialogDescription>
            Upload a construction schedule PDF — P6, MS Project, or any printed gantt.
            We&apos;ll extract activities and durations so you can review before committing.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="py-4">
            <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 cursor-pointer hover:border-primary/50 transition-colors">
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {file ? file.name : "Click to select a PDF"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDFs only for now — Excel / MPP support coming soon
                </p>
              </div>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleUpload} disabled={!file || uploading} className="gap-1.5">
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {uploading ? "Extracting…" : "Extract activities"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {preview.length} activities extracted
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  Replace existing construction schedule
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  />
                  Append
                </label>
              </div>
            </div>

            <div className="rounded-lg border max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-8" />
                    <th className="text-left px-3 py-2 font-medium">Activity</th>
                    <th className="text-left px-3 py-2 font-medium">Start</th>
                    <th className="text-right px-3 py-2 font-medium">Duration</th>
                    <th className="text-left px-3 py-2 font-medium">Predecessor</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => {
                    const checked = selected.has(r.phase_key);
                    return (
                      <tr key={r.phase_key} className="border-t">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.phase_key);
                                else next.delete(r.phase_key);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">{r.label}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.start_date ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {r.duration_days}d
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {r.predecessor_key ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={reset}>
                Start over
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCommit} disabled={committing} className="gap-1.5">
                  {committing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Import {selected.size} activit{selected.size === 1 ? "y" : "ies"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
