"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Calendar,
  Loader2,
  AlertCircle,
  CircleDot,
  GitBranch,
  ArrowRight,
} from "lucide-react";

interface UpcomingItem {
  kind: "milestone" | "task" | "phase";
  id: string;
  deal_id: string;
  deal_name: string;
  deal_status: string;
  title: string;
  due_date: string;
  priority: string | null;
  assignee: string | null;
  /** Schedule track for phase items: 'acquisition' | 'development' | 'construction'. */
  track: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-blue-400",
  low: "text-zinc-400",
};

// Each schedule track gets the same accent var the lower triptych uses,
// so a Diligence Period row (acquisition track) is tinted the same as
// the Acquisition panel's nameplate. Visual continuity end-to-end.
const TRACK_ACCENT: Record<string, string> = {
  acquisition: "--phase-acq",
  development: "--phase-dev",
  construction: "--phase-con",
};

const TRACK_LABEL: Record<string, string> = {
  acquisition: "Acq",
  development: "Dev",
  construction: "Con",
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

  const visible = items.slice(0, 6);
  const overflow = Math.max(0, items.length - visible.length);

  return (
    <section className="group/panel relative flex flex-col px-6 py-8 transition-colors duration-300 hover:bg-card/10">
      {/* Editorial nameplate — mirrors PhaseNameplate for visual parity
          with the triptych below. */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="font-nameplate text-3xl leading-none tracking-tight text-foreground">
            Upcoming
          </span>
          {items.length > 0 && (
            <span
              className="text-2xs font-medium tabular-nums uppercase tracking-[0.15em]"
              style={{ color: "hsl(var(--primary) / 0.8)" }}
            >
              {items.length} due
            </span>
          )}
        </div>
        <Calendar
          className="h-4 w-4 transition-transform duration-500 group-hover/panel:rotate-[8deg] text-primary"
          strokeWidth={1.5}
        />
      </div>
      <div
        className="mt-3 h-px origin-left transition-transform duration-[500ms] ease-out scale-x-[0.35] group-hover/panel:scale-x-100"
        style={{ background: "hsl(var(--primary))" }}
      />

      {/* Body */}
      <div className="mt-7 flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
          </div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center py-10">
            <p className="text-xs text-muted-foreground/50 text-center max-w-[36ch] font-nameplate italic">
              Nothing due in the next two weeks. Add milestones, tasks, or
              schedule phases from any deal.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/15">
            {visible.map((item) => {
              const due = parseDue(item.due_date);
              const accentVar = item.track
                ? TRACK_ACCENT[item.track] ?? "--primary"
                : "--primary";
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    href={hrefForItem(item)}
                    className="flex items-start gap-3 py-2.5 hover:bg-card/30 -mx-2 px-2 rounded transition-colors"
                  >
                    <ItemGlyph item={item} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate">
                        {item.title}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                        {item.track && (
                          <span
                            className="text-2xs uppercase tracking-[0.15em] font-medium"
                            style={{ color: `hsl(var(${accentVar}))` }}
                          >
                            {TRACK_LABEL[item.track] ?? item.track}
                          </span>
                        )}
                        {item.track && (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                        <span className="text-muted-foreground truncate">
                          {item.deal_name}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`text-[11px] font-medium tabular-nums flex-shrink-0 self-center ${
                        due.overdue
                          ? "text-red-400"
                          : due.soon
                            ? "text-amber-400"
                            : "text-muted-foreground"
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

      {/* Footer — see-all only when there's overflow */}
      {overflow > 0 && (
        <div className="mt-6 pt-4 border-t border-border/20">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <span>+{overflow} more</span>
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      )}
    </section>
  );
}

function ItemGlyph({ item }: { item: UpcomingItem }) {
  if (item.kind === "milestone") {
    return <CircleDot className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />;
  }
  if (item.kind === "phase") {
    const accentVar = item.track ? TRACK_ACCENT[item.track] ?? "--primary" : "--primary";
    return (
      <GitBranch
        className="h-3.5 w-3.5 mt-0.5 flex-shrink-0"
        style={{ color: `hsl(var(${accentVar}))` }}
      />
    );
  }
  // Task — color by priority.
  return (
    <AlertCircle
      className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${
        item.priority
          ? PRIORITY_COLORS[item.priority] ?? "text-muted-foreground"
          : "text-muted-foreground"
      }`}
    />
  );
}

/**
 * Send the user to the right page for the row's kind. Phases live on the
 * track-specific schedule page so the analyst can adjust dates inline;
 * milestones / tasks land on the project tab where they're managed.
 */
function hrefForItem(item: UpcomingItem): string {
  if (item.kind === "phase" && item.track) {
    if (item.track === "acquisition") return `/deals/${item.deal_id}/schedule`;
    if (item.track === "construction")
      return `/deals/${item.deal_id}/construction/schedule`;
    return `/deals/${item.deal_id}/project`;
  }
  return `/deals/${item.deal_id}/project`;
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
