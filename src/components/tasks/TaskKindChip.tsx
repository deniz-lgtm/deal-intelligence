import { TASK_KIND_CONFIG, type DevPhaseKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskKindChip({ kind, className }: { kind: DevPhaseKind; className?: string }) {
  if (kind === "phase" || kind === "milestone") return null;
  const config = TASK_KIND_CONFIG[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border/40 bg-background/40 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-[0.12em]",
        config.accent,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
