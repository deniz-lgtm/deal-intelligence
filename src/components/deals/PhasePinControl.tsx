"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DealPhaseOverride } from "@/lib/types";

// Owner-facing override for the triptych home page. When set, the deal
// surfaces in the chosen department regardless of stage / data signals.
// `null` (Auto) means classify from status + signals. `multi` keeps the
// auto-classified set but forces it to be visible in every match.

type PinValue = DealPhaseOverride | null;

interface Option {
  value: PinValue;
  label: string;
  description: string;
  dot: string;        // tailwind bg-* class for the left dot
  textOn: string;     // color class applied when this is the current value
}

const OPTIONS: Option[] = [
  {
    value: null,
    label: "Auto",
    description: "Classify by stage & data",
    dot: "bg-muted-foreground/40",
    textOn: "text-muted-foreground",
  },
  {
    value: "acquisition",
    label: "Acquisition",
    description: "Sourcing through closing",
    dot: "bg-[hsl(var(--phase-acq))]",
    textOn: "text-[hsl(var(--phase-acq))]",
  },
  {
    value: "development",
    label: "Development",
    description: "Entitlements, programming, pre-dev",
    dot: "bg-[hsl(var(--phase-dev))]",
    textOn: "text-[hsl(var(--phase-dev))]",
  },
  {
    value: "construction",
    label: "Construction",
    description: "Budget, draws, permits, progress",
    dot: "bg-[hsl(var(--phase-con))]",
    textOn: "text-[hsl(var(--phase-con))]",
  },
  {
    value: "multi",
    label: "Multi-phase",
    description: "Show in every matching department",
    dot: "bg-gradient-to-r from-[hsl(var(--phase-acq))] via-[hsl(var(--phase-dev))] to-[hsl(var(--phase-con))]",
    textOn: "text-foreground",
  },
];

interface Props {
  dealId: string;
  value: PinValue;
  onChange?: (next: PinValue) => void;
}

export function PhasePinControl({ dealId, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<PinValue>(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setCurrent(value), [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = OPTIONS.find((o) => o.value === current) ?? OPTIONS[0];

  const choose = async (next: PinValue) => {
    if (next === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const previous = current;
    setCurrent(next);               // optimistic
    setOpen(false);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_phase: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      onChange?.(next);
      const label = OPTIONS.find((o) => o.value === next)?.label ?? "Auto";
      toast.success(`Phase set to ${label}`);
    } catch (err) {
      setCurrent(previous);
      toast.error(`Failed to set phase: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className={cn(
          "text-2xs font-medium inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border transition-colors",
          "border-border/60 hover:border-border bg-card/40 hover:bg-card",
          saving && "opacity-60 cursor-wait"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Pin this deal to a phase for the home-page triptych"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", active.dot)} />
        <Layers className="h-3 w-3 text-muted-foreground/70" />
        <span className={cn("tracking-wide", active.textOn)}>{active.label}</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground/70 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 rounded-lg border border-border bg-popover shadow-lifted-md overflow-hidden animate-fade-up"
        >
          <div className="px-3 py-2 border-b border-border/60">
            <div className="font-display text-sm leading-tight">Phase</div>
            <div className="text-2xs text-muted-foreground mt-0.5">
              Where this deal lives on the home triptych.
            </div>
          </div>
          <ul className="py-1">
            {OPTIONS.map((opt) => {
              const selected = opt.value === current;
              return (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(opt.value)}
                    className={cn(
                      "w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-accent/50 transition-colors"
                    )}
                  >
                    <span className={cn("mt-1 h-2 w-2 rounded-full shrink-0", opt.dot)} />
                    <span className="flex-1 min-w-0">
                      <span className={cn("block text-xs font-medium", selected && opt.textOn)}>
                        {opt.label}
                      </span>
                      <span className="block text-2xs text-muted-foreground leading-tight mt-0.5">
                        {opt.description}
                      </span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
