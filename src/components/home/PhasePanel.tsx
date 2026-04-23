"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { PhaseNameplate } from "./PhaseNameplate";
import type { DealPhase } from "@/lib/types";
import { cn } from "@/lib/utils";

// The generic shell that renders the triptych's three department sections.
// Nameplate + KPI row + deal list + footer. Each specific panel composes this
// with its own KPIs, rows, and phase accent variable.

interface Props {
  phase: DealPhase;
  label: string;
  href: string;
  accentVar: string;
  motif: LucideIcon;
  count: number;
  kpis: ReactNode;
  children: ReactNode;   // the deal list (PhaseDealRow's)
  seeAllLabel?: string;
  emptyState?: ReactNode;
  isEmpty?: boolean;
  className?: string;
}

export function PhasePanel({
  phase,
  label,
  href,
  accentVar,
  motif,
  count,
  kpis,
  children,
  seeAllLabel,
  emptyState,
  isEmpty,
  className,
}: Props) {
  return (
    <section
      className={cn(
        "group/panel relative flex flex-col min-h-[70vh] px-6 py-8 transition-colors duration-300",
        "hover:bg-card/10",
        className
      )}
      data-phase={phase}
    >
      <PhaseNameplate
        phase={phase}
        label={label}
        count={count}
        href={href}
        accentVar={accentVar}
        motif={motif}
      />

      {/* KPI row — three figures max */}
      <div className="grid grid-cols-3 gap-4 mt-7">{kpis}</div>

      {/* Deal list */}
      <div className="mt-7 flex-1 min-h-0">
        {isEmpty ? (
          <div className="h-full flex items-center justify-center py-10">
            {emptyState ?? (
              <p className="text-xs text-muted-foreground/50 text-center max-w-[22ch] font-nameplate italic">
                No deals in this department yet.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/15">{children}</div>
        )}
      </div>

      {/* Footer — see-all link tinted to phase */}
      <div className="mt-6 pt-4 border-t border-border/20">
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide transition-all hover:gap-2"
          style={{ color: `hsl(var(${accentVar}))` }}
        >
          <span>{seeAllLabel ?? `See all in ${label}`}</span>
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}
