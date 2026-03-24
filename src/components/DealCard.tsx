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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
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
  sourcing: { variant: "secondary", dot: "bg-gray-400" },
  screening: { variant: "info", dot: "bg-blue-400" },
  loi: { variant: "warning", dot: "bg-amber-400" },
  under_contract: { variant: "warning", dot: "bg-orange-400" },
  diligence: { variant: "default", dot: "bg-primary" },
  closing: { variant: "success", dot: "bg-emerald-400" },
  closed: { variant: "success", dot: "bg-emerald-600" },
  dead: { variant: "issue", dot: "bg-rose-400" },
};

const PROPERTY_ICONS: Record<string, React.ElementType> = {
  industrial: Warehouse,
  office: Building2,
  retail: Store,
  hospitality: Hotel,
  multifamily: Building2,
  mixed_use: Building2,
};

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (score >= 6) return "text-amber-600 bg-amber-50 border-amber-200";
  if (score >= 4) return "text-orange-600 bg-orange-50 border-orange-200";
  return "text-rose-600 bg-rose-50 border-rose-200";
}

interface DealCardProps {
  deal: Deal & { om_score?: number };
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
  const badge = STATUS_BADGE[deal.status] || { variant: "secondary" as const, dot: "bg-gray-400" };
  const isDead = deal.status === "dead";
  const pipelineIndex = DEAL_PIPELINE.indexOf(deal.status);

  const PropertyIcon = PROPERTY_ICONS[deal.property_type ?? ""] ?? Building2;

  return (
    <Card className="group hover:shadow-lifted transition-all duration-200 border-border/60 shadow-card">
      <CardContent className="p-5">
        {/* Top row: status + property type + star */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", badge.dot)} />
              <Badge variant={badge.variant} className="text-xs">
                {DEAL_STAGE_LABELS[deal.status]}
              </Badge>
            </div>
            {deal.property_type && (
              <span className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                <PropertyIcon className="h-3 w-3" />
                {deal.property_type.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {deal.om_score != null && (
              <span
                className={cn(
                  "text-xs font-semibold px-1.5 py-0.5 rounded-md border",
                  scoreColor(deal.om_score)
                )}
              >
                {deal.om_score}/10
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 shrink-0 transition-all",
                deal.starred
                  ? "text-amber-500 hover:text-amber-600"
                  : "text-muted-foreground hover:text-amber-500 opacity-0 group-hover:opacity-100"
              )}
              onClick={() => onStar?.(deal.id, !deal.starred)}
            >
              <Star
                className="h-3.5 w-3.5"
                fill={deal.starred ? "currentColor" : "none"}
              />
            </Button>
          </div>
        </div>

        {/* Name + address */}
        <h3 className="font-bold text-base leading-tight mb-1 truncate">
          <Link
            href={`/deals/${deal.id}`}
            className="hover:text-primary transition-colors"
          >
            {deal.name}
          </Link>
        </h3>
        {(deal.address || deal.city) && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-3 truncate">
            <MapPin className="h-3 w-3 shrink-0" />
            {[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}
          </p>
        )}

        {/* Key metrics */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-4">
          {deal.asking_price && (
            <span className="font-semibold text-foreground">
              {formatCurrency(deal.asking_price)}
            </span>
          )}
          {deal.square_footage && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {formatNumber(deal.square_footage)} SF
            </span>
          )}
          {deal.units && (
            <span className="text-muted-foreground">{deal.units} units</span>
          )}
          {deal.bedrooms && (
            <span className="text-muted-foreground flex items-center gap-1">
              <BedDouble className="h-3 w-3" />
              {deal.bedrooms} beds
            </span>
          )}
        </div>

        {/* Pipeline progress */}
        {!isDead && (
          <div className="mb-4">
            <div className="flex items-center gap-0.5">
              {DEAL_PIPELINE.map((stage, i) => {
                const isCompleted = pipelineIndex > i;
                const isCurrent = pipelineIndex === i;
                return (
                  <div
                    key={stage}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      isCompleted
                        ? "bg-primary"
                        : isCurrent
                        ? "bg-primary/40"
                        : "bg-muted"
                    )}
                  />
                );
              })}
            </div>
          </div>
        )}
        {isDead && (
          <div className="mb-4">
            <div className="h-1 w-full rounded-full bg-rose-200" />
          </div>
        )}

        {/* Footer: doc count, LOI/PSA, checklist */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {documentCount} doc{documentCount !== 1 ? "s" : ""}
          </span>
          {checklistProgress && checklistProgress.total > 0 && (
            <span className="flex items-center gap-1">
              <span>
                {checklistProgress.complete}/{checklistProgress.total} checklist
              </span>
            </span>
          )}
          {deal.loi_executed && (
            <span className="text-emerald-600 font-medium">LOI ✓</span>
          )}
          {deal.psa_executed && (
            <span className="text-emerald-600 font-medium">PSA ✓</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Link href={`/deals/${deal.id}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs h-8">
              Overview
            </Button>
          </Link>
          <Link href={`/deals/${deal.id}/om-analysis`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-1">
              <FileSearch className="h-3 w-3" />
              OM
            </Button>
          </Link>
          <Link href={`/deals/${deal.id}/chat`} className="flex-1">
            <Button size="sm" className="w-full text-xs h-8">
              Chat
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
