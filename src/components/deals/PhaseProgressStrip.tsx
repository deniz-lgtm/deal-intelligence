"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEAL_PIPELINE,
  DEAL_STAGE_LABELS,
  EXECUTION_PHASES,
  EXECUTION_PHASE_CONFIG,
} from "@/lib/types";
import type { Deal, DealStatus, DevPhase, ExecutionPhase } from "@/lib/types";
import { classifyDealPhase } from "@/lib/phase-classification";

// Canonical Dev stages — the five buckets the sidebar Development group is
// organized around. Maps each stage to the phase_key prefixes of the seed
// schedule (see DEFAULT_DEV_PHASES in lib/types.ts). Any unrecognized
// dev-track phase_key is ignored; the row still renders the canonical stages
// but that phase won't contribute to the current-stage / fill calculation.
const DEV_STAGES: ReadonlyArray<{ key: string; label: string; matches: (phaseKey: string) => boolean }> = [
  {
    key: "pre_dev",
    label: "Pre-Dev",
    matches: (k) =>
      k.startsWith("dev_feasibility") ||
      k.startsWith("dev_financial") ||
      k.startsWith("dev_consultant") ||
      k.startsWith("dev_site_investigation"),
  },
  {
    key: "design",
    label: "Design",
    matches: (k) =>
      k.startsWith("dev_schematic") ||
      k.startsWith("dev_design_development") ||
      k.startsWith("dev_construction_docs"),
  },
  {
    key: "entitlements",
    label: "Entitlements",
    matches: (k) =>
      k.startsWith("dev_community_outreach") ||
      k.startsWith("dev_entitlements") ||
      k.startsWith("dev_ceqa") ||
      k.startsWith("dev_utility"),
  },
  {
    key: "permitting",
    label: "Permitting",
    matches: (k) => k.startsWith("dev_permitting") || k === "dev_permit_issuance",
  },
  {
    key: "ready",
    label: "Ready-to-Build",
    matches: (k) =>
      k.startsWith("dev_bid_package") ||
      k.startsWith("dev_gc_selection") ||
      k.startsWith("dev_precon") ||
      k.startsWith("dev_gmp") ||
      k.startsWith("dev_subcontractor") ||
      k.startsWith("dev_construction_loan") ||
      k === "dev_ntp",
  },
];

// Duration-weighted average pct_complete for a set of DevPhase rows. Phases
// with no duration fall back to 1 day so milestones still count a little.
function weightedPct(phases: DevPhase[]): number {
  if (phases.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const p of phases) {
    const w = Math.max(1, p.duration_days ?? 1);
    num += (p.pct_complete ?? 0) * w;
    den += w;
  }
  return den > 0 ? Math.round(num / den) : 0;
}

// Which canonical Dev stage should be highlighted as "current"?
//
// Three cases the matcher has to handle:
//   1. No dev-track phases at all → Pre-Dev (the deal hasn't started
//      anything; render the canonical progression rather than a blank row).
//   2. Dev-track phases exist but none match any of our canonical stage
//      matchers → Pre-Dev. This covers custom/legacy schedules whose
//      phase_keys don't follow the DEFAULT_DEV_PHASES naming. Landing
//      on Ready-to-Build here was the old bug — it made every earlier
//      stage render "completed" even though no work was actually done.
//   3. Matched phases exist → pick the first stage with any in-progress
//      matched phase; if every matched phase is 100%, the deal has
//      cleared Dev and we land on Ready-to-Build.
function currentDevStageKey(devPhases: DevPhase[]): string {
  if (devPhases.length === 0) return DEV_STAGES[0].key;
  let sawAnyMatch = false;
  for (const stage of DEV_STAGES) {
    const matched = devPhases.filter((p) => stage.matches(p.phase_key));
    if (matched.length === 0) continue;
    sawAnyMatch = true;
    if (matched.some((p) => (p.pct_complete ?? 0) < 100)) {
      return stage.key;
    }
  }
  // Phases exist but nothing matched our canonical stages → treat as
  // unseeded so the bar reflects "nothing started yet" rather than
  // implying the dev team has already cleared the first four stages.
  if (!sawAnyMatch) return DEV_STAGES[0].key;
  // Every matched phase is complete → Ready-to-Build.
  return DEV_STAGES[DEV_STAGES.length - 1].key;
}

interface Row {
  phase: "acq" | "dev" | "con";
  label: string;
  stages: { key: string; label: string }[];
  currentIdx: number | null; // null → all muted (off-pipeline / not started)
  fillPct: number;
  badge?: string; // small tag rendered next to the phase label
  onStageClick?: (stageKey: string) => void;
  muted?: boolean;
}

function buildAcqRow(deal: Deal, onAdvance?: (status: DealStatus) => void): Row {
  const isOffPipeline = deal.status === "dead" || deal.status === "archived";
  const currentIdx = isOffPipeline ? null : DEAL_PIPELINE.indexOf(deal.status);
  const stages = DEAL_PIPELINE.map((s) => ({ key: s, label: DEAL_STAGE_LABELS[s] }));
  // Fill = share of stages the deal has cleared. Off-pipeline = 0.
  const fillPct =
    currentIdx != null && currentIdx >= 0
      ? Math.round(((currentIdx + 1) / DEAL_PIPELINE.length) * 100)
      : 0;
  return {
    phase: "acq",
    label: "ACQ",
    stages,
    currentIdx: currentIdx != null && currentIdx >= 0 ? currentIdx : null,
    fillPct,
    badge: isOffPipeline ? DEAL_STAGE_LABELS[deal.status] : undefined,
    muted: isOffPipeline,
    onStageClick: onAdvance ? (key) => onAdvance(key as DealStatus) : undefined,
  };
}

function buildDevRow(devPhases: DevPhase[]): Row {
  const devTrack = devPhases.filter((p) => (p.track ?? "development") === "development");
  const hasRecognizedPhases = devTrack.some((p) =>
    DEV_STAGES.some((s) => s.matches(p.phase_key))
  );
  const currentKey = currentDevStageKey(devTrack);
  const currentIdx = DEV_STAGES.findIndex((s) => s.key === currentKey);
  // A track with no rows, or rows whose phase_keys don't map to any
  // canonical stage, shows a "No schedule" tag rather than a numeric %
  // so the bar doesn't look authoritative about a progression it can't
  // actually measure.
  const hasUsableSchedule = devTrack.length > 0 && hasRecognizedPhases;
  const fillPct = hasUsableSchedule ? weightedPct(devTrack) : 0;
  return {
    phase: "dev",
    label: "DEV",
    stages: DEV_STAGES.map((s) => ({ key: s.key, label: s.label })),
    currentIdx,
    fillPct,
    badge: hasUsableSchedule ? undefined : "No schedule",
  };
}

function buildConRow(deal: Deal, devPhases: DevPhase[]): Row {
  const conTrack = devPhases.filter((p) => p.track === "construction");
  const execPhase = deal.execution_phase as ExecutionPhase | null;
  const currentIdx = execPhase ? EXECUTION_PHASES.indexOf(execPhase) : null;
  const fillPct = conTrack.length > 0 ? weightedPct(conTrack) : 0;
  return {
    phase: "con",
    label: "CON",
    stages: EXECUTION_PHASES.map((p) => ({
      key: p,
      label: EXECUTION_PHASE_CONFIG[p].label,
    })),
    currentIdx,
    fillPct,
    badge: execPhase == null ? "Not started" : undefined,
    muted: execPhase == null,
  };
}

const PHASE_ACCENT: Record<"acq" | "dev" | "con", string> = {
  acq: "text-[hsl(var(--phase-acq))]",
  dev: "text-[hsl(var(--phase-dev))]",
  con: "text-[hsl(var(--phase-con))]",
};

function PhaseRow({ row, loading }: { row: Row; loading?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-20 shrink-0">
        <span className={cn("text-2xs font-bold tracking-wider uppercase", PHASE_ACCENT[row.phase])}>
          {row.label}
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {row.stages.map((stage, i) => {
            const isCompleted = row.currentIdx != null && row.currentIdx > i;
            const isCurrent = row.currentIdx != null && row.currentIdx === i;
            const clickable = !!row.onStageClick && !row.muted;
            const cls = cn(
              "flex-1 h-1.5 rounded-full transition-all",
              isCompleted ? "gradient-gold" : isCurrent ? "bg-primary/40" : "bg-muted/50",
              row.muted && "opacity-30",
              clickable && "cursor-pointer hover:opacity-80",
            );
            return row.onStageClick ? (
              <button
                key={stage.key}
                onClick={() => row.onStageClick?.(stage.key)}
                className={cls}
                title={stage.label}
              />
            ) : (
              <span key={stage.key} className={cls} title={stage.label} />
            );
          })}
        </div>
        <div className="flex items-center gap-1 mt-1">
          {row.stages.map((stage, i) => {
            const isCurrent = row.currentIdx != null && row.currentIdx === i;
            return (
              <span
                key={stage.key}
                className={cn(
                  "flex-1 text-[9px] text-center truncate",
                  isCurrent ? "text-primary font-semibold" : "text-muted-foreground/40",
                  row.muted && "text-muted-foreground/30",
                )}
              >
                {stage.label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="w-24 shrink-0 flex items-center justify-end gap-1.5">
        {row.badge && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/40">
            {row.badge}
          </span>
        )}
        <span className={cn("text-2xs tabular-nums font-semibold", row.muted ? "text-muted-foreground/50" : "text-foreground")}>
          {row.fillPct}%
        </span>
      </div>
    </div>
  );
}

export function PhaseProgressStrip({
  deal,
  devPhases,
  devPhasesLoading,
  onAdvanceStatus,
}: {
  deal: Deal;
  devPhases: DevPhase[];
  devPhasesLoading: boolean;
  onAdvanceStatus?: (status: DealStatus) => void;
}) {
  const { phases } = classifyDealPhase(deal);
  // Acquisition row renders whenever the deal is in an acq stage. For
  // closed / dead / archived deals the ACQ row still shows when useful:
  // closed deals keep it to show completion; dead + archived deals drop
  // it since the deal is off-pipeline.
  const showAcq =
    phases.includes("acquisition") ||
    deal.status === "closed" ||
    (deal.status !== "dead" && deal.status !== "archived");
  const showDev = deal.show_in_development === true;
  const showCon = deal.show_in_construction === true;

  const rows: Row[] = [];
  if (showAcq) rows.push(buildAcqRow(deal, onAdvanceStatus));
  if (showDev) rows.push(buildDevRow(devPhases));
  if (showCon) rows.push(buildConRow(deal, devPhases));

  return (
    <div className="px-5 py-3 bg-card border-t border-border/40 space-y-3">
      {rows.map((row, i) => (
        <PhaseRow
          key={i}
          row={row}
          loading={devPhasesLoading && (row.phase === "dev" || row.phase === "con")}
        />
      ))}
    </div>
  );
}
