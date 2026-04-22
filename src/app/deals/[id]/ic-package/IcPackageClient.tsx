"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import IcPackageRenderer from "./components/IcPackageRenderer";
import { DEMO_DEAL_CONTEXT, DEMO_PROSE } from "./demo-fixture";
import { buildIcPackage } from "@/lib/ic-package-mapper";
import type { DealContext, ProseSections } from "./types";

interface Props {
  dealId: string;
  /** Deal context derived server-side from the deal record. Null means we
   *  don't have enough data to render a real package yet — fall back to
   *  the demo fixture so the design system is still viewable. */
  dealContext: DealContext | null;
  /** Prose previously saved for this deal, if any. */
  savedProse: ProseSections | null;
}

/**
 * The interactive IC Package view. Owns the prose state — starts from
 * either saved prose, demo prose (for empty deals), or newly-generated
 * prose — and lets the user regenerate or print.
 */
export default function IcPackageClient({ dealId, dealContext, savedProse }: Props) {
  // If we have no real context, run in demo mode with the Crestmont fixture.
  const inDemoMode = dealContext === null;
  const [prose, setProse] = useState<ProseSections>(
    savedProse ?? (inDemoMode ? DEMO_PROSE : DEMO_PROSE)
  );
  const [generating, setGenerating] = useState(false);

  const effectiveContext = dealContext ?? DEMO_DEAL_CONTEXT;

  const pkg = useMemo(
    () => buildIcPackage(effectiveContext, prose),
    [effectiveContext, prose]
  );

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-package/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: effectiveContext }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Generation failed");
      }
      const data = (await res.json()) as { prose: ProseSections };
      setProse(data.prose);
      toast.success("Prose regenerated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function printPackage() {
    window.print();
  }

  return (
    <>
      <div className="ic-editor-toolbar">
        <div>
          {inDemoMode ? (
            <>IC PACKAGE · <strong style={{ color: "var(--ic-accent)" }}>DEMO MODE</strong> · Crestmont Reference</>
          ) : (
            <>IC PACKAGE · {pkg.masthead.dealCode}</>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={generate} disabled={generating}>
            {generating ? "Generating…" : "Regenerate Prose"}
          </button>
          <button onClick={printPackage} className="ic-primary">
            Export PDF
          </button>
        </div>
      </div>

      <IcPackageRenderer pkg={pkg} />
    </>
  );
}
