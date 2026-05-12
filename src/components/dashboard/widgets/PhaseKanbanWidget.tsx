"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Star, MapPin } from "lucide-react";
import { classifyDealPhase } from "@/lib/phase-classification";
import { DEAL_STAGE_LABELS, type DealPhase } from "@/lib/types";
import { cn, formatCompact } from "@/lib/utils";
import { toast } from "sonner";
import type { WidgetRenderProps, DealWithStats } from "../types";

const PHASES: { id: DealPhase; label: string; accent: string; dot: string }[] = [
  { id: "acquisition", label: "Acquisition", accent: "text-indigo-300", dot: "bg-indigo-400" },
  { id: "development", label: "Development", accent: "text-amber-300", dot: "bg-amber-400" },
  { id: "construction", label: "Under Construction", accent: "text-emerald-300", dot: "bg-emerald-400" },
];

async function patchDeal(id: string, patch: Record<string, unknown>) {
  await fetch(`/api/deals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

function DealMini({ deal, onStar }: { deal: DealWithStats; onStar: (id: string, starred: boolean) => void }) {
  const cost = (deal.total_project_cost && deal.total_project_cost > 0 ? deal.total_project_cost : deal.asking_price) || 0;
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="group flex flex-col gap-1.5 rounded-md border border-border/40 bg-card/70 p-2.5 transition-colors hover:border-border hover:bg-card"
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-snug">{deal.name}</div>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStar(deal.id, !deal.starred);
          }}
          className={cn(
            "shrink-0 transition-colors",
            deal.starred ? "text-amber-400" : "text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-amber-400",
          )}
          aria-label="Star deal"
        >
          <Star className="h-3.5 w-3.5" fill={deal.starred ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1 truncate">
          <MapPin className="h-2.5 w-2.5" />
          <span className="truncate">{deal.city ?? "—"}</span>
        </span>
        <span className="rounded bg-muted/40 px-1.5 py-0.5 font-medium text-foreground/80">
          {DEAL_STAGE_LABELS[deal.status]}
        </span>
      </div>
      {cost > 0 && (
        <div className="text-xs font-medium tabular-nums text-foreground/90">${formatCompact(cost)}</div>
      )}
    </Link>
  );
}

export function PhaseKanbanWidget({ data }: WidgetRenderProps) {
  const [deals, setDeals] = useState<DealWithStats[] | null>(null);
  const active = (deals ?? data.deals).filter((d) => !["dead", "archived"].includes(d.status));

  const byPhase = useMemo(() => {
    const map: Record<DealPhase, DealWithStats[]> = { acquisition: [], development: [], construction: [] };
    for (const d of active) {
      const phases = classifyDealPhase(d).phases;
      for (const p of phases) map[p].push(d);
    }
    return map;
  }, [active]);

  const handleStar = (id: string, starred: boolean) => {
    setDeals((prev) => (prev ?? data.deals).map((d) => (d.id === id ? { ...d, starred } : d)));
    patchDeal(id, { starred }).then(() => toast.success(starred ? "Starred" : "Unstarred"));
  };

  const handleDrop = async (e: React.DragEvent, target: DealPhase) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const current = (deals ?? data.deals).find((d) => d.id === id);
    if (!current) return;
    const phases = new Set(classifyDealPhase(current).phases);
    if (phases.has(target)) return;

    const patch: Record<string, unknown> = {};
    if (target === "development") patch.show_in_development = true;
    if (target === "construction") patch.show_in_construction = true;

    setDeals((prev) =>
      (prev ?? data.deals).map((d) =>
        d.id === id
          ? {
              ...d,
              show_in_development: target === "development" ? true : d.show_in_development,
              show_in_construction: target === "construction" ? true : d.show_in_construction,
            }
          : d,
      ),
    );
    try {
      await patchDeal(id, patch);
      toast.success(`Added to ${target === "development" ? "Development" : "Under Construction"}`);
    } catch {
      toast.error("Failed to update deal");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="font-nameplate text-base tracking-tight">Pipeline by Phase</div>
        <div className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
          {active.length} active
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3">
        {PHASES.map((phase) => {
          const list = byPhase[phase.id];
          return (
            <div
              key={phase.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, phase.id)}
              className="flex min-h-0 flex-col gap-2 rounded-lg border border-border/30 bg-background/30 p-2"
            >
              <div className="flex items-center justify-between px-1.5 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", phase.dot)} />
                  <span className={cn("text-xs font-semibold uppercase tracking-[0.14em]", phase.accent)}>
                    {phase.label}
                  </span>
                </div>
                <span className="text-2xs font-medium tabular-nums text-muted-foreground">{list.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5 scrollbar-none">
                {list.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/30 px-2 py-6 text-center text-2xs text-muted-foreground/60">
                    No deals
                  </div>
                ) : (
                  list.map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
                    >
                      <DealMini deal={deal} onStar={handleStar} />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
