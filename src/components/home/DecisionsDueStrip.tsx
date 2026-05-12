"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, ClipboardCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface DueItem {
  kind: "decision" | "draw";
  id: string;
  deal_id: string;
  deal_name: string;
  title: string;
  due_date: string | null;
  status: string | null;
  assigned_to: string | null;
}

function relativeDue(due: string | null): { label: string; tone: "overdue" | "soon" | "later" } {
  if (!due) return { label: "Open", tone: "later" };
  const d = new Date(due + "T00:00:00");
  if (Number.isNaN(d.getTime())) return { label: "Open", tone: "later" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: "Today", tone: "overdue" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days <= 7) return { label: `In ${days}d`, tone: "soon" };
  return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), tone: "later" };
}

const TONE_STYLE: Record<"overdue" | "soon" | "later", string> = {
  overdue: "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  soon: "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  later: "border-border/60 bg-muted/35 text-muted-foreground",
};

/**
 * A glanceable horizontal strip of decisions + draws coming due across every
 * accessible deal. Sits above the ScheduleHero on the Command Center. Empty
 * state collapses to nothing.
 */
export function DecisionsDueStrip() {
  const [items, setItems] = useState<DueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/home/decisions-due")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && Array.isArray(json.data)) setItems(json.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const overdueCount = useMemo(
    () =>
      items.filter(
        (i) => i.due_date && new Date(i.due_date + "T00:00:00").getTime() < new Date().setHours(0, 0, 0, 0)
      ).length,
    [items]
  );

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="border-b border-border/40 bg-card/35 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex shrink-0 items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Due this week
          </span>
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">
              <AlertCircle className="h-3 w-3" />
              {overdueCount} overdue
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {items.slice(0, 12).map((item) => {
            const due = relativeDue(item.due_date);
            const href =
              item.kind === "draw"
                ? `/deals/${item.deal_id}/construction/draws`
                : `/deals/${item.deal_id}/decisions`;
            const Icon = item.kind === "draw" ? Wallet : ClipboardCheck;
            return (
              <Link
                key={item.id}
                href={href}
                className={cn(
                  "inline-flex max-w-[280px] items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition hover:bg-background/60",
                  TONE_STYLE[due.tone]
                )}
                title={`${item.deal_name} — ${item.title}`}
              >
                <Icon className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate font-medium text-foreground/90">{item.deal_name}</span>
                <span className="truncate opacity-75">· {item.title}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider">{due.label}</span>
              </Link>
            );
          })}
          {items.length > 12 && (
            <span className="inline-flex items-center px-2 py-1 text-xs text-muted-foreground">
              +{items.length - 12} more
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
