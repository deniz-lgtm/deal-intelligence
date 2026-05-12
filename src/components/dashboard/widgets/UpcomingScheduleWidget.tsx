"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flag, GanttChart } from "lucide-react";

interface UpcomingRow {
  id: string;
  deal_id: string;
  deal_name: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  kind: string;
  track: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function UpcomingScheduleWidget() {
  const [rows, setRows] = useState<UpcomingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/home/upcoming-schedule")
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
        <span className="font-nameplate text-base tracking-tight">Upcoming Schedule</span>
        <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
          Next 30 days
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No upcoming milestones or phases in the next 30 days.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.slice(0, 20).map((row) => {
              const days = daysUntil(row.start_date);
              const Icon = row.kind === "milestone" ? Flag : GanttChart;
              return (
                <li key={row.id}>
                  <Link
                    href={`/deals/${row.deal_id}/schedule`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{row.label}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                        <span className="truncate">{row.deal_name}</span>
                        <span>{formatDate(row.start_date)}</span>
                        {days != null && (
                          <span className="text-foreground/50">
                            {days <= 0 ? "today" : `in ${days}d`}
                          </span>
                        )}
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
