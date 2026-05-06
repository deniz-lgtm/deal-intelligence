"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  MessageSquare,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSetPageContext } from "@/lib/page-context";
import {
  DEV_PHASE_STATUS_CONFIG,
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type DevPhaseStatus,
  type ScheduleTrack,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: DevPhaseStatus[] = [
  "not_started",
  "in_progress",
  "complete",
  "delayed",
];

const TRACK_BACK_HREF: Record<ScheduleTrack, (dealId: string) => string> = {
  acquisition: (dealId) => `/deals/${dealId}/schedule`,
  development: (dealId) => `/deals/${dealId}/project`,
  construction: (dealId) => `/deals/${dealId}/construction/schedule`,
};

export default function ScheduleFocusPage({
  params,
}: {
  params: { id: string; phaseId: string };
}) {
  const [items, setItems] = useState<DevPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    duration_days: 7,
    task_owner: "",
    status: "not_started" as DevPhaseStatus,
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(params.id)}/schedule`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load schedule");
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const parent = useMemo(
    () => items.find((item) => item.id === params.phaseId) ?? null,
    [items, params.phaseId]
  );
  const children = useMemo(
    () =>
      items
        .filter((item) => item.parent_phase_id === params.phaseId)
        .sort((a, b) => {
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999");
        }),
    [items, params.phaseId]
  );

  useSetPageContext(
    {
      dealId: params.id,
      route: "schedule-focus",
      screenSummary: parent
        ? `Focused schedule view for ${parent.label}. ${children.length} child tasks.`
        : "Focused schedule view loading.",
    },
    [params.id, parent?.id, parent?.label, children.length]
  );

  const backHref = parent
    ? TRACK_BACK_HREF[parent.track ?? "development"](params.id)
    : `/deals/${params.id}/project`;

  const createTask = async () => {
    if (!parent || !form.label.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(params.id)}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "task",
          track: parent.track ?? "development",
          parent_phase_id: parent.id,
          label: form.label.trim(),
          duration_days: Number(form.duration_days) || 0,
          task_owner: form.task_owner.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
          sort_order: children.length,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create task");
      setForm({
        label: "",
        duration_days: 7,
        task_owner: "",
        status: "not_started",
        notes: "",
      });
      setNotice("Task added to this mini schedule.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  const updateTask = async (taskId: string, updates: Partial<DevPhase>) => {
    setError(null);
    setNotice(null);
    const previous = items;
    setItems((current) =>
      current.map((item) => (item.id === taskId ? { ...item, ...updates } : item))
    );
    try {
      const res = await fetch(
        `/api/deals/${encodeURIComponent(params.id)}/schedule/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update task");
      setItems((current) =>
        current.map((item) => (item.id === taskId ? { ...item, ...json.data } : item))
      );
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!window.confirm("Remove this task from the mini schedule?")) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/deals/${encodeURIComponent(params.id)}/schedule/${encodeURIComponent(taskId)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to delete task");
      setItems((current) => current.filter((item) => item.id !== taskId));
      setNotice("Task removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  const exportFocusSchedule = () => {
    const url = `/api/deals/${encodeURIComponent(params.id)}/dev-schedule/export?format=xls&focus=${encodeURIComponent(params.phaseId)}`;
    window.open(url, "_blank");
  };

  const completeCount = children.filter((child) => child.status === "complete").length;
  const progress = children.length > 0 ? Math.round((completeCount / children.length) * 100) : 0;
  const blockedCount = children.filter((child) => child.status === "delayed").length;
  const openDecisionCount = children.filter((child) => {
    const text = `${child.label} ${child.notes ?? ""}`.toLowerCase();
    return child.status !== "complete" && /\b(decide|decision|approve|approval|select|confirm|review)\b/.test(text);
  }).length;
  const assistantPrompt = parent
    ? `Use the Development Playbook and this focused mini schedule for "${parent.label}". What decisions are open, what tasks should be added or clarified, and what is the next owner/action to keep this phase moving?`
    : "Review this focused mini schedule and identify the next owner/action.";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to full schedule
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {parent?.label ?? "Mini schedule"}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {parent
              ? `${SCHEDULE_TRACK_LABELS[parent.track ?? "development"]} focus view for the tasks inside this phase.`
              : "Loading the focused schedule."}
          </p>
          {parent?.notes && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
              {parent.notes}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Progress</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{progress}%</span>
              <span className="text-xs text-muted-foreground">
                {completeCount}/{children.length} complete
              </span>
            </div>
          </div>
          <Link href={`/deals/${params.id}/chat?prompt=${encodeURIComponent(assistantPrompt)}`}>
            <Button size="sm" className="w-full gap-2">
              <MessageSquare className="h-4 w-4" />
              Ask assistant
            </Button>
          </Link>
          <Button size="sm" variant="outline" className="w-full gap-2" onClick={exportFocusSchedule}>
            <Download className="h-4 w-4" />
            Export mini schedule
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading mini schedule
        </div>
      ) : !parent ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          This schedule item was not found.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Tasks</h2>
            </div>
            {children.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No child tasks yet. Add the first task to break this phase into a working mini schedule.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {children.map((child) => (
                  <TaskRow
                    key={child.id}
                    task={child}
                    onUpdate={(updates) => updateTask(child.id, updates)}
                    onDelete={() => deleteTask(child.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-4 h-fit">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Open items</h2>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniMetric label="Tasks" value={children.filter((child) => child.status !== "complete").length} />
                <MiniMetric label="Decisions" value={openDecisionCount} />
                <MiniMetric label="Delayed" value={blockedCount} tone={blockedCount > 0 ? "warning" : "default"} />
              </div>
              <div className="mt-4 space-y-2">
                {children.filter((child) => child.status !== "complete").slice(0, 4).map((child) => (
                  <div key={child.id} className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                    <div className="line-clamp-2 text-xs font-medium leading-5">{child.label}</div>
                    <div className="mt-0.5 text-2xs text-muted-foreground">
                      {child.task_owner || "No owner"} · {DEV_PHASE_STATUS_CONFIG[child.status].label}
                    </div>
                  </div>
                ))}
                {children.every((child) => child.status === "complete") && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Nothing open inside this phase right now.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Add task</h2>
              <div className="mt-4 space-y-3">
              <Field label="Task">
                <input
                  value={form.label}
                  onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                  placeholder="e.g. Architect redline review"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Duration">
                  <input
                    type="number"
                    min={0}
                    value={form.duration_days}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, duration_days: Number(e.target.value) }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, status: e.target.value as DevPhaseStatus }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {DEV_PHASE_STATUS_CONFIG[status].label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Owner">
                <input
                  value={form.task_owner}
                  onChange={(e) => setForm((prev) => ({ ...prev, task_owner: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                  placeholder="PM, architect, counsel"
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="min-h-[92px]"
                  placeholder="What needs to happen or be decided?"
                />
              </Field>
              <Button
                type="button"
                onClick={createTask}
                disabled={saving || !form.label.trim()}
                className="w-full gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add to mini schedule
              </Button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <div className={cn("rounded-lg border p-2 text-center", tone === "warning" ? "border-amber-500/30 bg-amber-500/10" : "border-border/60 bg-background/60")}>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
    </div>
  );
}

function TaskRow({
  task,
  onUpdate,
  onDelete,
}: {
  task: DevPhase;
  onUpdate: (updates: Partial<DevPhase>) => void;
  onDelete: () => void;
}) {
  const cfg = DEV_PHASE_STATUS_CONFIG[task.status];
  return (
    <div className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(220px,1fr)_130px_140px_120px_32px] lg:items-center">
      <div className="min-w-0">
        <input
          defaultValue={task.label}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== task.label) onUpdate({ label: next });
          }}
          className="w-full bg-transparent text-sm font-medium outline-none hover:text-primary focus:text-primary"
        />
        <input
          defaultValue={task.task_owner ?? ""}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== (task.task_owner ?? null)) onUpdate({ task_owner: next });
          }}
          className="mt-1 w-full bg-transparent text-xs text-muted-foreground outline-none"
          placeholder="Owner"
        />
      </div>
      <select
        value={task.status}
        onChange={(e) => onUpdate({ status: e.target.value as DevPhaseStatus })}
        className={cn(
          "h-9 rounded-lg border px-2 text-xs outline-none",
          cfg.color,
          cfg.bg
        )}
      >
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {DEV_PHASE_STATUS_CONFIG[status].label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          defaultValue={task.duration_days ?? 0}
          onBlur={(e) => {
            const next = Number(e.target.value) || 0;
            if (next !== (task.duration_days ?? 0)) onUpdate({ duration_days: next });
          }}
          className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
        />
        <span className="text-xs text-muted-foreground">days</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <div>{task.start_date ?? "No start"}</div>
        <div>{task.end_date ?? "No finish"}</div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="text-muted-foreground hover:text-destructive lg:justify-self-end"
        aria-label="Delete task"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <div className="lg:col-span-5">
        <Textarea
          defaultValue={task.notes ?? ""}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== (task.notes ?? null)) onUpdate({ notes: next });
          }}
          className="min-h-[60px] text-xs"
          placeholder="Notes"
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
