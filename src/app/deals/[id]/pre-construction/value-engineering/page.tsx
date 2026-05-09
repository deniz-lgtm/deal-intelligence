"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  ListChecks,
  CheckCircle2,
  XCircle,
  TrendingDown,
  Clock,
  Edit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type VEStatus = "proposed" | "in_review" | "accepted" | "rejected" | "applied";

interface VEItem {
  id: string;
  number: number;
  title: string;
  description: string | null;
  proposer: string | null;
  hardcost_item_id: string | null;
  cost_savings: number;
  schedule_impact_days: number;
  scope_impact: string | null;
  status: VEStatus;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

const STATUS_CFG: Record<VEStatus, { label: string; tone: string }> = {
  proposed: { label: "Proposed", tone: "bg-zinc-500/20 text-zinc-300" },
  in_review: { label: "In Review", tone: "bg-blue-500/20 text-blue-300" },
  accepted: { label: "Accepted", tone: "bg-amber-500/20 text-amber-300" },
  rejected: { label: "Rejected", tone: "bg-red-500/20 text-red-300" },
  applied: { label: "Applied", tone: "bg-emerald-500/20 text-emerald-300" },
};

const fc = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function VELogPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [items, setItems] = useState<VEItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VEStatus | "all">("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    proposer: "",
    cost_savings: 0,
    schedule_impact_days: 0,
    scope_impact: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/ve-items`);
      const j = await res.json();
      setItems(j.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.title.trim()) return;
    await fetch(`/api/deals/${dealId}/ve-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        title: form.title.trim(),
        description: form.description || null,
        proposer: form.proposer || null,
        scope_impact: form.scope_impact || null,
      }),
    });
    setDialogOpen(false);
    setForm({ title: "", description: "", proposer: "", cost_savings: 0, schedule_impact_days: 0, scope_impact: "" });
    load();
  };

  const setStatus = async (id: string, status: VEStatus, note?: string) => {
    await fetch(`/api/deals/${dealId}/ve-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(note ? { decision_note: note } : {}) }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this VE item?")) return;
    await fetch(`/api/deals/${dealId}/ve-items/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  // Roll-up: net savings of items that are accepted or applied (not just proposed).
  const totals = useMemo(() => {
    const t = { proposed: 0, accepted: 0, applied: 0, schedule: 0 };
    for (const i of items) {
      if (i.status === "proposed" || i.status === "in_review") t.proposed += Number(i.cost_savings);
      if (i.status === "accepted") t.accepted += Number(i.cost_savings);
      if (i.status === "applied") t.applied += Number(i.cost_savings);
      if (i.status === "accepted" || i.status === "applied") t.schedule += Number(i.schedule_impact_days);
    }
    return t;
  }, [items]);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Value Engineering Log
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Track VE items proposed against the active budget. Accepted items roll into the next budget version (typically V2 - Post-VE).
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New VE Item
        </Button>
      </header>

      {/* Roll-up cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <RollupCard label="Proposed savings" value={fc(totals.proposed)} icon={TrendingDown} tone="text-zinc-300" />
        <RollupCard label="Accepted savings" value={fc(totals.accepted)} icon={CheckCircle2} tone="text-amber-300" />
        <RollupCard label="Applied savings" value={fc(totals.applied)} icon={CheckCircle2} tone="text-emerald-400" />
        <RollupCard label="Schedule Δ (days)" value={`${totals.schedule >= 0 ? "+" : ""}${totals.schedule}`} icon={Clock} tone={totals.schedule > 0 ? "text-amber-300" : totals.schedule < 0 ? "text-emerald-400" : "text-muted-foreground"} />
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Filter:</span>
        {(["all", "proposed", "in_review", "accepted", "rejected", "applied"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "px-2.5 py-1 rounded-md border",
              filter === s ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30"
            )}
          >
            {s === "all" ? "All" : STATUS_CFG[s].label}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground tabular-nums">{filtered.length} of {items.length}</span>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {items.length === 0 ? "No VE items proposed yet." : "No items match the filter."}
            </p>
            {items.length === 0 && (
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add the first one
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-2xs uppercase tracking-wider bg-muted/20 border-b border-border/30">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Proposer</th>
                  <th className="px-3 py-2 text-right">Savings</th>
                  <th className="px-3 py-2 text-right">Sched Δ</th>
                  <th className="px-3 py-2 text-left">Scope Impact</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => {
                  const cfg = STATUS_CFG[it.status];
                  return (
                    <tr key={it.id} className="group border-t border-border/20 hover:bg-muted/10">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">VE-{String(it.number).padStart(3, "0")}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{it.title}</div>
                        {it.description && <div className="text-2xs text-muted-foreground mt-0.5 max-w-md">{it.description}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{it.proposer || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{fc(Number(it.cost_savings))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {it.schedule_impact_days === 0 ? "—" : `${it.schedule_impact_days >= 0 ? "+" : ""}${it.schedule_impact_days}d`}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate">{it.scope_impact || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={cn("text-2xs", cfg.tone)}>{cfg.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100">
                          {it.status !== "accepted" && it.status !== "applied" && (
                            <button onClick={() => setStatus(it.id, "accepted")} title="Accept" className="text-emerald-400 hover:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {it.status !== "rejected" && (
                            <button onClick={() => setStatus(it.id, "rejected")} title="Reject" className="text-red-400 hover:text-red-300">
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {it.status === "accepted" && (
                            <button onClick={() => setStatus(it.id, "applied")} title="Mark applied to budget" className="text-blue-400 hover:text-blue-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => remove(it.id)} title="Delete" className="text-muted-foreground hover:text-red-400">
                            <Trash2 className="h-3.5 w-3.5" />
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Value Engineering Item</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <input
                autoFocus
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g., Substitute LVT for hardwood in common areas"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Detail / rationale</label>
              <textarea
                rows={3}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Proposer</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.proposer}
                  onChange={(e) => setForm({ ...form, proposer: e.target.value })}
                  placeholder="GC / arch / owner"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Savings ($)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={form.cost_savings}
                  onChange={(e) => setForm({ ...form, cost_savings: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Schedule Δ (days)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={form.schedule_impact_days}
                  onChange={(e) => setForm({ ...form, schedule_impact_days: Number(e.target.value) })}
                  placeholder="negative = saves time"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Scope impact</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={form.scope_impact}
                onChange={(e) => setForm({ ...form, scope_impact: e.target.value })}
                placeholder="What changes about the scope, finish, or specification?"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submit}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RollupCard({
  label, value, icon: Icon, tone,
}: {
  label: string; value: string; icon: typeof CheckCircle2; tone: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
      <Icon className={cn("h-4 w-4 shrink-0", tone)} />
      <div className="min-w-0">
        <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">{label}</div>
        <div className={cn("text-base font-bold tabular-nums", tone)}>{value}</div>
      </div>
    </div>
  );
}
