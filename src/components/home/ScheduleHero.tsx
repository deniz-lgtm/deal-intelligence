"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import { DEAL_STAGE_LABELS, type DealStatus } from "@/lib/types";

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

interface DealTimelineRow {
  deal: DealRow;
  phases: PositionedPhase[];
  laneCount: number;
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

function classifyTrack(p: PhaseRow): "acquisition" | "development" | "construction" {
  // Existing rows always carry a track; fall back via deal stage just in case.
  if (p.track === "acquisition" || p.track === "development" || p.track === "construction") {
    return p.track;
  }
  return "development";
}

function trackVar(track: "acquisition" | "development" | "construction") {
  return track === "acquisition"
    ? "--phase-acq"
    : track === "development"
      ? "--phase-dev"
      : "--phase-con";
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
      const l = localStorage.getItem("schedHeroLabels");
      if (l === "0") setShowLabels(false);
      const c = localStorage.getItem("schedHeroCollapsed");
      if (c === "1") setCollapsed(true);
    } catch {
      /* SSR / private mode */
    }
  }, []);
  useEffect(() => { try { localStorage.setItem("schedHeroWeeks", String(weeks)); } catch {} }, [weeks]);
  useEffect(() => { try { localStorage.setItem("schedHeroLabels", showLabels ? "1" : "0"); } catch {} }, [showLabels]);
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
  const dealRows = useMemo(() => {
    if (!data) return [];
    const byDeal = new Map<string, PhaseRow[]>();
    for (const p of data.phases) {
      const arr = byDeal.get(p.deal_id);
      if (arr) arr.push(p);
      else byDeal.set(p.deal_id, [p]);
    }
    return data.deals
      .map((deal) => {
        const phases = byDeal.get(deal.id) ?? [];
        const positioned = phases
          .map((p) => {
            const start = parseISODate(p.start_date);
            const end = parseISODate(p.end_date) ?? start;
            if (!start && !end) return null;
            const sMs = (start ?? end ?? today).getTime();
            const eMs = (end ?? start ?? today).getTime();
            // Clip to window.
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
          .filter((p): p is NonNullable<typeof p> => p !== null);
        const lanes = assignLanes(positioned);
        return {
          deal,
          phases: lanes,
          laneCount: Math.max(1, lanes.reduce((m, x) => Math.max(m, x.lane + 1), 0)),
        };
      })
      // Drop deals with no phases in this window — they'd just be empty rows.
      .filter((row) => row.phases.length > 0);
  }, [data, today, windowStart, windowEnd, windowMs]);

  // Pull-up CTA when we have deals but none have schedules yet — so the user
  // knows the schedule is empty because nothing's been seeded, not because
  // there are no deals.
  const noSchedules = !loading && data && data.deals.length > 0 && dealRows.length === 0;
  const noDeals = !loading && data && data.deals.length === 0;

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
            <div className="flex items-center gap-4 mr-10">
              {/* ─ Duration tabs ─ */}
              <div className="flex items-center gap-px rounded-full border border-border/40 bg-card/30 backdrop-blur-sm overflow-hidden">
                {DURATIONS.map((d) => {
                  const active = d.weeks === weeks;
                  return (
                    <button
                      key={d.weeks}
                      onClick={() => setWeeks(d.weeks as 4 | 12 | 26 | 52)}
                      className={`relative px-3 py-1.5 text-2xs font-medium tabular-nums tracking-[0.12em] uppercase transition-colors ${
                        active
                          ? "text-foreground"
                          : "text-muted-foreground/60 hover:text-foreground"
                      }`}
                      aria-pressed={active}
                    >
                      {active && (
                        <span
                          className="absolute inset-0 rounded-full bg-foreground/[0.04] border border-primary/30"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative">{d.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* ─ Labels toggle ─ */}
              <button
                onClick={() => setShowLabels((s) => !s)}
                className="flex items-center gap-2 group"
                aria-pressed={showLabels}
              >
                <span
                  className={`relative h-4 w-7 rounded-full border transition-colors ${
                    showLabels
                      ? "bg-primary/20 border-primary/40"
                      : "bg-card/40 border-border/40"
                  }`}
                >
                  <span
                    className={`absolute top-[1px] h-[calc(100%-2px)] aspect-square rounded-full bg-foreground/80 transition-transform ${
                      showLabels ? "translate-x-3" : "translate-x-[1px]"
                    }`}
                  />
                </span>
                <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/70 group-hover:text-foreground transition-colors">
                  Labels
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Hairline under the title — staggered scale-in on mount, just like
            the existing nameplate underlines. */}
        <div
          className="mt-6 h-px origin-left transition-transform duration-[700ms] ease-out scale-x-100"
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
            {noSchedules && (
              <EmptyState
                title="No active schedules in this window"
                body="Open a deal and seed a development or construction schedule template — bars will land here."
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

                <ul className="divide-y divide-border/25">
                  {dealRows.map((row, i) => (
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
  const { deal, phases, laneCount } = row;
  const meta = [deal.city, deal.state].filter(Boolean).join(", ");
  const stageLabel = DEAL_STAGE_LABELS[deal.status] ?? deal.status;
  const dotClass = STAGE_DOT[deal.status] ?? "bg-muted-foreground/30";

  const ROW_BASE_PX = 36;
  const LANE_PX = 24;
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

      {/* Right rail — bars */}
      <div className="relative py-2.5">
        {phases.map((p) => {
          const track = classifyTrack(p);
          const accentVar = trackVar(track);
          const isMilestone = p.kind === "milestone" || p.is_milestone === true;
          const isTask = p.kind === "task";
          const top = 4 + p.lane * LANE_PX;
          const height = isTask ? 14 : isMilestone ? 18 : 18;

          if (isMilestone) {
            // Diamond glyph at the start point. Use originalStartMs so a
            // milestone whose date is before today still renders at the
            // window edge with a tiny "past" indicator instead of vanishing.
            return (
              <div
                key={p.id}
                className="absolute z-[2] -translate-x-1/2 -translate-y-1/2 group/bar"
                style={{
                  left: `${p.startPct}%`,
                  top: `${top + height / 2}px`,
                }}
                title={`${p.label} · ${formatBarDate(p.start)}`}
              >
                <span
                  className="block h-3 w-3 rotate-45 rounded-[2px] border transition-transform group-hover/bar:scale-125"
                  style={{
                    background: `hsl(var(${accentVar}) / 0.85)`,
                    borderColor: `hsl(var(${accentVar}))`,
                    boxShadow: `0 0 0 2px hsl(var(${accentVar}) / 0.12)`,
                  }}
                />
              </div>
            );
          }

          return (
            <div
              key={p.id}
              className="absolute group/bar overflow-hidden rounded-[3px] transition-transform hover:-translate-y-px hover:shadow-md"
              style={{
                left: `${p.startPct}%`,
                width: `${p.widthPct}%`,
                top: `${top}px`,
                height: `${height}px`,
                background: `hsl(var(${accentVar}) / 0.16)`,
                border: `1px solid hsl(var(${accentVar}) / 0.42)`,
                borderTop: `2px solid hsl(var(${accentVar}) / 0.85)`,
              }}
              title={`${p.label} · ${formatBarDate(p.start)} → ${formatBarDate(p.end)}`}
            >
              {/* Tasks get a dashed treatment so they read as smaller
                  intervention rather than a full-on phase block. */}
              {isTask && (
                <div
                  className="absolute inset-0 rounded-[3px] pointer-events-none"
                  style={{
                    backgroundImage: `repeating-linear-gradient(45deg, transparent 0 4px, hsl(var(${accentVar}) / 0.10) 4px 6px)`,
                  }}
                  aria-hidden="true"
                />
              )}
              {/* pct_complete fill — subtle inner darkened band underlining how far
                  the bar has been driven. Only renders when complete > 0. */}
              {(p.pct_complete ?? 0) > 0 && (
                <div
                  className="absolute left-0 top-0 bottom-0 pointer-events-none"
                  style={{
                    width: `${Math.min(100, Math.max(0, p.pct_complete ?? 0))}%`,
                    background: `hsl(var(${accentVar}) / 0.18)`,
                  }}
                  aria-hidden="true"
                />
              )}
              {showLabels && (
                <span
                  className="relative z-[1] block px-1.5 leading-[14px] sm:leading-[16px] text-[10px] tracking-[0.05em] truncate font-medium text-foreground/85"
                >
                  {p.label}
                </span>
              )}
            </div>
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
