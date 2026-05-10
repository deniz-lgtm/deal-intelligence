"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "identified" | "quoted" | "ordered" | "delivered" | "installed";

interface LongLeadItem {
  id: string;
  number: number;
  item: string;
  trade: string | null;
  supplier: string | null;
  lead_time_weeks: number | null;
  required_on_site: string | null;
  target_order_date: string | null;
  ordered_date: string | null;
  expected_delivery_date: string | null;
  delivered_date: string | null;
  cost: number | null;
  status: Status;
  notes: string | null;
}

const STATUS_TONE: Record<Status, string> = {
  identified: "bg-zinc-500/15 text-zinc-300",
  quoted: "bg-blue-500/15 text-blue-300",
  ordered: "bg-amber-500/15 text-amber-300",
  delivered: "bg-emerald-500/15 text-emerald-300",
  installed: "bg-emerald-500/25 text-emerald-200",
};

const fc = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

// "Order by" status: based on target_order_date vs today.
function orderUrgency(it: LongLeadItem): "overdue" | "soon" | "ok" | null {
  if (it.status !== "identified" && it.status !== "quoted") return null;
  if (!it.target_order_date) return null;
  const target = new Date(`${it.target_order_date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const days = (target.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "overdue";
  if (days < 14) return "soon";
  return "ok";
}

export default function LongLeadPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const [items, setItems] = useState<LongLeadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/long-lead`);
      const j = await res.json();
      setItems(j.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: Status) => {
    await fetch(`/api/deals/${dealId}/long-lead/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this long-lead item?")) return;
    await fetch(`/api/deals/${dealId}/long-lead/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.status !== "installed");

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Long-Lead Procurement
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Items that need to be ordered weeks before mobilization (gear, glass, switchgear, elevators, custom millwork).
            Required-on-site date - lead time = order-by date. Items overdue to order are flagged.
          </p>
        </div>
        <Link href={`/deals/${dealId}/pre-construction/long-lead/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        </Link>
      </header>

      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setFilter("open")}
          className={cn("px-2.5 py-1 rounded-md border", filter === "open" ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30")}
        >
          Active
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
              {items.length === 0 ? "No long-lead items tracked yet." : "All items installed."}
            </p>
            {items.length === 0 && (
              <Link href={`/deals/${dealId}/pre-construction/long-lead/new`}>
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
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Trade</th>
                  <th className="px-3 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-right">Lead</th>
                  <th className="px-3 py-2 text-left">On Site By</th>
                  <th className="px-3 py-2 text-left">Order By</th>
                  <th className="px-3 py-2 text-left">Ordered</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => {
                  const urgency = orderUrgency(it);
                  const href = `/deals/${dealId}/pre-construction/long-lead/${it.id}`;
                  return (
                    <tr
                      key={it.id}
                      onClick={() => router.push(href)}
                      className="group border-t border-border/20 hover:bg-muted/10 cursor-pointer"
                    >
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">LL-{String(it.number).padStart(3, "0")}</td>
                      <td className="px-3 py-2 font-medium">{it.item}</td>
                      <td className="px-3 py-2 text-muted-foreground">{it.trade || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{it.supplier || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {it.lead_time_weeks ? `${it.lead_time_weeks}w` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {it.required_on_site ? new Date(`${it.required_on_site}T00:00:00`).toLocaleDateString() : "—"}
                      </td>
                      <td className={cn(
                        "px-3 py-2 tabular-nums",
                        urgency === "overdue" && "text-red-400 font-medium",
                        urgency === "soon" && "text-amber-300 font-medium",
                        urgency === "ok" && "text-muted-foreground",
                      )}>
                        {it.target_order_date ? (
                          <span className="inline-flex items-center gap-1">
                            {(urgency === "overdue" || urgency === "soon") && <AlertTriangle className="h-3 w-3" />}
                            {new Date(`${it.target_order_date}T00:00:00`).toLocaleDateString()}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {it.ordered_date ? new Date(`${it.ordered_date}T00:00:00`).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fc(it.cost)}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[it.status])}>{it.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100">
                          {it.status === "identified" && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStatus(it.id, "ordered"); }}
                              title="Mark ordered"
                              className="text-amber-300 hover:text-amber-200"
                            >
                              ▶
                            </button>
                          )}
                          {it.status === "ordered" && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStatus(it.id, "delivered"); }}
                              title="Mark delivered"
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              ✓
                            </button>
                          )}
                          <button
                            onClick={(e) => remove(e, it.id)}
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
