"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

interface SourceRow {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string;
  deal_count: number;
  avg_quant: string | null;
  closed_count: number;
}

function quantTone(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-500";
  if (score >= 55) return "text-amber-500";
  return "text-rose-500";
}

export default function ContactSourcesPage() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contacts/sources")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && Array.isArray(j.data)) setRows(j.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/40 bg-card/40 px-6 py-3">
          <div className="mx-auto max-w-5xl">
            <Link
              href="/contacts"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              All contacts
            </Link>
            <div className="mt-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">Sourcing rollup</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Where deals come from — count, average score, and closed count by source.
            </p>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-card/40 p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No sourcing data yet. Mark a deal contact as the source on the
                deal&apos;s contacts page to start the rollup.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
              <table className="w-full text-sm">
                <thead className="border-b border-border/40 bg-card/80">
                  <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-4 py-2">Source</th>
                    <th className="px-4 py-2">Company</th>
                    <th className="px-4 py-2 text-right">Deals</th>
                    <th className="px-4 py-2 text-right">Avg score</th>
                    <th className="px-4 py-2 text-right">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const avg = r.avg_quant !== null ? Number(r.avg_quant) : null;
                    return (
                      <tr key={r.id} className="border-b border-border/30 last:border-b-0">
                        <td className="px-4 py-2.5">
                          <Link href={`/contacts/${r.id}`} className="font-medium hover:text-primary">
                            {r.name}
                          </Link>
                          {r.email && <div className="text-[11px] text-muted-foreground">{r.email}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.company ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right font-medium">{r.deal_count}</td>
                        <td className={cn("px-4 py-2.5 text-right font-medium tabular-nums", quantTone(avg))}>
                          {avg !== null ? avg.toFixed(1) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{r.closed_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
