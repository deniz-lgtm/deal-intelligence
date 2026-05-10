"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Truck, Trash2, Save, Loader2 } from "lucide-react";
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

export default function LongLeadDetailPage({ params }: { params: { id: string; itemId: string } }) {
  const router = useRouter();
  const { id: dealId, itemId } = params;
  const [item, setItem] = useState<LongLeadItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<LongLeadItem> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/long-lead`);
      const j = await res.json();
      const found = (j.data || []).find((x: LongLeadItem) => x.id === itemId);
      setItem(found || null);
      setDraft(found ? { ...found } : null);
    } finally {
      setLoading(false);
    }
  }, [dealId, itemId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/long-lead/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this long-lead item?")) return;
    await fetch(`/api/deals/${dealId}/long-lead/${itemId}`, { method: "DELETE" });
    router.push(`/deals/${dealId}/pre-construction/long-lead`);
  };

  if (loading) return <div className="text-xs text-muted-foreground py-8">Loading…</div>;
  if (!item || !draft) return <div className="text-xs text-red-400 py-8">Item not found.</div>;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/deals/${dealId}/pre-construction/long-lead`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Truck className="h-5 w-5 text-primary" />
          <span className="text-2xs tabular-nums text-muted-foreground">LL-{String(item.number).padStart(3, "0")}</span>
          <h1 className="font-display text-2xl truncate">{item.item}</h1>
          <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[item.status])}>{item.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={remove} className="text-muted-foreground hover:text-red-400">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
          </Button>
        </div>
      </header>

      <div className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-3xl space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Item</label>
          <input
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            value={draft.item ?? ""}
            onChange={(e) => setDraft({ ...draft, item: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Trade</label>
            <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.trade ?? ""} onChange={(e) => setDraft({ ...draft, trade: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Supplier</label>
            <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.supplier ?? ""} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Lead Time (weeks)</label>
            <input type="number" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.lead_time_weeks ?? 0} onChange={(e) => setDraft({ ...draft, lead_time_weeks: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Required On Site</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.required_on_site ?? ""} onChange={(e) => setDraft({ ...draft, required_on_site: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Order By</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.target_order_date ?? ""} onChange={(e) => setDraft({ ...draft, target_order_date: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Ordered</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.ordered_date ?? ""} onChange={(e) => setDraft({ ...draft, ordered_date: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Expected Delivery</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.expected_delivery_date ?? ""} onChange={(e) => setDraft({ ...draft, expected_delivery_date: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Delivered</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.delivered_date ?? ""} onChange={(e) => setDraft({ ...draft, delivered_date: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cost ($)</label>
            <input type="number" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.cost ?? 0} onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <select className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.status ?? "identified"} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
              <option value="identified">Identified</option>
              <option value="quoted">Quoted</option>
              <option value="ordered">Ordered</option>
              <option value="delivered">Delivered</option>
              <option value="installed">Installed</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
          <textarea rows={3} className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
            value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
