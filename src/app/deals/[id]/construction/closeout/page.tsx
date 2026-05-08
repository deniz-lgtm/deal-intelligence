"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import CloseoutChecklist from "@/components/CloseoutChecklist";

// Punch List / Closeout — uses the dedicated CloseoutChecklist component
// (per-item document upload + AI verification + editable sections).
// Template is seeded on demand from this page so deals that never reach
// construction don't carry irrelevant rows.

export default function CloseoutPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [hasItems, setHasItems] = useState<boolean | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/checklist?deal_id=${dealId}&phase=closeout`);
        const j = await res.json();
        if (!cancelled) setHasItems((j.data?.length ?? 0) > 0);
      } catch (err) {
        console.error("Failed to load closeout checklist", err);
        if (!cancelled) setHasItems(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const seed = async () => {
    setSeeding(true);
    try {
      await fetch(`/api/deals/${dealId}/closeout/seed`, { method: "POST" });
      setHasItems(true);
    } catch (err) {
      console.error("Failed to seed closeout checklist", err);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            Closeout Checklist
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Permits, warranties, lien waivers, retainage release, punch list, and operations handover.
            Track everything required to wind down construction and turn the building over to operations.
          </p>
        </div>
      </div>

      {hasItems === null ? (
        <div className="text-xs text-muted-foreground py-12 text-center">Loading…</div>
      ) : !hasItems ? (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-8 text-center">
          <Sparkles className="h-6 w-6 mx-auto mb-3 text-primary" />
          <h3 className="font-display text-lg mb-1">Seed the closeout checklist</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Create the standard ~40-item closeout list (CofO, warranties, as-builts, lien waivers,
            final draw, retainage, punch list, insurance, ops handover). You can add or remove items afterward.
          </p>
          <Button onClick={seed} disabled={seeding} size="sm">
            {seeding ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Seeding…</>
            ) : (
              <>Seed Closeout List</>
            )}
          </Button>
        </div>
      ) : (
        <CloseoutChecklist dealId={dealId} />
      )}
    </div>
  );
}
