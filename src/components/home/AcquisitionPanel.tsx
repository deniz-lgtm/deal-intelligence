"use client";

import { Compass } from "lucide-react";
import { PhasePanel } from "./PhasePanel";
import { PhaseKPI } from "./PhaseKPI";
import { PhaseDealRow } from "./PhaseDealRow";
import type { Deal, DealStatus } from "@/lib/types";
import { DEAL_STAGE_LABELS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

// Acquisition panel — the pipeline hunt. KPIs focus on active pipeline value,
// count of active deals, and average OM score. Rows show the highest-signal
// deals first (scored highest, then most recent) with stage + checklist %
// as the compact per-row signal.

interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  total_project_cost?: number | null;
}

interface Props {
  deals: DealWithStats[];   // already-filtered to this phase
  allDeals: DealWithStats[]; // for KPI math across entire acq set
}

const STAGE_DOT: Partial<Record<DealStatus, string>> = {
  sourcing: "bg-zinc-400",
  screening: "bg-blue-400",
  loi: "bg-amber-400",
  under_contract: "bg-orange-400",
  diligence: "bg-primary",
  closing: "bg-emerald-400",
};

export function AcquisitionPanel({ deals, allDeals }: Props) {
  const dealCost = (d: DealWithStats) =>
    (d.total_project_cost && d.total_project_cost > 0 ? d.total_project_cost : d.asking_price) || 0;

  const pipelineValue = allDeals
    .filter((d) => ["under_contract", "diligence", "closing"].includes(d.status))
    .reduce((sum, d) => sum + dealCost(d), 0);

  const scored = allDeals.filter((d) => d.om_score != null);
  const avgOm =
    scored.length > 0
      ? (scored.reduce((s, d) => s + (d.om_score || 0), 0) / scored.length).toFixed(1)
      : "—";

  // Auto-ingested deals (from the AI sourcing inbox) sit in "needs triage"
  // state until a human opens them. Surface the count on the nameplate only
  // when there's real flow — zero means the chip doesn't render at all.
  const unreviewed = allDeals.filter(
    (d) => d.auto_ingested && !d.inbox_reviewed_at,
  ).length;
  const action = unreviewed > 0
    ? { label: `${unreviewed} to review`, href: "/inbox" }
    : null;

  // Top-of-panel rows: sort by om_score desc (nulls last), tiebreak by updated_at
  const rows = [...deals]
    .sort((a, b) => {
      const aScore = a.om_score ?? -1;
      const bScore = b.om_score ?? -1;
      if (aScore !== bScore) return bScore - aScore;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .slice(0, 6);

  return (
    <PhasePanel
      phase="acquisition"
      label="Acquisition"
      href="/acquisition"
      accentVar="--phase-acq"
      motif={Compass}
      count={deals.length}
      isEmpty={deals.length === 0}
      action={action}
      kpis={
        <>
          <PhaseKPI
            value={pipelineValue > 0 ? formatCurrency(pipelineValue) : "—"}
            label="Pipeline"
            accentVar="--phase-acq"
            muted={pipelineValue === 0}
          />
          <PhaseKPI
            value={allDeals.length}
            label="Active"
            accentVar="--phase-acq"
          />
          <PhaseKPI
            value={avgOm}
            label="Avg OM"
            accentVar="--phase-acq"
            muted={avgOm === "—"}
          />
        </>
      }
    >
      {rows.map((d) => {
        const done = d.checklist_complete ?? 0;
        const total = d.checklist_total ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : null;
        return (
          <PhaseDealRow
            key={d.id}
            dealId={d.id}
            name={d.name}
            meta={[d.city, d.state].filter(Boolean).join(", ")}
            accentVar="--phase-acq"
            signal={
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[d.status] ?? "bg-muted-foreground/30"}`} />
                  <span className="uppercase tracking-wider text-[10px] text-muted-foreground">
                    {DEAL_STAGE_LABELS[d.status] ?? d.status}
                  </span>
                </span>
                {pct !== null && (
                  <span className="tabular-nums text-[10px] text-muted-foreground/70">
                    {pct}%
                  </span>
                )}
              </>
            }
          />
        );
      })}
    </PhasePanel>
  );
}
