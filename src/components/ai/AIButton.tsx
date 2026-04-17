"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Document } from "@/lib/types";
import type { AISection } from "@/lib/ai-sections";
import type { AIFillResult } from "./types";
import { summarizeAIFill } from "./types";
import { DocCoverageChip } from "./DocCoverageChip";

// One standard AI-autofill button. Every Sparkles button across the deal
// pages should be an instance of this — don't hand-roll another
// "loading ? <Loader /> : <Sparkles />" + toast pattern.
//
// Behaviour:
//   • Shows Sparkles (or custom icon) alongside the label.
//   • Swaps to a spinner while the async onClick runs.
//   • On success, applies the returned fields via onApply + toasts a
//     standardized summary ("N fields filled · X from docs, Y from AI").
//   • On failure, toasts the error message.
//   • Pairs with an inline <DocCoverageChip> so the analyst sees doc
//     coverage for this section before clicking — no click-then-regret.

export interface AIButtonProps<T = Record<string, unknown>>
  extends Omit<ButtonProps, "onClick" | "children"> {
  label: string;
  // The AI section this button targets. Drives the inline coverage chip
  // and the toast's "from docs vs. AI" breakdown.
  section: AISection;
  // Documents currently on the deal — needed by the coverage chip.
  documents?: Document[];
  // Called when the user clicks. Should perform the fetch and return the
  // parsed AIFillResult. Any thrown error is caught and shown as a toast.
  onFill: () => Promise<AIFillResult<T>>;
  // Receives the result so the caller can merge fields into form state.
  onApply: (result: AIFillResult<T>) => void;
  // Override the default Sparkles icon (e.g. for the Zoning Report button
  // that uses a map icon). Rendered only in the idle state.
  icon?: React.ComponentType<{ className?: string }>;
  // Hide the coverage chip (e.g. on pages that already show doc coverage
  // elsewhere and don't want a second chip). Defaults to showing.
  hideCoverage?: boolean;
  // Suppress the default success toast (use when the caller wants to
  // render its own richer summary, e.g. a modal preview of AI output).
  silent?: boolean;
}

export function AIButton<T = Record<string, unknown>>({
  label,
  section,
  documents,
  onFill,
  onApply,
  icon: IconOverride,
  hideCoverage = false,
  silent = false,
  disabled,
  className,
  size = "sm",
  variant = "outline",
  ...rest
}: AIButtonProps<T>) {
  const [loading, setLoading] = React.useState(false);
  const Icon = IconOverride ?? Sparkles;

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await onFill();
      onApply(result);
      if (!silent) {
        const summary = result.narrative ?? summarizeAIFill(result);
        toast.success(summary);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI fill failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        onClick={handleClick}
        disabled={disabled || loading}
        size={size}
        variant={variant}
        className={cn("gap-1.5", className)}
        {...rest}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {!hideCoverage && documents && (
        <DocCoverageChip documents={documents} section={section} />
      )}
    </span>
  );
}
