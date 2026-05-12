"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from "@/lib/deal-stage";

interface StageStepperProps {
  current: DealStage;
  basePath: string;
}

const STAGE_ENTRY_HREF: Record<DealStage, string> = {
  screen: "/om-analysis",
  underwrite: "/underwriting",
  loi_dd: "/loi",
  close: "/investment-package",
  build: "/construction",
  stabilize: "/reports",
};

/**
 * A six-step pipeline header — Screen → Underwrite → LOI/DD → Close →
 * Build → Stabilize — showing the current stage. Each step is a link
 * that jumps to the canonical entry page for that stage so a power
 * user can hop forward to set up the next phase without changing the
 * deal's status.
 */
export function StageStepper({ current, basePath }: StageStepperProps) {
  const currentIndex = DEAL_STAGES.indexOf(current);

  return (
    <nav
      aria-label="Deal stage"
      className="border-b border-border/40 bg-card/60 backdrop-blur-sm"
    >
      <ol className="mx-auto flex max-w-7xl items-stretch gap-0 overflow-x-auto px-2 sm:px-4">
        {DEAL_STAGES.map((stage, i) => {
          const isCurrent = stage === current;
          const isPast = i < currentIndex;
          const href = `${basePath}${STAGE_ENTRY_HREF[stage]}`;
          return (
            <li key={stage} className="flex flex-1 min-w-[110px] items-stretch">
              <Link
                href={href}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "group relative flex flex-1 items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors",
                  isCurrent && "text-foreground",
                  isPast && "text-muted-foreground/80 hover:text-foreground",
                  !isCurrent && !isPast && "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    isPast && "border-emerald-500/60 bg-emerald-500/15 text-emerald-500",
                    !isCurrent && !isPast && "border-border/60 bg-background/60"
                  )}
                >
                  {isPast ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="whitespace-nowrap">{DEAL_STAGE_LABELS[stage]}</span>
                {isCurrent && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary"
                  />
                )}
              </Link>
              {i < DEAL_STAGES.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "self-center text-muted-foreground/30",
                    isPast && "text-emerald-500/50"
                  )}
                >
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
