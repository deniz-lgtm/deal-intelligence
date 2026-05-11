"use client";

import { useState } from "react";
import { Plus, Trash2, Check, X, Loader2 } from "lucide-react";

export interface MetricRow {
  id: string;
  market: string;
  monthly_rent: number | string | null;
  rent_per_sf: number | string | null;
  hard_cost: number | string | null;
  hard_cost_per_sf: number | string | null;
  notes: string | null;
}

interface MetricsPanelProps {
  floorPlanId: string;
  squareFootage: number | null;
  metrics: MetricRow[];
  onChange: (metrics: MetricRow[]) => void;
}

const num = (v: number | string | null): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v: number | string | null) => {
  const n = num(v);
  if (n === null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

// Per-plan multi-market rent / cost table. Auto-derives the per-SF
// fields from monthly rent + plan SF on the fly (the user can still
// override them by typing). Each row write hits the metrics API.

export function MetricsPanel({ floorPlanId, squareFootage, metrics, onChange }: MetricsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Omit<MetricRow, "id">>({
    market: "",
    monthly_rent: "",
    rent_per_sf: "",
    hard_cost: "",
    hard_cost_per_sf: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Record<string, Partial<MetricRow>>>({});

  const sf = squareFootage && squareFootage > 0 ? squareFootage : null;

  const submitDraft = async () => {
    if (!draft.market.trim()) return;
    setSaving(true);
    try {
      const monthlyRent = num(draft.monthly_rent);
      const rentPerSf = num(draft.rent_per_sf) ?? (sf && monthlyRent !== null ? +(monthlyRent / sf).toFixed(2) : null);
      const hardCost = num(draft.hard_cost);
      const hardCostPerSf = num(draft.hard_cost_per_sf) ?? (sf && hardCost !== null ? +(hardCost / sf).toFixed(2) : null);

      const res = await fetch(`/api/floor-plans/${floorPlanId}/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: draft.market.trim(),
          monthly_rent: monthlyRent,
          rent_per_sf: rentPerSf,
          hard_cost: hardCost,
          hard_cost_per_sf: hardCostPerSf,
          notes: draft.notes?.trim() || null,
        }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        onChange([...metrics, json.data as MetricRow]);
        setDraft({ market: "", monthly_rent: "", rent_per_sf: "", hard_cost: "", hard_cost_per_sf: "", notes: "" });
        setAdding(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (row: MetricRow) => {
    const patch = editing[row.id];
    if (!patch) return;
    const next: Partial<MetricRow> = { ...patch };
    if ("monthly_rent" in patch) next.monthly_rent = num(patch.monthly_rent ?? "");
    if ("rent_per_sf" in patch) next.rent_per_sf = num(patch.rent_per_sf ?? "");
    if ("hard_cost" in patch) next.hard_cost = num(patch.hard_cost ?? "");
    if ("hard_cost_per_sf" in patch) next.hard_cost_per_sf = num(patch.hard_cost_per_sf ?? "");

    const res = await fetch(`/api/floor-plans/${floorPlanId}/metrics/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const json = await res.json();
    if (res.ok && json.data) {
      onChange(metrics.map((m) => (m.id === row.id ? (json.data as MetricRow) : m)));
      setEditing((prev) => {
        const { [row.id]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const removeRow = async (id: string) => {
    if (!confirm("Delete this market row?")) return;
    await fetch(`/api/floor-plans/${floorPlanId}/metrics/${id}`, { method: "DELETE" });
    onChange(metrics.filter((m) => m.id !== id));
  };

  const startEdit = (row: MetricRow) => setEditing((prev) => ({ ...prev, [row.id]: { ...row } }));
  const cancelEdit = (id: string) => setEditing((prev) => {
    const { [id]: _, ...rest } = prev;
    return rest;
  });

  return (
    <div className="rounded-xl border border-border/50 bg-card/40">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Pricing &amp; Rent · per market</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            One row per market. $/SF auto-derives from monthly rent ÷ plan SF unless overridden.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/60 px-2.5 py-1 text-xs hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add market
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20 text-left text-[10px] uppercase tracking-wider text-muted-foreground/70">
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 text-right font-medium">Monthly Rent</th>
              <th className="px-3 py-2 text-right font-medium">$/SF</th>
              <th className="px-3 py-2 text-right font-medium">Hard Cost</th>
              <th className="px-3 py-2 text-right font-medium">HC $/SF</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              <th className="px-3 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((row) => {
              const isEditing = !!editing[row.id];
              const e = editing[row.id];
              return (
                <tr key={row.id} className="border-b border-border/30 last:border-b-0">
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        type="text"
                        value={e?.market ?? row.market}
                        onChange={(ev) => setEditing((p) => ({ ...p, [row.id]: { ...e, market: ev.target.value } }))}
                        className="w-full rounded border border-border/50 bg-background/60 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    ) : (
                      <span className="font-medium">{row.market}</span>
                    )}
                  </td>
                  <CellNumberic
                    value={isEditing ? (e?.monthly_rent ?? row.monthly_rent) : row.monthly_rent}
                    editing={isEditing}
                    onChange={(v) => setEditing((p) => ({ ...p, [row.id]: { ...e, monthly_rent: v } }))}
                    prefix="$"
                  />
                  <CellNumberic
                    value={isEditing ? (e?.rent_per_sf ?? row.rent_per_sf) : row.rent_per_sf}
                    editing={isEditing}
                    onChange={(v) => setEditing((p) => ({ ...p, [row.id]: { ...e, rent_per_sf: v } }))}
                    prefix="$"
                  />
                  <CellNumberic
                    value={isEditing ? (e?.hard_cost ?? row.hard_cost) : row.hard_cost}
                    editing={isEditing}
                    onChange={(v) => setEditing((p) => ({ ...p, [row.id]: { ...e, hard_cost: v } }))}
                    prefix="$"
                  />
                  <CellNumberic
                    value={isEditing ? (e?.hard_cost_per_sf ?? row.hard_cost_per_sf) : row.hard_cost_per_sf}
                    editing={isEditing}
                    onChange={(v) => setEditing((p) => ({ ...p, [row.id]: { ...e, hard_cost_per_sf: v } }))}
                    prefix="$"
                  />
                  <td className="px-3 py-2 text-muted-foreground">
                    {isEditing ? (
                      <input
                        type="text"
                        value={e?.notes ?? row.notes ?? ""}
                        onChange={(ev) => setEditing((p) => ({ ...p, [row.id]: { ...e, notes: ev.target.value } }))}
                        className="w-full rounded border border-border/50 bg-background/60 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    ) : (
                      <span className="truncate">{row.notes || ""}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <div className="inline-flex gap-1">
                        <button type="button" onClick={() => saveEdit(row)} className="rounded p-1 text-emerald-500 hover:bg-emerald-500/10">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => cancelEdit(row.id)} className="rounded p-1 text-muted-foreground hover:bg-muted/40">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex gap-1">
                        <button type="button" onClick={() => startEdit(row)} className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
                          Edit
                        </button>
                        <button type="button" onClick={() => removeRow(row.id)} className="rounded p-1 text-muted-foreground/60 hover:bg-red-500/10 hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}

            {adding && (
              <tr className="border-b border-border/30 bg-primary/5">
                <td className="px-3 py-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="e.g. Phoenix, AZ"
                    value={draft.market}
                    onChange={(e) => setDraft({ ...draft, market: e.target.value })}
                    className="w-full rounded border border-border/50 bg-background/70 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </td>
                <DraftCell value={draft.monthly_rent} onChange={(v) => setDraft({ ...draft, monthly_rent: v })} placeholder="2,450" />
                <DraftCell value={draft.rent_per_sf} onChange={(v) => setDraft({ ...draft, rent_per_sf: v })} placeholder={sf ? "auto" : "2.45"} />
                <DraftCell value={draft.hard_cost} onChange={(v) => setDraft({ ...draft, hard_cost: v })} placeholder="180,000" />
                <DraftCell value={draft.hard_cost_per_sf} onChange={(v) => setDraft({ ...draft, hard_cost_per_sf: v })} placeholder={sf ? "auto" : "180"} />
                <td className="px-3 py-2">
                  <input
                    type="text"
                    placeholder="optional"
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    className="w-full rounded border border-border/50 bg-background/70 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button type="button" onClick={submitDraft} disabled={saving || !draft.market.trim()} className="rounded p-1 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => { setAdding(false); setDraft({ market: "", monthly_rent: "", rent_per_sf: "", hard_cost: "", hard_cost_per_sf: "", notes: "" }); }} className="rounded p-1 text-muted-foreground hover:bg-muted/40">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {metrics.length === 0 && !adding && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No market metrics yet. Click <span className="font-medium text-foreground">Add market</span> to capture rent and hard-cost numbers for this plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellNumberic({
  value,
  editing,
  onChange,
  prefix,
}: {
  value: number | string | null;
  editing: boolean;
  onChange: (v: string) => void;
  prefix?: string;
}) {
  if (editing) {
    return (
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.01"
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded border border-border/50 bg-background/60 px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </td>
    );
  }
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {value === null ? "—" : `${prefix ?? ""}${fmt(value)}`}
    </td>
  );
}

function DraftCell({ value, onChange, placeholder }: { value: number | string | null; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <td className="px-3 py-2 text-right">
      <input
        type="number"
        step="0.01"
        placeholder={placeholder}
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-border/50 bg-background/70 px-1.5 py-1 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/30"
      />
    </td>
  );
}
