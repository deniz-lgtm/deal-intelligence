"use client";

import { useMemo } from "react";
import { Calendar, User, AlertCircle, CheckCircle2, Circle, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TASK_KIND_CONFIG,
  TASK_PRIORITY_CONFIG,
  DEV_PHASE_STATUS_CONFIG,
  type DevPhase,
  type DevPhaseKind,
  type DevPhaseStatus,
} from "@/lib/types";
import { TaskKindChip } from "./TaskKindChip";

interface TaskListProps {
  tasks: DevPhase[];
  onSelect: (task: DevPhase) => void;
  onToggleStatus: (task: DevPhase) => void;
}

const STATUS_ICON: Record<DevPhaseStatus, typeof Circle> = {
  not_started: Circle,
  in_progress: Clock,
  complete: CheckCircle2,
  delayed: AlertCircle,
};

function isOverdue(task: DevPhase): boolean {
  if (task.status === "complete") return false;
  if (!task.end_date) return false;
  return new Date(task.end_date) < new Date(new Date().toDateString());
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TaskList({ tasks, onSelect, onToggleStatus }: TaskListProps) {
  // Group by status bucket: open (not_started + in_progress + delayed) vs complete.
  const { open, done } = useMemo(() => {
    const open: DevPhase[] = [];
    const done: DevPhase[] = [];
    for (const t of tasks) {
      if (t.status === "complete") done.push(t);
      else open.push(t);
    }
    // Open: overdue first, then by due date ascending, then created.
    open.sort((a, b) => {
      const aOver = isOverdue(a) ? 0 : 1;
      const bOver = isOverdue(b) ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      const aDue = a.end_date ? new Date(a.end_date).getTime() : Infinity;
      const bDue = b.end_date ? new Date(b.end_date).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    done.sort((a, b) => new Date(b.completed_at ?? b.updated_at).getTime() - new Date(a.completed_at ?? a.updated_at).getTime());
    return { open, done };
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/40 text-sm text-muted-foreground">
        No tasks yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Group label="Open" count={open.length}>
        {open.map((t) => (
          <TaskRow key={t.id} task={t} onSelect={onSelect} onToggleStatus={onToggleStatus} />
        ))}
      </Group>
      {done.length > 0 && (
        <Group label="Completed" count={done.length} muted>
          {done.map((t) => (
            <TaskRow key={t.id} task={t} onSelect={onSelect} onToggleStatus={onToggleStatus} dim />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, count, children, muted }: { label: string; count: number; children: React.ReactNode; muted?: boolean }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <div className={cn("flex items-center gap-2 px-1 pb-1 text-2xs font-medium uppercase tracking-[0.18em]", muted ? "text-muted-foreground/50" : "text-muted-foreground")}>
        <span>{label}</span>
        <span className="text-foreground/40">{count}</span>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function TaskRow({
  task,
  onSelect,
  onToggleStatus,
  dim,
}: {
  task: DevPhase;
  onSelect: (task: DevPhase) => void;
  onToggleStatus: (task: DevPhase) => void;
  dim?: boolean;
}) {
  const StatusIcon = STATUS_ICON[task.status] ?? Circle;
  const statusConfig = DEV_PHASE_STATUS_CONFIG[task.status];
  const overdue = isOverdue(task);
  const kind = (task.kind ?? "general") as DevPhaseKind;
  const isTaskKind = kind !== "phase" && kind !== "milestone";

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border/30 bg-card/50 px-3 py-2.5 transition-colors hover:border-border hover:bg-card",
        dim && "opacity-60",
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleStatus(task);
        }}
        className={cn("shrink-0 transition-colors", task.status === "complete" ? "text-emerald-400" : "text-muted-foreground/50 hover:text-foreground")}
        aria-label={task.status === "complete" ? "Mark incomplete" : "Mark complete"}
      >
        <StatusIcon className="h-4 w-4" />
      </button>

      <button
        onClick={() => onSelect(task)}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
      >
        <div className="flex w-full min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              task.status === "complete" && "line-through text-muted-foreground",
            )}
          >
            {task.label}
          </span>
          {isTaskKind && <TaskKindChip kind={kind} />}
          {task.priority && (
            <span className={cn("text-2xs font-medium uppercase tracking-[0.14em]", TASK_PRIORITY_CONFIG[task.priority].color)}>
              {TASK_PRIORITY_CONFIG[task.priority].label}
            </span>
          )}
        </div>
        <div className="flex w-full min-w-0 items-center gap-3 text-2xs text-muted-foreground">
          {task.end_date && (
            <span className={cn("flex items-center gap-1", overdue && "text-rose-400 font-medium")}>
              <Calendar className="h-3 w-3" />
              {formatDate(task.end_date)}
              {overdue && " · overdue"}
            </span>
          )}
          {task.task_owner && (
            <span className="flex items-center gap-1 truncate">
              <User className="h-3 w-3" />
              <span className="truncate">{task.task_owner}</span>
            </span>
          )}
          {task.task_category && <span className="truncate text-foreground/40">{task.task_category}</span>}
          {kind === "decision" && task.decision_choice && (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">
              Resolved: {task.decision_options?.find((o) => o.key === task.decision_choice)?.label ?? task.decision_choice}
            </span>
          )}
          {task.start_date && (
            <span className="rounded bg-muted/40 px-1.5 py-0.5 text-foreground/70">Scheduled</span>
          )}
          <span className={cn("ml-auto rounded px-1.5 py-0.5", statusConfig.color, statusConfig.bg)}>
            {statusConfig.label}
          </span>
        </div>
      </button>

      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
    </div>
  );
}
