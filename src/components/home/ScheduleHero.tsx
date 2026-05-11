"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import {
  DEAL_STAGE_LABELS,
  bundleIdForPhaseKey,
  bundleById,
  type DealStatus,
  type ScheduleBundle,
} from "@/lib/types";

// ─── The Schedule hero — editorial broadsheet ────────────────────────────────
//
// Sits at the top of the home page in place of the legacy Today strip. One
// horizontal row per live deal; bars on each row are the deal's upcoming
// schedule items (phases, milestones, tasks) coloured by track. Track palette
// matches the existing --phase-acq / --phase-dev / --phase-con accents:
// warm gold, verdigris teal, oxidised copper.
//
// The "broadsheet" idea is intentional. Every row is set on the same baseline
// grid; the time axis runs as a ruled spread; today is a single hairline. No
// card chrome — the schedule itself IS the layout, like a calendar page from a
// financial weekly. The duration selector is a tab strip, the labels switch
// is a small ruled toggle, and the empty state is italic nameplate copy.

interface DealRow {
  id: string;
  name: string;
  status: DealStatus;
  city: string | null;
  state: string | null;
  show_in_development: boolean;
  show_in_construction: boolean;
}

interface PhaseRow {
  id: string;
  deal_id: string;
  kind: "phase" | "milestone" | "task" | null;
  track: "acquisition" | "development" | "construction";
  label: string;
  phase_key: string | null;
  start_date: string | null;
  end_date: string | null;
  pct_complete: number | null;
  status: string | null;
  is_milestone: boolean | null;
  parent_phase_id: string | null;
  sort_order: number;
}

interface TimelinePayload {
  deals: DealRow[];
  phases: PhaseRow[];
}

interface PositionedPhase extends PhaseRow {
  startPct: number;
  endPct: number;
  widthPct: number;
  lane: number;
  start: number;
  end: number;
  originalStartMs: number;
}

/**
 * One aggregated bundle bar — a single block on the timeline that
 * represents a whole bundle of phases (e.g. "Pre-Development" covers
 * Feasibility + Financial + Consultant + Geotech). Spans from min(start)
 * to max(end) of its member phases. Milestones inside the bundle's
 * window get rendered as small diamonds layered on top of the bar at
 * their dates.
 */
interface BundleBar {
  // Synthetic id — `${dealId}:${bundleId}`
  id: string;
  bundleId: string;
  /** Display label — bundle's `label` for known bundles, "Other …" for fallback. */
  label: string;
  track: PhaseRow["track"];
  startPct: number;
  endPct: number;
  widthPct: number;
  start: number;
  end: number;
  /** Phases inside the bundle that are kind=milestone — drawn as diamonds. */
  milestones: PositionedPhase[];
  /** Number of phases rolled up into this bar (for tooltip / hover). */
  phaseCount: number;
  /** % complete averaged across the bundle's member phases. */
  avgPct: number;
  /** Lane assignment so overlapping bundles in the same deal stack cleanly. */
  lane: number;
}

interface DealTimelineRow {
  deal: DealRow;
  bundles: BundleBar[];
  laneCount: number;
  empty: boolean;
}

// Left rail width — deal name + meta + stage chip. Drives the timeline's
// left offset so the bars start aligned with the time axis ticks.
const RAIL_W = "16rem";

const DURATIONS = [
  { weeks: 4, label: "4w" },
  { weeks: 12, label: "12w" },
  { weeks: 26, label: "26w" },
  { weeks: 52, label: "52w" },
] as const;

const STAGE_DOT: Partial<Record<DealStatus, string>> = {
  sourcing: "bg-zinc-400",
  screening: "bg-blue-400",
  loi: "bg-amber-400",
  under_contract: "bg-orange-400",
  diligence: "bg-primary",
  closing: "bg-emerald-400",
};

const MS_PER_DAY = 86_400_000;

function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Tolerate full ISO or date-only — just take the first 10 chars and
  // anchor at UTC noon so timezone offsets don't shift the day.
  const head = s.slice(0, 10);
  const [y, m, d] = head.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function formatRange(start: Date, end: Date) {
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = end.toLocaleDateString("en-US", {
    ...opts,
    year: sameYear ? undefined : "numeric",
  });
  return `${startStr} — ${endStr}${sameYear ? `, ${end.getUTCFullYear()}` : ""}`;
}

function trackVar(track: "acquisition" | "development" | "construction" | string) {
  // Existing rows always carry a track; fall back via deal stage just in case.
  if (track !== "acquisition" && track !== "development" && track !== "construction") {
    track = "development";
  }
  return track === "acquisition"
    ? "--phase-acq"
    : track === "development"
      ? "--phase-dev"
      : "--phase-con";
}

function trackScheduleHref(dealId: string, track: PhaseRow["track"]) {
  if (track === "construction") return `/deals/${dealId}/construction/schedule`;
  if (track === "development") return `/deals/${dealId}/project`;
  return `/deals/${dealId}/schedule/acquisition`;
}

/**
 * Greedy lane assignment — for each deal's phases, pack them into the
 * fewest horizontal lanes such that no two bars in the same lane overlap.
 * Returns a row height multiplier per deal (1 lane = 1 row, etc.) so
 * the container can grow with phase density without forcing fixed
 * scrollbars.
 */
function assignLanes<T extends { start: number; end: number }>(items: T[]): Array<T & { lane: number }> {
  const lanes: number[] = []; // last `end` value per lane
  const out: Array<T & { lane: number }> = [];
  // Sort by start so greedy works.
  const sorted = [...items].sort((a, b) => a.start - b.start);
  for (const item of sorted) {
    let lane = lanes.findIndex((laneEnd) => laneEnd <= item.start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(item.end);
    } else {
      lanes[lane] = item.end;
    }
    out.push({ ...item, lane });
  }
  return out;
}

export function ScheduleHero() {
  const [data, setData] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState<4 | 12 | 26 | 52>(12);
  const [showLabels, setShowLabels] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Persisted UI prefs — duration, labels, collapsed
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("schedHeroWeeks"));
      if (w === 4 || w === 12 || w === 26 || w === 52) setWeeks(w);
      const l = localStorage.getItem("schedHeroLabels.v2");
      if (l === "0") setShowLabels(false);
      const c = localStorage.getItem("schedHeroCollapsed");
      if (c === "1") setCollapsed(true);
    } catch {
      /* SSR / private mode */
    }
  }, []);
  useEffect(() => { try { localStorage.setItem("schedHeroWeeks", String(weeks)); } catch {} }, [weeks]);
  useEffect(() => { try { localStorage.setItem("schedHeroLabels.v2", showLabels ? "1" : "0"); } catch {} }, [showLabels]);
  useEffect(() => { try { localStorage.setItem("schedHeroCollapsed", collapsed ? "1" : "0"); } catch {} }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/workspace/schedule-timeline?weeks=${weeks}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setData(j.data ?? { deals: [], phases: [] });
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weeks]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const windowStart = today;
  const windowEnd = useMemo(
    () => new Date(today.getTime() + weeks * 7 * MS_PER_DAY),
    [today, weeks],
  );
  const windowMs = windowEnd.getTime() - windowStart.getTime();

  // Tick marks across the time axis — weekly for short ranges, monthly for long.
  const ticks = useMemo(() => {
    const points: { offsetPct: number; label: string; major: boolean }[] = [];
    const monthly = weeks >= 26;
    const cursor = new Date(windowStart);
    if (monthly) {
      // Snap to the first of the next month.
      cursor.setUTCDate(1);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      // Next Monday.
      const dow = cursor.getUTCDay();
      const offset = ((1 - dow) + 7) % 7 || 7;
      cursor.setUTCDate(cursor.getUTCDate() + offset);
    }
    while (cursor.getTime() < windowEnd.getTime()) {
      const offsetPct = ((cursor.getTime() - windowStart.getTime()) / windowMs) * 100;
      const label = monthly
        ? cursor.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
        : `${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}`;
      points.push({ offsetPct, label, major: monthly });
      if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      else cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return points;
  }, [windowStart, windowEnd, windowMs, weeks]);

  // Group phases per deal, with computed % positions and lane assignments.
  // Roll phases into bundle bars per deal. Each bundle becomes a single
  // bar spanning min(start_date) → max(end_date) of its member phases,
  // with milestones drawn as diamonds layered on top at their dates.
  // This collapses what used to be 15-20 bars per deal into 2-5 wide,
  // legible bars labeled "Pre-Development" / "Design" / "Permitting"
  // etc. The deal page is still the place for granular per-phase
  // editing — the home schedule is the at-a-glance view.
  const dealRows = useMemo<DealTimelineRow[]>(() => {
    if (!data) return [];
    const byDeal = new Map<string, PhaseRow[]>();
    for (const p of data.phases) {
      const arr = byDeal.get(p.deal_id);
      if (arr) arr.push(p);
      else byDeal.set(p.deal_id, [p]);
    }
    return data.deals.map((deal) => {
      const phases = byDeal.get(deal.id) ?? [];
      // Position each phase first — needed for milestone diamond
      // placement and for fallback per-phase rendering when a phase's
      // bundle id can't be resolved (user-added rows, legacy migrated).
      const positioned = phases
        .map((p) => {
          const start = parseISODate(p.start_date);
          const end = parseISODate(p.end_date) ?? start;
          if (!start && !end) return null;
          const sMs = (start ?? end ?? today).getTime();
          const eMs = (end ?? start ?? today).getTime();
          const clipS = Math.max(sMs, windowStart.getTime());
          const clipE = Math.min(eMs, windowEnd.getTime());
          if (clipE < clipS) return null;
          const startPct = ((clipS - windowStart.getTime()) / windowMs) * 100;
          const endPct = ((clipE - windowStart.getTime()) / windowMs) * 100;
          return {
            ...p,
            startPct,
            endPct,
            widthPct: Math.max(0.6, endPct - startPct),
            start: clipS,
            end: clipE,
            originalStartMs: sMs,
          };
        })
        .filter((p): p is PositionedPhase => p !== null);

      // Group by bundle id. Phases whose phase_key isn't in any default
      // template (user-added, legacy-migrated) fall into a track-default
      // bucket so they're not lost — the bar is labeled "Other <Track>".
      const groups = new Map<string, PositionedPhase[]>();
      for (const p of positioned) {
        const bundleId = bundleIdForPhaseKey(p.phase_key) ?? `other.${p.track}`;
        const arr = groups.get(bundleId);
        if (arr) arr.push(p);
        else groups.set(bundleId, [p]);
      }

      // Build a bundle bar per group. forEach instead of for…of so we
      // don't need downlevelIteration on the existing tsconfig target.
      const bundlesUnpositioned: Omit<BundleBar, "lane">[] = [];
      groups.forEach((members: PositionedPhase[], bundleId: string) => {
        const start = Math.min(...members.map((m) => m.start));
        const end = Math.max(...members.map((m) => m.end));
        const startPct = ((start - windowStart.getTime()) / windowMs) * 100;
        const endPct = ((end - windowStart.getTime()) / windowMs) * 100;
        const meta = bundleById(bundleId);
        const fallbackLabel =
          bundleId.startsWith("other.")
            ? `Other ${bundleId.slice("other.".length)}`
            : bundleId;
        const label = meta?.label ?? fallbackLabel;
        const milestones = members.filter(
          (m) => m.kind === "milestone" || m.is_milestone === true,
        );
        const avgPct =
          members.reduce(
            (sum: number, m: PositionedPhase) => sum + (m.pct_complete ?? 0),
            0,
          ) / members.length;
        bundlesUnpositioned.push({
          id: `${deal.id}:${bundleId}`,
          bundleId,
          label,
          track: meta?.track ?? members[0].track,
          startPct,
          endPct,
          widthPct: Math.max(2, endPct - startPct),
          start,
          end,
          milestones,
          phaseCount: members.length,
          avgPct,
        });
      });

      // Lane-pack the bundle bars so overlapping bundles within a deal
      // stack cleanly. Most deals end up at one or two lanes total —
      // dramatically tighter than the per-phase laning we used to do.
      const lanes = assignLanes(bundlesUnpositioned);
      return {
        deal,
        bundles: lanes,
        laneCount: Math.max(1, lanes.reduce((m, x) => Math.max(m, x.lane + 1), 0)),
        // Per the user's note — only show deals with a schedule.
        // Empty deals drop out of dealRows entirely.
        empty: lanes.length === 0,
      };
    });
  }, [data, today, windowStart, windowEnd, windowMs]);

  // Only render deals that have at least one bundle bar in the window.
  // Empty deals are filtered out — the user said they were noisy.
  const populatedRows = useMemo(() => dealRows.filter((r) => !r.empty), [dealRows]);

  // The seed wizard lives at the deal level — empty deal rows here
  // route the user into the deal's schedule page where they can pick
  // which bundles to seed. Keeping the wizard out of the home page
  // avoids the "I clicked one button and got 30 phases" surprise.

  // Pull-up CTA when there are no deals at all (vs. deals exist but
  // none have schedules — the latter renders inline "Seed schedule"
  // rows now instead of a single big empty state).
  const noDeals = !loading && data && data.deals.length === 0;
  const noScheduledRows =
    !loading && data && data.deals.length > 0 && populatedRows.length === 0;

  // Today is always at offset 0 in this window since the SQL starts at
  // CURRENT_DATE. Render the hairline at 0%.
  const todayPct = 0;

  return (
    <section
      className="relative shrink-0 border-b border-border/40 overflow-hidden"
      style={{ ["--rail-w" as string]: RAIL_W }}
    >
      {/* Subtle gradient mesh hint behind the schedule, less aggressive than
          the masthead so the timeline reads as the dominant layer. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.35]" aria-hidden="true">
        <div className="absolute inset-0 gradient-mesh" />
      </div>

      {/* Collapse toggle — mirrors the affordance the old TodayStrip had. */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand schedule" : "Collapse schedule"}
        className="absolute top-4 right-6 sm:right-8 z-10 h-6 w-6 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-card/40 transition-colors"
      >
        {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      <div className="relative px-6 sm:px-8 py-8">
        {/* ── Title block ── */}
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3 min-w-0">
              <h2 className="font-nameplate text-3xl sm:text-4xl leading-none tracking-tight text-foreground">
                The&nbsp;Schedule
              </h2>
              <CalendarDays className="h-4 w-4 text-primary shrink-0" strokeWidth={1.5} />
            </div>
            <div className="mt-2 text-2xs uppercase tracking-[0.22em] text-muted-foreground/70 tabular-nums">
              {formatRange(windowStart, windowEnd)}
              <span className="mx-2 text-muted-foreground/40">·</span>
              <span>{dealRows.length} {dealRows.length === 1 ? "deal" : "deals"} in view</span>
            </div>
          </div>

          {!collapsed && (
            <div className="mr-10 flex flex-wrap items-center justify-end gap-3">
              {/* ─ Duration tabs ─ */}
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/50 bg-card/45 p-1 backdrop-blur-sm">
                {DURATIONS.map((d) => {
                  const active = d.weeks === weeks;
                  return (
                    <button
                      key={d.weeks}
                      onClick={() => setWeeks(d.weeks as 4 | 12 | 26 | 52)}
                      className={`rounded-full px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] tabular-nums transition-colors ${
                        active
                          ? "bg-primary/15 text-primary ring-1 ring-primary/35"
                          : "text-muted-foreground/65 hover:bg-muted/40 hover:text-foreground"
                      }`}
                      aria-pressed={active}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>

              {/* ─ Labels toggle ─ */}
              <button
                onClick={() => setShowLabels((s) => !s)}
                className="group inline-flex items-center gap-2 rounded-full border border-border/45 bg-card/35 px-2.5 py-1.5 transition-colors hover:border-primary/30 hover:bg-card/60"
                aria-pressed={showLabels}
              >
                <span
                  className={`relative h-5 w-9 rounded-full border transition-colors ${
                    showLabels
                      ? "border-primary/50 bg-primary/25"
                      : "border-border/60 bg-muted/40"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-foreground shadow-sm transition-transform ${
                      showLabels ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
                <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/75 transition-colors group-hover:text-foreground">
                  Labels {showLabels ? "on" : "off"}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Hairline under the title — staggered scale-in on mount, just like
            the existing nameplate underlines. */}
        {!collapsed && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            {[
              ["Acq", "--phase-acq"],
              ["Dev", "--phase-dev"],
              ["Con", "--phase-con"],
            ].map(([label, colorVar]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full border"
                  style={{
                    background: `hsl(var(${colorVar}) / 0.22)`,
                    borderColor: `hsl(var(${colorVar}) / 0.65)`,
                  }}
                  aria-hidden="true"
                />
                {label}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-6 h-px origin-left transition-transform duration-700 ease-out scale-x-100"
          style={{ background: "hsl(var(--primary) / 0.5)" }}
        />

        {!collapsed && (
          <>
            {/* ── Time axis ── */}
            <div className="relative mt-5 ml-[var(--rail-w,17rem)] h-5">
              <div className="absolute inset-0">
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 -translate-x-1/2 text-2xs tabular-nums text-muted-foreground/55 tracking-[0.05em]"
                    style={{ left: `${t.offsetPct}%` }}
                  >
                    {t.label}
                  </div>
                ))}
                <div
                  className="absolute -top-1 -translate-x-1/2 z-10 text-[9px] uppercase tracking-[0.22em] font-semibold text-primary"
                  style={{ left: `${todayPct}%` }}
                >
                  <span className="bg-background/60 px-1 rounded-sm">Today</span>
                </div>
              </div>
            </div>

            {/* ── Body ── */}
            {loading && <SkeletonRows />}

            {noDeals && (
              <EmptyState
                title="No deals yet"
                body="Create one to start populating the schedule."
                cta={{ href: "/deals/new", label: "Create a deal" }}
              />
            )}

            {noScheduledRows && (
              <EmptyState
                title="No schedule bars in this view"
                body="Try a longer range or open a deal to seed its schedule."
              />
            )}

            {!loading && dealRows.length > 0 && (
              <div className="relative mt-2">
                {/* Today vertical hairline — runs full body height. The
                    rail is grid-col 1 (fixed RAIL_W) and the bars are
                    grid-col 2; the hairline sits at the start of col 2
                    plus the today percentage of that column's width. */}
                <div
                  className="absolute top-0 bottom-0 w-px z-[1] pointer-events-none"
                  style={{
                    left: `calc(var(--rail-w) + (100% - var(--rail-w)) * ${todayPct} / 100)`,
                    background:
                      "linear-gradient(to bottom, hsl(var(--primary) / 0.6), hsl(var(--primary) / 0.18))",
                    boxShadow: "0 0 8px hsl(var(--primary) / 0.25)",
                  }}
                  aria-hidden="true"
                />

                {/* Populated deals first, then empty "needs seeding" rows.
                    Splitting this way keeps the visual mass at the top of
                    the timeline and the call-to-action rows clustered
                    below — the user reads "active work" before "to-do
                    setup" naturally. */}
                <ul className="divide-y divide-border/25">
                  {populatedRows.map((row, i) => (
                    <DealRowComponent
                      key={row.deal.id}
                      row={row}
                      index={i}
                      showLabels={showLabels}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface DealRowProps {
  row: DealTimelineRow;
  index: number;
  showLabels: boolean;
}

function DealRowComponent({ row, index, showLabels }: DealRowProps) {
  const { deal, bundles, laneCount } = row;
  const meta = [deal.city, deal.state].filter(Boolean).join(", ");
  const stageLabel = DEAL_STAGE_LABELS[deal.status] ?? deal.status;
  const dotClass = STAGE_DOT[deal.status] ?? "bg-muted-foreground/30";

  const ROW_BASE_PX = 40;
  const LANE_PX = 26;
  const rowHeight = ROW_BASE_PX + Math.max(0, laneCount - 1) * LANE_PX;

  return (
    <li
      className="relative grid grid-cols-[var(--rail-w,17rem)_1fr] items-stretch animate-fade-up"
      style={{
        animationDelay: `${Math.min(index * 30, 600)}ms`,
        minHeight: rowHeight,
      }}
    >
      {/* Left rail — deal name + city/state + stage chip */}
      <Link
        href={`/deals/${deal.id}`}
        className="relative pr-5 py-2.5 flex flex-col justify-center group/dealrow border-r border-border/30"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-nameplate text-base leading-tight text-foreground group-hover/dealrow:text-primary transition-colors truncate">
            {deal.name}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 min-w-0">
          {meta && (
            <span className="text-2xs tracking-[0.15em] uppercase text-muted-foreground/55 truncate">
              {meta}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 shrink-0">
            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/65">
              {stageLabel}
            </span>
          </span>
        </div>
      </Link>

      {/* Right rail — bundle bars (one per bundle on the deal). */}
      <div className="relative py-2">
        {bundles.map((b) => {
          const accentVar = trackVar(b.track);
          const top = 4 + b.lane * LANE_PX;
          const height = 20;
          const phaseSummary =
            b.phaseCount === 1
              ? "1 phase"
              : `${b.phaseCount} phases`;
          return (
            <Link
              key={b.id}
              href={trackScheduleHref(deal.id, b.track)}
              className="absolute group/bar overflow-hidden rounded-[4px] transition-transform hover:-translate-y-px hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/45"
              style={{
                left: `${b.startPct}%`,
                width: `${b.widthPct}%`,
                top: `${top}px`,
                height: `${height}px`,
                background: `hsl(var(${accentVar}) / 0.16)`,
                border: `1px solid hsl(var(${accentVar}) / 0.42)`,
                borderTop: `2px solid hsl(var(${accentVar}) / 0.85)`,
              }}
              title={`${b.label} · ${phaseSummary} · ${formatBarDate(b.start)} → ${formatBarDate(b.end)}`}
            >
              {/* Average pct_complete fill — single underline across the
                  bundle so a half-finished bundle reads visually
                  half-shaded. */}
              {b.avgPct > 0 && (
                <div
                  className="absolute left-0 top-0 bottom-0 pointer-events-none"
                  style={{
                    width: `${Math.min(100, Math.max(0, b.avgPct))}%`,
                    background: `hsl(var(${accentVar}) / 0.18)`,
                  }}
                  aria-hidden="true"
                />
              )}
              {showLabels && (
                <span
                  className="relative z-[1] flex h-full min-w-0 items-center truncate whitespace-nowrap px-2 text-[10px] font-medium tracking-[0.05em] text-foreground/85"
                >
                  {b.label}
                </span>
              )}
              {/* Milestone diamonds inside the bar. Drawn on top so the
                  user sees the contractual checkpoints (LOI, PSA,
                  closing, IC vote, permit issuance, TCO) as anchors
                  inside the bundle rather than separate stacked bars. */}
              {b.milestones.map((m) => {
                // Diamond percent within the bundle bar — translate
                // the milestone's window-relative startPct into a
                // bar-relative offset.
                const innerWidth = b.endPct - b.startPct;
                const offsetPct = innerWidth > 0
                  ? ((m.startPct - b.startPct) / innerWidth) * 100
                  : 0;
                return (
                  <span
                    key={m.id}
                    className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ left: `${offsetPct}%` }}
                    title={`${m.label} · ${formatBarDate(m.start)}`}
                  >
                    <span
                      className="block h-2.5 w-2.5 rotate-45 rounded-[1px] border"
                      style={{
                        background: `hsl(var(${accentVar}) / 0.95)`,
                        borderColor: `hsl(var(${accentVar}))`,
                      }}
                    />
                  </span>
                );
              })}
            </Link>
          );
        })}
      </div>
    </li>
  );
}

function formatBarDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ─── Empty (needs-seeding) row ───────────────────────────────────────────────
//
// Renders a deal that has zero phases in the timeline — typically a brand-new
// deal that hasn't had any default phases seeded, or one whose owner has been
// tracking dates inline elsewhere (LOI page, deal table fields) without
// running the schedule seeder. The row stays compact so the populated rows
// above keep the visual weight, but offers a one-click way to populate the
// (Empty deal rows are filtered out of dealRows entirely now — the
// schedule shows only deals that have a populated schedule. Setting up
// a new deal's schedule happens at the deal level.)

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mt-6 ml-[var(--rail-w,17rem)] py-10 px-4 text-center">
      <p className="font-nameplate italic text-lg text-muted-foreground/70">{title}</p>
      <p className="mt-2 text-xs text-muted-foreground/55 max-w-[42ch] mx-auto">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary hover:gap-2 transition-all"
        >
          {cta.label}
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="mt-2 ml-[var(--rail-w,17rem)] space-y-3 py-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="h-4 rounded bg-muted/25" style={{ width: `${30 + i * 12}%` }} />
          <div className="h-4 rounded bg-muted/15 flex-1 max-w-[40%]" />
        </div>
      ))}
    </div>
  );
}
