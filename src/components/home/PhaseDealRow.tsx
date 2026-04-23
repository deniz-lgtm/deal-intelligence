"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A compact editorial row inside a phase panel. Name + city on the left, a
// phase-specific signal slot on the right. A 2px accent rule slides in from
// the left edge on hover — replaces the generic "card" treatment with a
// typographic list more appropriate for density.

interface Props {
  dealId: string;
  name: string;
  meta: string;                  // city / address / subtitle
  signal: ReactNode;             // phase-specific right-side signal
  accentVar: string;             // e.g. "--phase-acq"
}

export function PhaseDealRow({ dealId, name, meta, signal, accentVar }: Props) {
  return (
    <Link
      href={`/deals/${dealId}`}
      className="group relative flex items-center gap-3 py-2.5 pl-3 pr-1 -ml-3 rounded-md hover:bg-card/30 transition-colors"
    >
      {/* Accent sliver — appears on hover, tints with the phase color */}
      <span
        className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[2px] origin-center transition-all duration-300 scale-y-0 group-hover:scale-y-100"
        style={{ background: `hsl(var(${accentVar}))` }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate group-hover:text-[hsl(var(--accent-color))] transition-colors"
             style={{ ["--accent-color" as string]: `var(${accentVar})` }}>
          {name}
        </div>
        {meta && (
          <div className="text-2xs text-muted-foreground/70 truncate mt-0.5">{meta}</div>
        )}
      </div>
      <div className={cn("shrink-0 flex items-center gap-2 text-2xs text-muted-foreground")}>
        {signal}
      </div>
    </Link>
  );
}
