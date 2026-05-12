"use client";

import { useState } from "react";
import { Eye, Loader2, Send, Skull, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Decision = "send_to_loi" | "park" | "kill";

interface ScreeningPanelProps {
  itemId: string;
  onDecided: () => void;
  onViewOm: () => void;
}

/**
 * The three-action screening triage block under each inbox card.
 * Replaces the old single "Dismiss" with a thesis-carrying verdict that
 * gets persisted to `screen_decisions` and updates the deal's pipeline
 * status.
 */
export function ScreeningPanel({ itemId, onDecided, onViewOm }: ScreeningPanelProps) {
  const [thesis, setThesis] = useState("");
  const [pending, setPending] = useState<Decision | null>(null);

  const submit = async (decision: Decision) => {
    setPending(decision);
    try {
      const res = await fetch(`/api/inbox/items/${itemId}/screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, thesis: thesis.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Failed to record decision");
        return;
      }
      toast.success(
        decision === "send_to_loi"
          ? "Sent to LOI"
          : decision === "park"
            ? "Parked for later"
            : "Killed"
      );
      onDecided();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold">Screen this deal</div>
        <button
          type="button"
          onClick={onViewOm}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/35 hover:text-foreground"
        >
          <Eye className="h-3 w-3" />
          View OM
        </button>
      </div>
      <textarea
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="One-line thesis — why is this worth pursuing (or not)?"
        rows={2}
        maxLength={1000}
        className="w-full resize-none rounded-md border border-border/50 bg-background/60 px-2.5 py-2 text-xs leading-5 placeholder:text-muted-foreground/60 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending !== null}
          onClick={() => submit("send_to_loi")}
          className="bg-emerald-600 hover:bg-emerald-600/90"
        >
          {pending === "send_to_loi" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Send to LOI
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => submit("park")}
        >
          {pending === "park" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Snowflake className="mr-1.5 h-3.5 w-3.5" />
          )}
          Park
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => submit("kill")}
          className="border-rose-500/35 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
        >
          {pending === "kill" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Skull className="mr-1.5 h-3.5 w-3.5" />
          )}
          Kill
        </Button>
      </div>
    </div>
  );
}
