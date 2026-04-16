"use client";

import Link from "next/link";
import {
  Star,
  MapPin,
  Building2,
  FileText,
  BedDouble,
  Warehouse,
  Store,
  Hotel,
  FileSearch,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber, cn, titleCase } from "@/lib/utils";
import type { Deal, DealStatus } from "@/lib/types";
import { DEAL_PIPELINE, DEAL_STAGE_LABELS } from "@/lib/types";

const STATUS_BADGE: Record<
  DealStatus,
  {
    variant:
      | "default"
      | "secondary"
      | "outline"
      | "destructive"
      | "success"
      | "warning"
      | "info"
      | "issue";
    dot: string;
  }
> = {
  sourcing: { variant: "secondary", dot: "bg-zinc-400" },
  screening: { variant: "info", dot: "bg-blue-400" },
  loi: { variant: "warning", dot: "bg-amber-400" },
  under_contract: { variant: "warning", dot: "bg-orange-400" },
  diligence: { variant: "default", dot: "bg-primary" },
  closing: { variant: "success", dot: "bg-emerald-400" },
  closed: { variant: "success", dot: "bg-emerald-500" },
  dead: { variant: "issue", dot: "bg-red-400" },
  archived: { variant: "outline", dot: "bg-zinc-300" },
};

const PROPERTY_ICONS: Record<string, React.ElementType> = {
  industrial: Warehouse,
  office: Building2,
  retail: Store,
  hospitality: Hotel,
  multifamily: Building2,
  sfr: Building2,
  mixed_use: Building2,
};

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (score >= 6) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  if (score >= 4) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
  return "text-red-400 bg-red-500/10 border-red-500/20";
}

interface DealCardProps {
  deal: Deal;
  documentCount?: number;
  checklistProgress?: { complete: number; total: number };
  onStar?: (id: string, starred: boolean) => void;
}

export default function DealCard({
  deal,
  documentCount = 0,
  checklistProgress,
  onStar,
}: DealCardProps) {
  const badge = STATUS_BADGE[deal.status] || { variant: "secondary" as const, dot: "bg-zinc-400" };
  const isDead = deal.status === "dead";
  const pipelineIndex = DEAL_PIPELINE.indexOf(deal.status);

  const PropertyIcon = PROPERTY_ICONS[deal.property_type ?? ""] ?? Building2;

  return (
    <Card className="group hover:shadow-lifted hover:border-border transition-all duration-300 overflow-hidden">
      <CardContent className="p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Badge variant={badge.variant} className="text-2xs gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", badge.dot)} />
              {DEAL_STAGE_LABELS[deal.status]}
            </Badge>
            {deal.property_type && (
              <span className="text-2xs text-muted-foreground capitalize flex items-center gap-1">
                <PropertyIcon className="h-3 w-3" />
                {titleCase(deal.property_type)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {deal.om_score != null && (
              <span
                className={cn(
                  "text-2xs font-bold px-2 py-0.5 rounded-md border tabular-nums",
                  scoreColor(deal.om_score)
                )}
              >
                {deal.om_score}/10
              </span>
            )}
            <button
              className={cn(
                "h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-all duration-200",
                deal.starred
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-muted-foreground/20 hover:text-amber-400 opacity-0 group-hover:opacity-100"
              )}
              onClick={() => onStar?.(deal.id, !deal.starred)}
            >
              <Star
                className="h-3.5 w-3.5"
                fill={deal.starred ? "currentColor" : "none"}
              />
            </button>
          </div>
        </div>

        {/* Name + address */}
        <h3 className="font-display text-lg leading-tight mb-1">
          <Link
            href={`/deals/${deal.id}`}
            className="hover:text-primary transition-colors duration-200"
          >
            {deal.name}
          </Link>
        </h3>
        {(deal.address || deal.city) && (
          <p className="text-2xs text-muted-foreground flex items-center gap-1 mb-4 truncate">
            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/40" />
            {[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}
          </p>
        )}

        {/* Key metrics */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-5">
          {deal.asking_price && (
            <span className="font-semibold text-foreground tabular-nums">
              {formatCurrency(deal.asking_price)}
            </span>
          )}
          {deal.square_footage && (
            <span className="text-muted-foreground flex items-center gap-1 tabular-nums">
              {formatNumber(deal.square_footage)} SF
            </span>
          )}
          {deal.units && (
            <span className="text-muted-foreground tabular-nums">{formatNumber(deal.units)} units</span>
          )}
          {deal.bedrooms && (
            <span className="text-muted-foreground flex items-center gap-1 tabular-nums">
              <BedDouble className="h-3 w-3" />
              {formatNumber(deal.bedrooms)}
            </span>
          )}
        </div>

        {/* Pipeline progress */}
        <div className="mb-5">
          <div className="flex items-center gap-[3px]">
            {isDead ? (
              <div className="h-1 w-full rounded-full bg-red-500/20" />
            ) : (
              DEAL_PIPELINE.map((stage, i) => {
                const isCompleted = pipelineIndex > i;
                const isCurrent = pipelineIndex === i;
                return (
                  <div
                    key={stage}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors duration-300",
                      isCompleted
                        ? "gradient-gold"
                        : isCurrent
                        ? "bg-primary/30"
                        : "bg-muted"
                    )}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Footer metadata */}
        <div className="flex items-center gap-3 text-2xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3 text-muted-foreground/40" />
            {documentCount} doc{documentCount !== 1 ? "s" : ""}
          </span>
          {checklistProgress && checklistProgress.total > 0 && (
            <span className="tabular-nums">
              {checklistProgress.complete}/{checklistProgress.total} checklist
            </span>
          )}
          {deal.loi_executed && (
            <span className="text-emerald-400 font-medium">LOI ✓</span>
          )}
          {deal.psa_executed && (
            <span className="text-emerald-400 font-medium">PSA ✓</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Link href={`/deals/${deal.id}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs h-9">
              Overview
            </Button>
          </Link>
          <Link href={`/deals/${deal.id}/om-analysis`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs h-9 gap-1">
              <FileSearch className="h-3 w-3" />
              OM
            </Button>
          </Link>
          <Link href={`/deals/${deal.id}/chat`} className="flex-1">
            <Button size="sm" className="w-full text-xs h-9 gap-1">
              Chat
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
