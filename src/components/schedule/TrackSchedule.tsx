"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  GanttChart,
  Flag,
  AlertTriangle,
  UploadCloud,
  ArrowUpRight,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type DevPhaseStatus,
  type ScheduleTrack,
} from "@/lib/types";
import GcScheduleImportDialog from "./GcScheduleImportDialog";
import { ScheduleSeedWizard } from "./ScheduleSeedWizard";

interface Props {
  dealId: string;
  track: ScheduleTrack;
  /**
   * Short blurb shown under the heading — e.g. "Deal-stage milestones
   * from call-for-offers through close." Gives each of the three track
   * pages a distinct purpose.
   */
  description?: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Lean schedule component used by the Acquisition and Construction
 * pages. Renders a CPM-aware table (no nested children, no entitlement
 * templates) plus a simple gantt strip. The Development page keeps the
 * richer DevelopmentSchedule component since it owns entitlement
 * tasks / CEQA / AI suggestions.
 */
export default function TrackSchedule({ dealId, track, description }: Props) {
  const [phases, setPhases] = useState<DevPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  // Wizard opened from EmptyState — replaces the legacy "seed
  // everything in this track" flow with bundle-by-bundle opt-in.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Edit/new-phase dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DevPhase | null>(null);
  const [form, setForm] = useState({
    label: "",
    start_date: "",
    duration_days: 30,
    predecessor_id: "",
    lag_days: 0,
    is_milestone: false,
    status: "not_started" as DevPhaseStatus,
    notes: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule?track=${track}`);
      const j = await res.json();
      setPhases(Array.isArray(j.data) ? j.data : []);
    } catch (err) {
      console.error("TrackSchedule load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId, track]);

  useEffect(() => { load(); }, [load]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: new Date().toISOString().split("T")[0] }),
      });
      if (!res.ok) throw new Error("seed failed");
      await load();
      toast.success("Default schedule seeded");
    } catch {
      toast.error("Could not seed schedule");
    } finally {
      setSeeding(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({
      label: "",
      start_date: "",
      duration_days: 14,
      predecessor_id: "",
      lag_days: 0,
      is_milestone: false,
      status: "not_started",
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (p: DevPhase) => {
    setEditing(p);
    setForm({
      label: p.label,
      start_date: p.start_date ?? "",
      duration_days: p.duration_days ?? 30,
      predecessor_id: p.predecessor_id ?? "",
      lag_days: p.lag_days ?? 0,
      is_milestone: p.is_milestone === true,
      status: p.status,
      notes: p.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim()) {
      toast.error("Label required");
      return;
    }
    const payload = {
      label: form.label.trim(),
      start_date: form.start_date || null,
      duration_days: form.is_milestone ? 0 : Number(form.duration_days) || 0,
      predecessor_id: form.predecessor_id || null,
      lag_days: Number(form.lag_days) || 0,
      is_milestone: form.is_milestone,
      status: form.status,
      notes: form.notes || null,
      track,
      sort_order: phases.length,
    };
    try {
      const res = editing
        ? await fetch(`/api/deals/${dealId}/dev-schedule/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/deals/${dealId}/dev-schedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error("save failed");
      setDialogOpen(false);
      await load();
      toast.success(editing ? "Phase updated" : "Phase added");
    } catch {
      toast.error("Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this phase?")) return;
    try {
      await fetch(`/api/deals/${dealId}/dev-schedule/${id}`, { method: "DELETE" });
      await load();
    } catch {
      toast.error("Delete failed");
    }
  };

  // ── Bulk selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = (allIds: string[]) => {
    setSelectedIds((prev) => {
      // Toggle: if everything visible is already selected, clear; otherwise select all visible.
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} ${ids.length === 1 ? "phase" : "phases"}? This can't be undone.`)) return;
    setBulkDeleting(true);
    // Fire deletes in parallel — the server-side recompute runs once
    // per request so on big batches there's some redundant CPM work,
    // but it's correct (idempotent on no-op recomputes) and saves us
    // building a new bulk endpoint.
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/deals/${dealId}/dev-schedule/${id}`, { method: "DELETE" }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setBulkDeleting(false);
    clearSelection();
    await load();
    if (failed > 0) toast.error(`${failed} delete${failed === 1 ? "" : "s"} failed`);
    else toast.success(`Deleted ${ids.length} ${ids.length === 1 ? "phase" : "phases"}`);
  };

  // Candidate predecessors for the dialog dropdown — include cross-track
  // phases too so analysts can chain, e.g., Construction mobilization off
  // of Dev GC selection.
  const [allPhases, setAllPhases] = useState<DevPhase[]>([]);
  useEffect(() => {
    // Pulled separately from the filtered `phases` state so the
    // dropdown can offer cross-track predecessors without bloating the
    // main table.
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/dev-schedule`);
        const j = await res.json();
        setAllPhases(Array.isArray(j.data) ? j.data : []);
      } catch {}
    })();
  }, [dealId, phases]);

  const visiblePhases = useMemo(() => {
    return [...phases].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      const ad = a.start_date ?? "9999";
      const bd = b.start_date ?? "9999";
      return ad.localeCompare(bd);
    });
  }, [phases]);

  const ganttRange = useMemo(() => {
    const dates = phases
      .flatMap((p) => [p.start_date, p.end_date])
      .filter((d): d is string => !!d)
      .sort();
    if (dates.length === 0) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [phases]);

  const trackLabel = SCHEDULE_TRACK_LABELS[track];
  const isEmpty = !loading && phases.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <GanttChart className="h-5 w-5 text-primary" />
            {trackLabel} Schedule
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {track === "construction" && phases.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              className="gap-1.5"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              Upload GC schedule
            </Button>
          )}
          {/* Always-on seed-bundles button — lets the user add a new
              bundle (e.g. "IC checkpoints") to a track that already
              has phases, without recreating duplicates. EmptyState's
              big seed button still appears when the track is empty. */}
          {phases.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWizardOpen(true)}
              className="gap-1.5"
            >
              <Calendar className="h-3.5 w-3.5" />
              Seed bundles
            </Button>
          )}
          <Button size="sm" onClick={openNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add phase
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {trackLabel.toLowerCase()} schedule…
        </div>
      ) : isEmpty ? (
        <EmptyState
          trackLabel={trackLabel}
          onSeed={() => setWizardOpen(true)}
          seeding={seeding}
          onImport={track === "construction" ? () => setImportOpen(true) : undefined}
        />
      ) : (
        <>
          {selectedIds.size > 0 && (
            <BulkActionBar
              count={selectedIds.size}
              onDelete={handleBulkDelete}
              onCancel={clearSelection}
              busy={bulkDeleting}
            />
          )}
          <PhaseTable
            dealId={dealId}
            phases={visiblePhases}
            allPhases={allPhases}
            onEdit={openEdit}
            onDelete={handleDelete}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={() => selectAll(visiblePhases.map((p) => p.id))}
          />
          {ganttRange && <GanttStrip phases={visiblePhases} range={ganttRange} />}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "Add"} {trackLabel.toLowerCase()} phase</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Label">
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
                placeholder="e.g. Site Walk"
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={form.is_milestone}
                onChange={(e) => setForm((f) => ({ ...f, is_milestone: e.target.checked }))}
              />
              Point-in-time milestone (no duration)
            </label>
            {!form.is_milestone && (
              <Field label="Duration (days)">
                <input
                  type="number"
                  min={0}
                  value={form.duration_days}
                  onChange={(e) => setForm((f) => ({ ...f, duration_days: Number(e.target.value) }))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
                />
              </Field>
            )}
            <Field label="Predecessor (optional)">
              <select
                value={form.predecessor_id}
                onChange={(e) => setForm((f) => ({ ...f, predecessor_id: e.target.value }))}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
              >
                <option value="">— none (anchor with start date) —</option>
                {allPhases
                  .filter((p) => p.id !== editing?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      [{SCHEDULE_TRACK_LABELS[p.track ?? "development"]}] {p.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={form.predecessor_id ? "Lag (days after predecessor)" : "Start date"}>
              {form.predecessor_id ? (
                <input
                  type="number"
                  value={form.lag_days}
                  onChange={(e) => setForm((f) => ({ ...f, lag_days: Number(e.target.value) }))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
                />
              ) : (
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
                />
              )}
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as DevPhaseStatus }))}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
                <option value="delayed">Delayed</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? "Save changes" : "Add phase"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {track === "construction" && (
        <GcScheduleImportDialog
          dealId={dealId}
          open={importOpen}
          onOpenChange={setImportOpen}
          onCommitted={() => { void load(); }}
        />
      )}

      {/* Bundle-pick wizard. Replaces the per-track "Seed defaults"
          one-click that filled this track's chain with no choice; the
          user can now seed Acq Purchase only, or Dev Design only, etc. */}
      <ScheduleSeedWizard
        dealId={dealId}
        dealName=""
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSeeded={() => { void load(); }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function BulkActionBar({
  count,
  onDelete,
  onCancel,
  busy,
}: {
  count: number;
  onDelete: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 mb-2 rounded-md border border-primary/30 bg-primary/[0.06]">
      <span className="text-xs tabular-nums">
        <span className="font-medium text-foreground">{count}</span>{" "}
        <span className="text-muted-foreground">
          {count === 1 ? "phase" : "phases"} selected
        </span>
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-xs text-muted-foreground/80 hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onDelete}
          disabled={busy}
          className="gap-1.5 h-7"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Delete {count}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  trackLabel,
  onSeed,
  seeding,
  onImport,
}: {
  trackLabel: string;
  onSeed: () => void;
  seeding: boolean;
  onImport?: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <GanttChart className="h-10 w-10 mx-auto text-muted-foreground/40" />
      <p className="text-sm font-medium mt-3">No {trackLabel.toLowerCase()} phases yet</p>
      <p className="text-xs text-muted-foreground mt-1">
        Seed the standard template to get started, or add your own phases from scratch.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button size="sm" onClick={onSeed} disabled={seeding} className="gap-1.5">
          {seeding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Seed default schedule
        </Button>
        {onImport && (
          <Button size="sm" variant="outline" onClick={onImport} className="gap-1.5">
            <UploadCloud className="h-3.5 w-3.5" />
            Upload GC schedule
          </Button>
        )}
      </div>
    </div>
  );
}

function PhaseTable({
  dealId,
  phases,
  allPhases,
  onEdit,
  onDelete,
  selectedIds,
  onToggleSelect,
  onSelectAll,
}: {
  dealId: string;
  phases: DevPhase[];
  allPhases: DevPhase[];
  onEdit: (p: DevPhase) => void;
  onDelete: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
}) {
  const predecessorLabel = (id: string | null): string => {
    if (!id) return "—";
    const p = allPhases.find((x) => x.id === id);
    if (!p) return "—";
    const cross = (p.track ?? "development");
    return cross ? `${SCHEDULE_TRACK_LABELS[cross]} · ${p.label}` : p.label;
  };
  const allSelected = phases.length > 0 && phases.every((p) => selectedIds.has(p.id));
  const someSelected = !allSelected && phases.some((p) => selectedIds.has(p.id));

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 w-9">
              {/* Select-all — clicking toggles every visible row.
                  indeterminate ≈ "some but not all" via JS-set property
                  (HTML doesn't have an attribute for it). */}
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={onSelectAll}
                aria-label={allSelected ? "Clear selection" : "Select all phases"}
                className="h-3.5 w-3.5 rounded border-border/60 cursor-pointer"
              />
            </th>
            <th className="text-left px-3 py-2 font-medium">Phase</th>
            <th className="text-left px-3 py-2 font-medium">Start</th>
            <th className="text-left px-3 py-2 font-medium">Finish</th>
            <th className="text-left px-3 py-2 font-medium">Predecessor</th>
            <th className="text-left px-3 py-2 font-medium">Slack</th>
            <th className="text-right px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr
              key={p.id}
              className={cn(
                "border-t hover:bg-muted/20",
                selectedIds.has(p.id) && "bg-primary/[0.04]",
              )}
            >
              <td className="px-3 py-2 w-9">
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={() => onToggleSelect(p.id)}
                  aria-label={`Select ${p.label}`}
                  className="h-3.5 w-3.5 rounded border-border/60 cursor-pointer"
                />
              </td>
              <td className="px-3 py-2">
                <button
                  className="font-medium hover:underline text-left"
                  onClick={() => onEdit(p)}
                >
                  {p.is_milestone && <Flag className="inline h-3 w-3 mr-1 text-primary" />}
                  {p.label}
                </button>
                {!p.parent_phase_id && (
                  <a
                    href={`/deals/${dealId}/schedule/focus/${p.id}`}
                    className="ml-2 inline-flex items-center gap-0.5 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary/80 transition-colors hover:bg-primary/15 hover:text-primary"
                    title="Open focused task plan"
                    aria-label={`Open focused task plan for ${p.label}`}
                  >
                    <ArrowUpRight className="h-2.5 w-2.5" />
                  </a>
                )}
                {p.is_critical && (
                  <Badge variant="outline" className="ml-2 border-red-500/40 text-red-400 text-[10px]">
                    <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Critical
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.start_date)}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.end_date)}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{predecessorLabel(p.predecessor_id)}</td>
              <td className="px-3 py-2 text-xs">
                {p.total_slack_days == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : p.total_slack_days === 0 ? (
                  <span className="text-red-400 font-medium">0d</span>
                ) : (
                  <span className="text-muted-foreground">{p.total_slack_days}d</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => onDelete(p.id)}
                  className="text-muted-foreground hover:text-red-400"
                  aria-label="Delete phase"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GanttStrip({
  phases,
  range,
}: {
  phases: DevPhase[];
  range: { start: string; end: string };
}) {
  const startMs = new Date(range.start + "T00:00:00").getTime();
  const endMs = new Date(range.end + "T00:00:00").getTime();
  const total = Math.max(1, endMs - startMs);

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span>Timeline</span>
        <span>{fmtShort(range.start)} → {fmtShort(range.end)}</span>
      </div>
      <div className="space-y-1">
        {phases.map((p) => {
          if (!p.start_date || !p.end_date) return null;
          const s = new Date(p.start_date + "T00:00:00").getTime();
          const e = new Date(p.end_date + "T00:00:00").getTime();
          const left = ((s - startMs) / total) * 100;
          const width = Math.max(0.5, ((e - s) / total) * 100);
          return (
            <div key={p.id} className="relative h-5 flex items-center">
              <div
                className={cn(
                  "absolute h-3 rounded-sm",
                  p.is_critical
                    ? "bg-red-500/60 border border-red-400"
                    : p.status === "complete"
                    ? "bg-emerald-500/50"
                    : p.status === "in_progress"
                    ? "bg-blue-500/50"
                    : "bg-zinc-500/40",
                  p.is_milestone && "h-3 w-3 rotate-45 rounded-none"
                )}
                style={p.is_milestone ? { left: `calc(${left}% - 6px)` } : { left: `${left}%`, width: `${width}%` }}
                title={`${p.label} · ${fmtShort(p.start_date)} → ${fmtShort(p.end_date)}${p.is_critical ? " · critical" : ""}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Re-export a small schedule-view switcher for page-level use.
export function OtherTrackLinks({
  dealId,
  current,
}: {
  dealId: string;
  current: ScheduleTrack;
}) {
  const hrefs: Record<ScheduleTrack, string> = {
    acquisition: `/deals/${dealId}/schedule/acquisition`,
    development: `/deals/${dealId}/project`,
    construction: `/deals/${dealId}/construction/schedule`,
  };
  const tracks: ScheduleTrack[] = ["acquisition", "development", "construction"];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="uppercase tracking-wide text-[10px]">Schedule views</span>
      <a
        href={`/deals/${dealId}/schedule`}
        className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        Master
        <ArrowUpRight className="h-3 w-3" />
      </a>
      {tracks.map((t) => (
        <a
          key={t}
          href={hrefs[t]}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors",
            t === current
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
          aria-current={t === current ? "page" : undefined}
        >
          {SCHEDULE_TRACK_LABELS[t]}
          {t !== current && <ArrowUpRight className="h-3 w-3" />}
        </a>
      ))}
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground">
        Row arrow
        <ArrowUpRight className="h-3 w-3" />
        focused task plan
      </span>
    </div>
  );
}
