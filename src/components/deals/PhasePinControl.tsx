"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Two-chip toggle for whether this deal appears in the Development and
// Construction departments on the home triptych. Acquisition membership is
// stage-based (derived, not toggled), so those two phases are the only
// things the owner chooses. A deal can be in either, both, or neither.

interface Props {
  dealId: string;
  inDevelopment: boolean;
  inConstruction: boolean;
  onChange?: (next: { show_in_development: boolean; show_in_construction: boolean }) => void;
}

export function PhasePinControl({ dealId, inDevelopment, inConstruction, onChange }: Props) {
  const [dev, setDev] = useState(inDevelopment);
  const [con, setCon] = useState(inConstruction);

  useEffect(() => setDev(inDevelopment), [inDevelopment]);
  useEffect(() => setCon(inConstruction), [inConstruction]);

  const toggle = async (which: "dev" | "con") => {
    const nextDev = which === "dev" ? !dev : dev;
    const nextCon = which === "con" ? !con : con;
    const prev = { dev, con };
    setDev(nextDev);
    setCon(nextCon);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_in_development: nextDev,
          show_in_construction: nextCon,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onChange?.({ show_in_development: nextDev, show_in_construction: nextCon });
      const label = which === "dev" ? "Development" : "Construction";
      const on = which === "dev" ? nextDev : nextCon;
      toast.success(`${on ? "Added to" : "Removed from"} ${label}`);
    } catch (err) {
      setDev(prev.dev);
      setCon(prev.con);
      toast.error(`Failed to update: ${(err as Error).message}`);
    }
  };

  return (
    <div
      className="inline-flex items-center gap-1"
      title="Choose which role departments see this deal"
    >
      <Toggle
        active={dev}
        onClick={() => toggle("dev")}
        label="Dev"
        accentVar="--phase-dev"
      />
      <Toggle
        active={con}
        onClick={() => toggle("con")}
        label="Con"
        accentVar="--phase-con"
      />
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  accentVar,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accentVar: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-2xs font-medium inline-flex items-center gap-1 h-[22px] px-2 rounded-full border transition-colors",
        active
          ? "shadow-sm"
          : "bg-card/20 border-border/60 text-muted-foreground/70 hover:border-border hover:text-foreground",
      )}
      style={
        active
          ? {
              background: `hsl(var(${accentVar}) / 0.14)`,
              borderColor: `hsl(var(${accentVar}) / 0.45)`,
              color: `hsl(var(${accentVar}))`,
            }
          : undefined
      }
    >
      {active ? (
        <Check className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      <span className="tracking-wide">{label}</span>
    </button>
  );
}
