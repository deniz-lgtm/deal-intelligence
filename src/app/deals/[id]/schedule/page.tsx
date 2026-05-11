"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Flag,
  Loader2,
  Search,
  UserCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, titleCase } from "@/lib/utils";
import type { DevPhase, DevPhaseStatus, ScheduleTrack } from "@/lib/types";
import { SCHEDULE_TRACK_LABELS } from "@/lib/types";

type TrackFilter = "all" | ScheduleTrack;
type StatusFilter = "all" | DevPhaseStatus | "missing";

const TRACK_COLORS: Record<ScheduleTrack, string> = {
  acquisition: "text-[hsl(var(--phase-acq))] bg-[hsl(var(--phase-acq))]/10 border-[hsl(var(--phase-acq))]/25",
  development: "text-[hsl(var(--phase-dev))] bg-[hsl(var(--phase-dev))]/10 border-[hsl(var(--phase-dev))]/25",
  construction: "text-[hsl(var(--phase-con))] bg-[hsl(var(--phase-con))]/10 border-[hsl(var(--phase-con))]/25",
};

const TRACK_HREFS: Record<ScheduleTrack, (dealId: string) => string> = {
  acquisition: (dealId) => `/deals/${dealId}/schedule/acquisition`,
  development: (dealId) => `/deals/${dealId}/project`,
  construction: (dealId) => `/deals/${dealId}/construction/schedule`,
};

export default function MasterSchedulePage({ params }: { params: { id: string } }) {
  const [items, setItems] = useState<DevPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/deals/${params.id}/schedule`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load schedule");
        if (!cancelled) setItems(Array.isArray(json.data) ? json.data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load schedule");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const parentIds = useMemo(() => new Set(items.map((item) => item.parent_phase_id).filter(Boolean) as string[]), [items]);
  const topLevel = useMemo(() => items.filter((item) => !item.parent_phase_id), [items]);
  const sortedItems = useMemo(() => [...items].sort(compareScheduleItems), [items]);
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedItems.filter((item) => {
      const track = item.track || "development";
      if (trackFilter !== "all" && track !== trackFilter) return false;
      if (statusFilter === "missing") {
        if (item.start_date && item.end_date && item.task_owner) return false;
      } else if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return [item.label, item.task_owner, item.notes, item.task_category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [sortedItems, trackFilter, statusFilter, search]);

  const nextItems = sortedItems
    .filter((item) => item.status !== "complete" && !item.parent_phase_id)
    .slice(0, 5);
  const criticalItems = sortedItems.filter((item) => item.is_critical && item.status !== "complete");
  const missingDateItems = items.filter((item) => !item.start_date || !item.end_date);
  const missingOwnerItems = items.filter((item) => item.status !== "complete" && !item.task_owner && !item.assignee_user_id);
  const focusPlans = topLevel.filter((item) => parentIds.has(item.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-200">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Master Schedule</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            One rollup across acquisition, development, and construction. Track
            schedules are editable lenses over the same rows; focused plans are
            drilldowns under a master row.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton href={`/api/deals/${params.id}/dev-schedule/export?format=xls`} label="Full Excel" />
          <ExportButton href={`/api/deals/${params.id}/dev-schedule/export?format=csv`} label="CSV" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {(["acquisition", "development", "construction"] as ScheduleTrack[]).map((track) => (
          <TrackSummaryCard
            key={track}
            dealId={params.id}
            track={track}
            items={items.filter((item) => (item.track || "development") === track)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-xl border border-border/60 bg-card shadow-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Next Across Deal</h2>
              <p className="mt-1 text-xs text-muted-foreground">The next open top-level items across all tracks.</p>
            </div>
            <Link href={`/deals/${params.id}/chat?prompt=${encodeURIComponent("Review the master schedule. What is missing, what is risky, and what should become a focused task plan? Keep it concise before changing anything.")}`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                Ask assistant
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <div className="divide-y divide-border/40">
            {nextItems.length === 0 ? (
              <EmptyLine text="No open schedule rows yet." />
            ) : (
              nextItems.map((item) => (
                <MasterScheduleRow key={item.id} dealId={params.id} item={item} hasFocusPlan={parentIds.has(item.id)} />
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card shadow-card overflow-hidden">
          <div className="border-b border-border/40 px-4 py-3">
            <h2 className="text-sm font-semibold">Schedule Health</h2>
            <p className="mt-1 text-xs text-muted-foreground">Fast checks before a handoff or export.</p>
          </div>
          <div className="grid grid-cols-1 gap-px bg-border/50 sm:grid-cols-3 xl:grid-cols-1">
            <HealthTile icon={<AlertTriangle className="h-4 w-4 text-red-300" />} label="Critical open" value={criticalItems.length} tone={criticalItems.length ? "danger" : "ok"} />
            <HealthTile icon={<CalendarDays className="h-4 w-4 text-amber-300" />} label="Missing dates" value={missingDateItems.length} tone={missingDateItems.length ? "warning" : "ok"} />
            <HealthTile icon={<UserCircle2 className="h-4 w-4 text-sky-300" />} label="Missing owners" value={missingOwnerItems.length} tone={missingOwnerItems.length ? "warning" : "ok"} />
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border/60 bg-card shadow-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/40 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold">All Schedule Rows</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Click a row to open its focused plan when one exists, or the relevant track schedule.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search schedule"
                className="h-8 w-full rounded-md border border-border/50 bg-background pl-8 pr-3 text-xs outline-none focus:border-primary/50 sm:w-48"
              />
            </div>
            <select value={trackFilter} onChange={(event) => setTrackFilter(event.target.value as TrackFilter)} className="h-8 rounded-md border border-border/50 bg-background px-2 text-xs outline-none focus:border-primary/50">
              <option value="all">All tracks</option>
              <option value="acquisition">Acquisition</option>
              <option value="development">Development</option>
              <option value="construction">Construction</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-8 rounded-md border border-border/50 bg-background px-2 text-xs outline-none focus:border-primary/50">
              <option value="all">All statuses</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="delayed">Delayed</option>
              <option value="complete">Complete</option>
              <option value="missing">Missing dates/owner</option>
            </select>
          </div>
        </div>

        <div className="divide-y divide-border/40">
          {filteredItems.length === 0 ? (
            <EmptyLine text="No schedule rows match these filters." />
          ) : (
            filteredItems.map((item) => (
              <MasterScheduleRow key={item.id} dealId={params.id} item={item} hasFocusPlan={parentIds.has(item.id)} />
            ))
          )}
        </div>
      </section>

      {focusPlans.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card shadow-card overflow-hidden">
          <div className="border-b border-border/40 px-4 py-3">
            <h2 className="text-sm font-semibold">Focused Plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Schedule rows with child task plans beneath them.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-px bg-border/50 md:grid-cols-2 xl:grid-cols-3">
            {focusPlans.slice(0, 9).map((item) => (
              <Link key={item.id} href={`/deals/${params.id}/schedule/focus/${item.id}`} className="group bg-card p-4 transition-colors hover:bg-muted/25">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <TrackBadge track={item.track || "development"} />
                    <p className="mt-2 line-clamp-2 text-sm font-medium">{item.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {items.filter((child) => child.parent_phase_id === item.id).length} child tasks
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TrackSummaryCard({ dealId, track, items }: { dealId: string; track: ScheduleTrack; items: DevPhase[] }) {
  const open = items.filter((item) => item.status !== "complete").length;
  const completed = items.filter((item) => item.status === "complete").length;
  const next = [...items].filter((item) => item.status !== "complete").sort(compareScheduleItems)[0];
  const pct = items.length > 0 ? Math.round((completed / items.length) * 100) : 0;

  return (
    <Link href={TRACK_HREFS[track](dealId)} className="group rounded-xl border border-border/60 bg-card p-4 shadow-card transition-colors hover:bg-muted/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <TrackBadge track={track} />
          <h2 className="mt-3 text-base font-semibold">{SCHEDULE_TRACK_LABELS[track]} Schedule</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {items.length} rows, {open} open
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {next ? (
          <>
            <span className="font-medium text-foreground">{next.label}</span>
            <span> - {formatDateRange(next)}</span>
          </>
        ) : (
          "No open rows."
        )}
      </div>
    </Link>
  );
}

function MasterScheduleRow({ dealId, item, hasFocusPlan }: { dealId: string; item: DevPhase; hasFocusPlan: boolean }) {
  const track = item.track || "development";
  const href = item.parent_phase_id || hasFocusPlan
    ? `/deals/${dealId}/schedule/focus/${item.parent_phase_id || item.id}`
    : TRACK_HREFS[track](dealId);

  return (
    <Link href={href} className="group grid grid-cols-1 gap-3 bg-card px-4 py-3 transition-colors hover:bg-muted/25 md:grid-cols-[1fr_130px_130px_120px] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <TrackBadge track={track} />
          <span className={cn("text-[10px] rounded-full border px-2 py-0.5", item.kind === "milestone" || item.is_milestone ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-border/50 text-muted-foreground")}>
            {item.kind || (item.is_milestone ? "milestone" : "phase")}
          </span>
          {item.is_critical && <span className="text-[10px] rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-200">Critical</span>}
          {hasFocusPlan && <span className="text-[10px] rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">Focused plan</span>}
        </div>
        <p className="mt-1 truncate text-sm font-medium">{item.label}</p>
        {item.notes && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.notes}</p>}
      </div>
      <div className="text-xs text-muted-foreground">{formatDateRange(item)}</div>
      <div className="text-xs text-muted-foreground">{item.task_owner || "No owner"}</div>
      <div className="flex items-center justify-between gap-3 md:justify-end">
        <span className="text-xs text-muted-foreground">{statusLabel(item.status)}</span>
        <span className="text-xs font-medium tabular-nums text-foreground">{item.pct_complete ?? 0}%</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
    </Link>
  );
}

function TrackBadge({ track }: { track: ScheduleTrack }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", TRACK_COLORS[track])}>
      {SCHEDULE_TRACK_LABELS[track]}
    </span>
  );
}

function HealthTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "ok" | "warning" | "danger" }) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={cn("mt-2 flex items-baseline gap-2", tone === "ok" ? "text-emerald-300" : tone === "danger" ? "text-red-300" : "text-amber-300")}>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {tone === "ok" && <CheckCircle2 className="h-4 w-4" />}
      </div>
    </div>
  );
}

function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href}>
      <Button variant="outline" size="sm" className="gap-1.5">
        <Download className="h-3.5 w-3.5" />
        {label}
      </Button>
    </a>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function compareScheduleItems(a: DevPhase, b: DevPhase) {
  const aDate = a.earliest_start || a.start_date || a.end_date;
  const bDate = b.earliest_start || b.start_date || b.end_date;
  if (!aDate && !bDate) return (a.sort_order || 0) - (b.sort_order || 0);
  if (!aDate) return 1;
  if (!bDate) return -1;
  const dateCompare = aDate.localeCompare(bDate);
  if (dateCompare !== 0) return dateCompare;
  return (a.sort_order || 0) - (b.sort_order || 0);
}

function formatDateRange(item: DevPhase) {
  const start = item.earliest_start || item.start_date;
  const end = item.earliest_finish || item.end_date;
  if (!start && !end) return "Unscheduled";
  if (start && end && start !== end) return `${formatShortDate(start)} - ${formatShortDate(end)}`;
  return formatShortDate(start || end);
}

function formatShortDate(value?: string | null) {
  if (!value) return "TBD";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function statusLabel(status: DevPhaseStatus) {
  return titleCase(status.replace(/_/g, " "));
}
