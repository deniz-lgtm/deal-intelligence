"use client";

import { BarChart3, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";

// Placeholder for the workspace-level Comps Library. The full feature —
// cross-deal comp browsing, filters, "save deal actuals as a comp", and
// "copy workspace comp into this deal" actions — is the next build. For now
// the route exists so the left-rail entry points somewhere and users can
// see what's coming.

export default function CompsLibraryPage() {
  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0">
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center gap-3 h-14">
              <span className="font-display text-base text-foreground tracking-tight">
                Comps Library
              </span>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                Workspace-level
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-display font-semibold">
              Comps Library — Coming next
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The workspace-level comp library will let you browse every comp
              you&apos;ve ever saved across all deals, filter by market / type /
              date, and pull them into a new deal&apos;s underwriting with one
              click.
            </p>
            <div className="text-left text-xs text-muted-foreground bg-card/60 border border-border/40 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                What&apos;s coming
              </div>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>
                  Save deal actuals (closed deal underwriting) as workspace
                  comps
                </li>
                <li>Save comps from OMs you reviewed but didn&apos;t pursue</li>
                <li>Every comp tagged with its source deal for provenance</li>
                <li>
                  Search by address, market, property type, date range, and
                  price band
                </li>
                <li>
                  &quot;Copy into this deal&quot; action to reuse comps across
                  underwriting cycles
                </li>
              </ul>
            </div>
            <div className="text-xs text-muted-foreground">
              For now, add comps per-deal via the{" "}
              <span className="text-foreground">Comps &amp; Market</span> tab on
              any deal.
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
