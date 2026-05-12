"use client";

import { useEffect, useState } from "react";
import { X, Calendar, Trash2, CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TASK_KIND_CONFIG,
  TASK_PRIORITY_CONFIG,
  DEV_PHASE_STATUS_CONFIG,
  type DevPhase,
  type DevPhaseKind,
  type DevPhaseStatus,
  type TaskPriority,
} from "@/lib/types";
import { toast } from "sonner";

interface TaskDrawerProps {
  dealId: string;
  task: DevPhase | null;
  open: boolean;
  onClose: () => void;
  onSaved: (task: DevPhase) => void;
  onDeleted: (taskId: string) => void;
  defaultKind?: DevPhaseKind;
}

const EDITABLE_KINDS: DevPhaseKind[] = ["task", "general", "diligence", "decision"];

export function TaskDrawer({ dealId, task, open, onClose, onSaved, onDeleted, defaultKind = "general" }: TaskDrawerProps) {
  const isEdit = task != null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<DevPhaseKind>(defaultKind);
  const [status, setStatus] = useState<DevPhaseStatus>("not_started");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [dueDate, setDueDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [taskOwner, setTaskOwner] = useState("");
  const [category, setCategory] = useState("");
  const [decisionOptions, setDecisionOptions] = useState<{ key: string; label: string }[]>([]);
  const [decisionChoice, setDecisionChoice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.label);
      setDescription(task.description ?? "");
      setKind((task.kind ?? "general") as DevPhaseKind);
      setStatus(task.status);
      setPriority(task.priority ?? "");
      setDueDate(task.end_date ?? "");
      setStartDate(task.start_date ?? "");
      setTaskOwner(task.task_owner ?? "");
      setCategory(task.task_category ?? "");
      setDecisionOptions(task.decision_options ?? []);
      setDecisionChoice(task.decision_choice ?? "");
    } else {
      setTitle("");
      setDescription("");
      setKind(defaultKind);
      setStatus("not_started");
      setPriority("");
      setDueDate("");
      setStartDate("");
      setTaskOwner("");
      setCategory("");
      setDecisionOptions([]);
      setDecisionChoice("");
    }
  }, [open, task, defaultKind]);

  if (!open) return null;

  const save = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        label: title.trim(),
        description: description.trim() || null,
        kind,
        status,
        priority: priority || null,
        end_date: dueDate || null,
        due_date: dueDate || null,
        start_date: startDate || null,
        task_owner: taskOwner.trim() || null,
        task_category: category.trim() || null,
        decision_options: kind === "decision" ? decisionOptions : null,
        decision_choice: kind === "decision" ? decisionChoice || null : null,
      };
      const url = isEdit
        ? `/api/deals/${dealId}/unified-tasks/${task!.id}`
        : `/api/deals/${dealId}/unified-tasks`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed");
      }
      const json = await res.json();
      onSaved(json.data);
      toast.success(isEdit ? "Task updated" : "Task created");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (!confirm("Delete this task?")) return;
    try {
      const res = await fetch(`/api/deals/${dealId}/unified-tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      onDeleted(task.id);
      toast.success("Task deleted");
      onClose();
    } catch {
      toast.error("Failed to delete task");
    }
  };

  const convertToScheduled = async () => {
    if (!task) return;
    // Default the start to today and end to whatever's already set as
    // due_date — or +1 day if there's no due_date yet. The user can
    // refine on the gantt afterwards.
    const today = new Date().toISOString().slice(0, 10);
    const end = dueDate || today;
    setStartDate(today);
    try {
      const res = await fetch(`/api/deals/${dealId}/unified-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: today, end_date: end, kind: "task" }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      onSaved(json.data);
      toast.success("Task scheduled — visible on the Master Schedule");
    } catch {
      toast.error("Failed to schedule task");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-border/60 bg-card shadow-lifted"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-5 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h2 className="font-nameplate text-lg leading-none tracking-tight">
              {isEdit ? "Edit Task" : "New Task"}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to happen?"
                className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as DevPhaseKind)}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
                >
                  {EDITABLE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TASK_KIND_CONFIG[k as Exclude<DevPhaseKind, "phase" | "milestone">].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DevPhaseStatus)}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
                >
                  {(Object.keys(DEV_PHASE_STATUS_CONFIG) as DevPhaseStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {DEV_PHASE_STATUS_CONFIG[s].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {(Object.keys(TASK_PRIORITY_CONFIG) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {TASK_PRIORITY_CONFIG[p].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due Date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
                />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Optional context, links, instructions…"
                className="w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner (free-text)">
                <input
                  value={taskOwner}
                  onChange={(e) => setTaskOwner(e.target.value)}
                  placeholder="Assignee name"
                  className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Category">
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Title, CEQA"
                  className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </Field>
            </div>

            {kind === "decision" && (
              <Field label="Decision Options">
                <DecisionOptionsEditor
                  options={decisionOptions}
                  onChange={setDecisionOptions}
                  selectedKey={decisionChoice}
                  onSelect={setDecisionChoice}
                />
              </Field>
            )}

            {isEdit && (
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                    Schedule
                  </span>
                  {!startDate && (
                    <Button variant="ghost" size="sm" onClick={convertToScheduled} className="h-7 text-xs">
                      <Calendar className="mr-1.5 h-3.5 w-3.5" /> Convert to scheduled
                    </Button>
                  )}
                </div>
                {startDate ? (
                  <div className="text-xs text-muted-foreground">
                    Scheduled from <span className="text-foreground">{startDate}</span>
                    {dueDate && (
                      <>
                        {" "}to <span className="text-foreground">{dueDate}</span>
                      </>
                    )}{" "}
                    — appears on the Master Schedule.
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Unscheduled. Convert to scheduled to add this task to the gantt.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 px-5 py-3">
          {isEdit ? (
            <Button variant="ghost" size="sm" onClick={remove} className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </Button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              {saving ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-2xs font-medium uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function DecisionOptionsEditor({
  options,
  onChange,
  selectedKey,
  onSelect,
}: {
  options: { key: string; label: string }[];
  onChange: (next: { key: string; label: string }[]) => void;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="radio"
            checked={selectedKey === opt.key}
            onChange={() => onSelect(opt.key)}
            className="h-4 w-4"
            aria-label="Select this option"
          />
          <input
            value={opt.label}
            onChange={(e) => {
              const next = [...options];
              next[idx] = { ...next[idx], label: e.target.value };
              onChange(next);
            }}
            placeholder={`Option ${idx + 1}`}
            className="flex-1 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
          />
          <button
            onClick={() => onChange(options.filter((_, i) => i !== idx))}
            className="text-muted-foreground hover:text-rose-400"
            aria-label="Remove option"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...options, { key: `opt_${Date.now().toString(36)}`, label: "" }])}
        className={cn(
          "rounded-md border border-dashed border-border/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground",
        )}
      >
        + Add option
      </button>
    </div>
  );
}
