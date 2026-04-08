"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Calendar, Loader2, AlertCircle, CircleDot } from "lucide-react";

interface UpcomingItem {
  kind: "milestone" | "task";
  id: string;
  deal_id: string;
  deal_name: string;
  deal_status: string;
  title: string;
  due_date: string;
  priority: string | null;
  assignee: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-blue-400",
  low: "text-zinc-400",
};

export function UpcomingMilestonesCard() {
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/workspace/upcoming-milestones?days=14")
      .then((r) => r.json())
      .then((j) => setItems(j.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="border border-border/40 rounded-lg bg-card/60 backdrop-blur-sm p-3 min-h-[180px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Upcoming — 14 days</span>
        </div>
        {items.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {items.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-6 text-center">
          Nothing due in the next two weeks. Add milestones + due dates from any
          deal's Project tab.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 6).map((item) => {
            const due = parseDue(item.due_date);
            return (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={`/deals/${item.deal_id}/project`}
                  className="flex items-start gap-2 text-[11px] hover:bg-muted/30 -mx-1 px-1 py-1 rounded transition-colors"
                >
                  {item.kind === "milestone" ? (
                    <CircleDot className="h-3 w-3 mt-0.5 text-primary flex-shrink-0" />
                  ) : (
                    <AlertCircle
                      className={`h-3 w-3 mt-0.5 flex-shrink-0 ${
                        item.priority ? PRIORITY_COLORS[item.priority] ?? "text-muted-foreground" : "text-muted-foreground"
                      }`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground truncate">{item.title}</div>
                    <div className="text-muted-foreground text-[10px] truncate">
                      {item.deal_name}
                    </div>
                  </div>
                  <div
                    className={`text-[10px] flex-shrink-0 ${
                      due.overdue ? "text-red-400" : due.soon ? "text-amber-400" : "text-muted-foreground"
                    }`}
                  >
                    {due.label}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function parseDue(dateStr: string): { label: string; overdue: boolean; soon: boolean } {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff < 0) return { label: `${Math.abs(diff)}d late`, overdue: true, soon: false };
  if (diff === 0) return { label: "today", overdue: false, soon: true };
  if (diff === 1) return { label: "tomorrow", overdue: false, soon: true };
  if (diff <= 3) return { label: `${diff}d`, overdue: false, soon: true };
  return { label: `${diff}d`, overdue: false, soon: false };
}
