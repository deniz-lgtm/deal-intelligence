"use client";

import * as React from "react";
import { FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Document } from "@/lib/types";
import { getRelevantDocs, coverageTier, type AISection } from "@/lib/ai-sections";

// Compact inline signal that sits next to an <AIButton>. Tells the analyst
// BEFORE they click: "how much real signal backs this autofill vs.
// how much is the model extrapolating?".
//
// Rendering tiers:
//   high   — ≥ 3 relevant docs. Green. Examples preview.
//   medium — 1–2 docs. Amber. Single doc name.
//   low    — 0 docs. Muted. "AI only" copy.

export interface DocCoverageChipProps {
  documents: Document[];
  section: AISection;
  className?: string;
  // Max doc names to preview in the chip label. Rest summarized as "+N".
  previewLimit?: number;
}

const TIER_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  low: "bg-muted/30 text-muted-foreground border-border/40",
};

export function DocCoverageChip({
  documents,
  section,
  className,
  previewLimit = 2,
}: DocCoverageChipProps) {
  const relevant = getRelevantDocs(documents, section);
  const tier = coverageTier(relevant.length);

  const Icon = tier === "low" ? Sparkles : FileText;

  // Tooltip lists every relevant doc in ranked order — useful when the
  // chip's label has been truncated to previewLimit entries.
  const tooltip =
    relevant.length === 0
      ? "No relevant documents — AI will infer from deal context only."
      : relevant
          .map((r) => `${r.doc.original_name || r.doc.name} (${r.matched.join(", ")})`)
          .join("\n");

  const label = (() => {
    if (relevant.length === 0) return "No docs — AI only";
    const names = relevant
      .slice(0, previewLimit)
      .map((r) => shortName(r.doc.original_name || r.doc.name));
    const extra = relevant.length - names.length;
    const base = `${relevant.length} doc${relevant.length === 1 ? "" : "s"} · ${names.join(", ")}`;
    return extra > 0 ? `${base} +${extra}` : base;
  })();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium",
        TIER_STYLES[tier],
        className,
      )}
      title={tooltip}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-[28ch]">{label}</span>
    </span>
  );
}

function shortName(raw: string): string {
  // Drop the extension and truncate — the chip is meant to be scanned,
  // not read in full. Full names live in the tooltip.
  const noExt = raw.replace(/\.[^.]+$/, "");
  return noExt.length > 20 ? noExt.slice(0, 18) + "…" : noExt;
}
