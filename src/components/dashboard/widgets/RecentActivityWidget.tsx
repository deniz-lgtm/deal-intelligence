"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity as ActivityIcon, FileSearch, MessageSquare, Calculator, FileText, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: string;
  deal_id: string;
  deal_name: string;
}

const ICON: Record<string, typeof ActivityIcon> = {
  om_analysis: FileSearch,
  chat: MessageSquare,
  underwriting: Calculator,
  document: FileText,
  deal: Building2,
};

const COLOR: Record<string, string> = {
  om_analysis: "text-indigo-400 bg-indigo-500/10",
  chat: "text-blue-400 bg-blue-500/10",
  underwriting: "text-purple-400 bg-purple-500/10",
  document: "text-emerald-400 bg-emerald-500/10",
  deal: "text-primary bg-primary/10",
};

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RecentActivityWidget() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/activity")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && Array.isArray(j.data)) setEvents(j.data);
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
        <span className="font-nameplate text-base tracking-tight">Recent Activity</span>
        <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
          {events.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No recent activity.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.slice(0, 25).map((ev, idx) => {
              const Icon = ICON[ev.type] ?? ActivityIcon;
              const colorClass = COLOR[ev.type] ?? "text-muted-foreground bg-muted";
              return (
                <li key={`${ev.deal_id}-${idx}`}>
                  <Link
                    href={`/deals/${ev.deal_id}`}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
                  >
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", colorClass)}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-foreground/90">{ev.description}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                        <span className="truncate">{ev.deal_name}</span>
                        <span className="text-foreground/40">{formatRelative(ev.timestamp)}</span>
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
