"use client";

import { useEffect, useRef, useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ScheduleColumnKey =
  | "predecessor"
  | "start"
  | "finish"
  | "budget"
  | "owner";

export interface ScheduleColumnVisibility {
  predecessor: boolean;
  start: boolean;
  finish: boolean;
  budget: boolean;
  owner: boolean;
}

const COLUMN_LABELS: Record<ScheduleColumnKey, string> = {
  predecessor: "Predecessor",
  start: "Start",
  finish: "Finish",
  budget: "Budget",
  owner: "Owner",
};

interface Props {
  visibility: ScheduleColumnVisibility;
  onChange: (next: ScheduleColumnVisibility) => void;
}

/**
 * Small popover beside "Add Phase" that toggles which optional columns
 * appear on the schedule's left rail. Persistence is the parent's job —
 * this component just edits the visibility object.
 */
export function ScheduleColumnsMenu({ visibility, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const keys = Object.keys(COLUMN_LABELS) as ScheduleColumnKey[];

  return (
    <div className="relative inline-block" ref={ref}>
      <Button
        size="sm"
        variant="outline"
        className="text-xs"
        onClick={() => setOpen((v) => !v)}
        title="Toggle which columns appear on the schedule"
      >
        <Columns3 className="h-3 w-3 mr-1" /> Columns
      </Button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-48 rounded-md border border-border bg-popover shadow-xl py-1.5">
          <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Optional columns
          </div>
          {keys.map((k) => (
            <label
              key={k}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer"
            >
              <input
                type="checkbox"
                checked={visibility[k]}
                onChange={(e) =>
                  onChange({ ...visibility, [k]: e.target.checked })
                }
              />
              <span>{COLUMN_LABELS[k]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
