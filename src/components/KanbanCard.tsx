"use client";

import Link from "next/link";
import {
  Star,
  MapPin,
  FileText,
  HardHat,
} from "lucide-react";
import { formatCurrency, cn, titleCase } from "@/lib/utils";
import type { Deal } from "@/lib/types";
import type { ExecutionPhase } from "@/lib/types";
import { EXECUTION_PHASE_CONFIG } from "@/lib/types";

interface KanbanCardProps {
  deal: Deal & { document_count?: number; checklist_complete?: number; checklist_total?: number; total_project_cost?: number | null };
  onStar?: (id: string, starred: boolean) => void;
  onDragStart?: (e: React.DragEvent, dealId: string) => void;
}

// Composite (0–100). Bands match `bandFor` in src/lib/quant-score/types.
function quantColor(score: number): string {
  if (score >= 80) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  if (score >= 65) return "text-blue-400 bg-blue-500/10 border-blue-500/30";
  if (score >= 50) return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  return "text-rose-400 bg-rose-500/10 border-rose-500/30";
}

export default function KanbanCard({ deal, onStar, onDragStart }: KanbanCardProps) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, deal.id)}
      className="group rounded-lg border border-border/40 bg-card/80 hover:bg-card hover:border-border hover:shadow-lifted p-3 transition-all duration-200 cursor-grab active:cursor-grabbing active:shadow-lifted active:scale-[1.02] active:border-primary/40 active:z-10"
    >
      {/* Header: name + star */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-display text-xl leading-tight line-clamp-2">
          <Link
            href={`/deals/${deal.id}`}
            className="hover:text-primary transition-colors"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          >
            {deal.name}
          </Link>
        </h4>
        <button
          className={cn(
            "h-6 w-6 shrink-0 rounded flex items-center justify-center transition-all duration-200",
            deal.starred
              ? "text-amber-400"
              : "text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-amber-400"
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStar?.(deal.id, !deal.starred);
          }}
        >
          <Star className="h-3 w-3" fill={deal.starred ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Location */}
      {(deal.city || deal.state) && (
        <p className="text-2xs text-muted-foreground flex items-center gap-1 mb-2 truncate">
          <MapPin className="h-2.5 w-2.5 shrink-0 text-muted-foreground/30" />
          {[deal.city, deal.state].filter(Boolean).join(", ")}
        </p>
      )}

      {/* Total Project Cost */}
      {(deal.total_project_cost || deal.asking_price) ? (
        <p className="text-xs font-semibold tabular-nums text-foreground mb-2">
          {formatCurrency(deal.total_project_cost && deal.total_project_cost > 0 ? deal.total_project_cost : deal.asking_price)}
        </p>
      ) : null}

      {/* Execution badge for closed deals */}
      {deal.execution_phase && (
        <Link
          href={`/deals/${deal.id}/construction`}
          className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        >
          <HardHat className="h-3 w-3 text-amber-400" />
          <span className="text-[10px] font-medium text-amber-400">In Execution</span>
          <span className={cn("text-[10px] px-1 py-0 rounded ml-auto", EXECUTION_PHASE_CONFIG[deal.execution_phase]?.color ?? "")}>
            {EXECUTION_PHASE_CONFIG[deal.execution_phase]?.label ?? deal.execution_phase}
          </span>
        </Link>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between text-2xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {deal.property_type && (
            <span className="capitalize">{titleCase(deal.property_type)}</span>
          )}
          {deal.document_count != null && deal.document_count > 0 && (
            <span className="flex items-center gap-0.5">
              <FileText className="h-2.5 w-2.5" />
              {deal.document_count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {deal.loi_executed && (
            <span className="text-emerald-400 font-medium text-[10px]">LOI</span>
          )}
          {deal.quant_composite != null && (
            <span
              className={cn(
                "text-[10px] font-bold px-1.5 py-0 rounded border tabular-nums",
                quantColor(deal.quant_composite)
              )}
              title={`Quant Score · ${deal.quant_stage?.toUpperCase() ?? ""} · confidence ${
                deal.quant_confidence != null ? Math.round(deal.quant_confidence * 100) + "%" : "—"
              }`}
            >
              {Math.round(deal.quant_composite)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
