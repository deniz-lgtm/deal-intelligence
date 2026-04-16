"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ViewModeToggle — small Basic / Advanced pill-switcher.
//
// Designed to live in a page header next to the Save / action buttons. The
// user's choice is persisted via the useViewMode hook so the toggle stays
// in sync across pages and tabs.
// ─────────────────────────────────────────────────────────────────────────────

import { Sparkles, Layers } from "lucide-react";
import type { ViewMode } from "@/lib/use-view-mode";

export default function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-border/60 bg-muted/20 p-0.5 text-[11px]"
      role="group"
      aria-label="View mode"
    >
      <button
        onClick={() => onChange("basic")}
        title="Basic — shows only the inputs that drive the model. Best for quick back-of-envelope work."
        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
          mode === "basic"
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Sparkles className="h-3 w-3" />
        Basic
      </button>
      <button
        onClick={() => onChange("advanced")}
        title="Advanced — shows every field, including text notes, rezone tracking, and AI report sections."
        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
          mode === "advanced"
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Layers className="h-3 w-3" />
        Advanced
      </button>
    </div>
  );
}
