"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Handshake, AlertTriangle, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "scope_in_review" | "out_to_bid" | "leveling" | "awarded";

interface BuyoutPackage {
  id: string;
  number: number;
  trade: string;
  scope_summary: string | null;
  target_award_date: string | null;
  awarded_date: string | null;
  awarded_to: string | null;
  awarded_amount: number | null;
  status: Status;
  notes: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  scope_in_review: "Scope in Review",
  out_to_bid: "Out to Bid",
  leveling: "Leveling",
  awarded: "Awarded",
};

const STATUS_TONE: Record<Status, string> = {
  scope_in_review: "bg-zinc-500/15 text-zinc-300",
  out_to_bid: "bg-blue-500/15 text-blue-300",
  leveling: "bg-amber-500/15 text-amber-300",
  awarded: "bg-emerald-500/15 text-emerald-300",
};

const fc = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

function awardUrgency(p: BuyoutPackage): "overdue" | "soon" | "ok" | null {
  if (p.status === "awarded") return null;
  if (!p.target_award_date) return null;
  const target = new Date(`${p.target_award_date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const days = (target.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "overdue";
  if (days < 14) return "soon";
  return "ok";
}

export default function BuyoutPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const [items, setItems] = useState<BuyoutPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/buyout`);
      const j = await res.json();
      setItems(j.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: Status) => {
    await fetch(`/api/deals/${dealId}/buyout/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this buyout package?")) return;
    await fetch(`/api/deals/${dealId}/buyout/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.status !== "awarded");

  const totals = useMemo(() => {
    const t = { awarded: 0, awardedCount: 0, packages: items.length };
    for (const i of items) {
      if (i.status === "awarded" && i.awarded_amount) t.awarded += Number(i.awarded_amount);
      if (i.status === "awarded") t.awardedCount++;
    }
    return t;
  }, [items]);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Handshake className="h-5 w-5 text-primary" />
            Buyout Packages
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Subcontractor trades the GC needs to award between GMP and mobilization.
            Track scope, target award date, and final award. Open trades past their target are flagged.
          </p>
        </div>
        <Link href={`/deals/${dealId}/pre-construction/buyout/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Package
          </Button>
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
          <Hammer className="h-4 w-4 text-primary" />
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Total Packages</div>
            <div className="text-base font-bold tabular-nums">{totals.packages}</div>
          </div>
        </div>
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
          <Handshake className="h-4 w-4 text-emerald-400" />
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Awarded</div>
            <div className="text-base font-bold tabular-nums">{totals.awardedCount} / {totals.packages}</div>
          </div>
        </div>
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
          <Hammer className="h-4 w-4 text-emerald-400" />
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Awarded $</div>
            <div className="text-base font-bold tabular-nums text-emerald-400">{fc(totals.awarded)}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setFilter("open")}
          className={cn("px-2.5 py-1 rounded-md border", filter === "open" ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30")}
        >
          Pending
        </button>
        <button
          onClick={() => setFilter("all")}
          className={cn("px-2.5 py-1 rounded-md border", filter === "all" ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30")}
        >
          All
        </button>
        <span className="ml-auto text-muted-foreground tabular-nums">{filtered.length} of {items.length}</span>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {items.length === 0 ? "No buyout packages tracked yet." : "All packages awarded."}
            </p>
            {items.length === 0 && (
              <Link href={`/deals/${dealId}/pre-construction/buyout/new`}>
                <Button size="sm" variant="outline">
                  <Plus className="h-3 w-3 mr-1" /> Add the first one
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-2xs uppercase tracking-wider bg-muted/20 border-b border-border/30">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Trade</th>
                  <th className="px-3 py-2 text-left">Scope</th>
                  <th className="px-3 py-2 text-left">Target Award</th>
                  <th className="px-3 py-2 text-left">Awarded To</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const urgency = awardUrgency(p);
                  const href = `/deals/${dealId}/pre-construction/buyout/${p.id}`;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(href)}
                      className="group border-t border-border/20 hover:bg-muted/10 cursor-pointer"
                    >
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">BO-{String(p.number).padStart(3, "0")}</td>
                      <td className="px-3 py-2 font-medium">{p.trade}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[260px] truncate">{p.scope_summary || "—"}</td>
                      <td className={cn(
                        "px-3 py-2 tabular-nums",
                        urgency === "overdue" && "text-red-400 font-medium",
                        urgency === "soon" && "text-amber-300 font-medium",
                        !urgency && "text-muted-foreground",
                      )}>
                        {p.target_award_date ? (
                          <span className="inline-flex items-center gap-1">
                            {(urgency === "overdue" || urgency === "soon") && <AlertTriangle className="h-3 w-3" />}
                            {new Date(`${p.target_award_date}T00:00:00`).toLocaleDateString()}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.awarded_to || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fc(p.awarded_amount)}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[p.status])}>{STATUS_LABEL[p.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100">
                          {p.status !== "awarded" && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStatus(p.id, "awarded"); }}
                              title="Mark awarded"
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              ✓
                            </button>
                          )}
                          <button
                            onClick={(e) => remove(e, p.id)}
                            title="Delete"
                            className="text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
