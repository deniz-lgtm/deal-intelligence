"use client";

import { cn } from "@/lib/utils";

// A single KPI tile for a phase panel. Large display numeral, uppercase label
// below with wide tracking — the editorial masthead figure treatment.

interface Props {
  value: string | number;
  label: string;
  accentVar?: string;   // e.g. "--phase-acq"; when set, tints the value
  suffix?: string;
  muted?: boolean;      // render as placeholder/dim when there's no data
}

export function PhaseKPI({ value, label, accentVar, suffix, muted }: Props) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "font-display text-3xl md:text-4xl leading-none tabular-nums tracking-tight",
          muted && "text-muted-foreground/40"
        )}
        style={accentVar && !muted ? { color: `hsl(var(${accentVar}))` } : undefined}
      >
        <span>{value}</span>
        {suffix && <span className="text-base text-muted-foreground/60 ml-1">{suffix}</span>}
      </div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </div>
    </div>
  );
}
