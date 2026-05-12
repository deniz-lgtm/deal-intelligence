"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Calendar, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TASK_KIND_CONFIG, type DevPhaseKind } from "@/lib/types";

interface DueRow {
  id: string;
  deal_id: string;
  deal_name: string;
  title: string;
  due_date: string | null;
  status: string;
  kind: string;
  priority: string | null;
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function formatDate(iso: string | null): string {
  if (!iso) return "No due date";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TasksDueWidget() {
  const [rows, setRows] = useState<DueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/home/tasks-due")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && Array.isArray(j.data)) setRows(j.data);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <span className="font-nameplate text-base tracking-tight">Tasks Due</span>
        <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
          {rows.length} open
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            All clear — no tasks due in the next 14 days.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.slice(0, 20).map((row) => {
              const overdue = isOverdue(row.due_date);
              const kind = (row.kind ?? "general") as DevPhaseKind;
              const kindConfig = kind !== "phase" && kind !== "milestone" ? TASK_KIND_CONFIG[kind] : null;
              return (
                <li key={row.id}>
                  <Link
                    href={`/deals/${row.deal_id}/tasks`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
                  >
                    {overdue ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    ) : (
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="truncate font-medium">{row.title}</span>
                        {kindConfig && (
                          <span className={cn("shrink-0 text-2xs uppercase tracking-[0.12em]", kindConfig.accent)}>
                            {kindConfig.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                        <span className="truncate">{row.deal_name}</span>
                        <span className={cn(overdue && "text-rose-400 font-medium")}>
                          {formatDate(row.due_date)}
                          {overdue ? " · overdue" : ""}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
