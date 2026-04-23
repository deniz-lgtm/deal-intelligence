"use client";

import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealPhase } from "@/lib/types";

// Department masthead for the triptych home. Instrument Serif display name,
// phase-tinted motif glyph, and a hairline rule that animates across on hover
// — editorial magazine feel, not a dashboard title.
//
// `action` is an optional "something needs your attention" chip — e.g. "3 to
// review" — that only renders when the panel has real pending work. Quiet
// when there's nothing to do; not a manufactured metric.

interface Props {
  phase: DealPhase;
  label: string;
  count: number;
  motif: LucideIcon;
  href: string;
  accentVar: string;  // e.g. "--phase-acq"
  action?: { label: string; href?: string } | null;
}

export function PhaseNameplate({ phase, label, count, motif: Motif, href, accentVar, action }: Props) {
  return (
    <div className="group/nameplate">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <Link
            href={href}
            className={cn(
              "font-nameplate text-3xl leading-none tracking-tight transition-colors",
              "text-foreground hover:text-[hsl(var(--accent-color))]"
            )}
            style={{ ["--accent-color" as string]: `var(${accentVar})` }}
          >
            {label}
          </Link>
          <span
            className="text-2xs font-medium tabular-nums uppercase tracking-[0.15em]"
            style={{ color: `hsl(var(${accentVar}) / 0.8)` }}
          >
            {count} {count === 1 ? "deal" : "deals"}
          </span>
          {action &&
            (action.href ? (
              <Link
                href={action.href}
                className="text-2xs font-medium uppercase tracking-[0.15em] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
                style={{
                  background: `hsl(var(${accentVar}) / 0.14)`,
                  color: `hsl(var(${accentVar}))`,
                }}
              >
                {action.label}
              </Link>
            ) : (
              <span
                className="text-2xs font-medium uppercase tracking-[0.15em] px-1.5 py-0.5 rounded"
                style={{
                  background: `hsl(var(${accentVar}) / 0.14)`,
                  color: `hsl(var(${accentVar}))`,
                }}
              >
                {action.label}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Motif
            className="h-4 w-4 transition-transform duration-500 group-hover/nameplate:rotate-[8deg]"
            style={{ color: `hsl(var(${accentVar}))` }}
            strokeWidth={1.5}
            data-phase={phase}
          />
          <Link
            href={href}
            aria-label={`Open ${label} workspace`}
            className="h-6 w-6 rounded-full flex items-center justify-center border border-border/40 hover:border-border transition-colors"
          >
            <ArrowUpRight className="h-3 w-3 text-muted-foreground group-hover/nameplate:text-foreground transition-colors" />
          </Link>
        </div>
      </div>
      {/* Hairline rule — phase accent at low opacity, animates across on panel hover */}
      <div
        className="mt-3 h-px origin-left transition-transform duration-[500ms] ease-out scale-x-[0.35] group-hover/panel:scale-x-100"
        style={{ background: `hsl(var(${accentVar}))` }}
      />
    </div>
  );
}
