"use client";

import Link from "next/link";
import { Calculator, SlidersHorizontal, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export default function AssumptionsPage() {
  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/40 bg-card/40 px-6 py-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Assumptions
          </div>
          <h1 className="mt-2 font-display text-2xl">BOE defaults are next.</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            This will become the simple defaults page for vacancy, OpEx, hard cost, cap rate, affordability, and unit-mix assumptions. For now, use each deal&apos;s underwriting model as the live editor.
          </p>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <section className="max-w-3xl rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Calculator className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold">Keep underwriting as the source of truth for this pass.</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  I am keeping this page intentionally light while we simplify the product. The next proper version should expose global BOE defaults and per-deal overrides without dragging the full old underwriting UI into every screen.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm" className="gap-1.5">
                    <Link href="/">
                      Open deals
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/deals/new">Create BOE deal</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </AppShell>
  );
}
