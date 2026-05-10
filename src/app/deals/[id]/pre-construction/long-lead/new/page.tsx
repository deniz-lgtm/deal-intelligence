"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Truck, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NewLongLeadPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const [form, setForm] = useState({
    item: "",
    trade: "",
    supplier: "",
    lead_time_weeks: 0,
    required_on_site: "",
    target_order_date: "",
    cost: 0,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  // Live computed order-by from required_on_site - lead_time_weeks. Rendered
  // as a hint when user hasn't manually overridden target_order_date.
  const computedOrderBy = useMemo(() => {
    if (!form.required_on_site || !form.lead_time_weeks) return null;
    const onSite = new Date(`${form.required_on_site}T00:00:00`);
    if (Number.isNaN(onSite.getTime())) return null;
    onSite.setDate(onSite.getDate() - form.lead_time_weeks * 7);
    return onSite.toISOString().slice(0, 10);
  }, [form.required_on_site, form.lead_time_weeks]);

  const submit = async () => {
    if (!form.item.trim()) {
      alert("Item is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/long-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          item: form.item.trim(),
          trade: form.trade || null,
          supplier: form.supplier || null,
          lead_time_weeks: form.lead_time_weeks || null,
          required_on_site: form.required_on_site || null,
          target_order_date: form.target_order_date || null,
          cost: form.cost || null,
          notes: form.notes || null,
        }),
      });
      const j = await res.json();
      router.push(`/deals/${dealId}/pre-construction/long-lead/${j.data?.id ?? ""}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/deals/${dealId}/pre-construction/long-lead`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Truck className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl">New Long-Lead Item</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/pre-construction/long-lead`}>
            <Button variant="ghost" size="sm" disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </Link>
          <Button size="sm" onClick={submit} disabled={saving || !form.item.trim()}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Track items with lead times that drive when they need to be ordered. Set required-on-site and lead time;
        order-by is computed automatically (you can override it).
      </p>

      <div className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-3xl space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Item <span className="text-red-400">*</span></label>
          <input
            autoFocus
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.item}
            onChange={(e) => setForm({ ...form, item: e.target.value })}
            placeholder="e.g., Switchgear, Elevator cab, Curtain wall, Custom millwork"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Trade</label>
            <input
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.trade}
              onChange={(e) => setForm({ ...form, trade: e.target.value })}
              placeholder="MEP / structural / etc."
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Supplier</label>
            <input
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Lead Time (weeks)</label>
            <input
              type="number"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.lead_time_weeks}
              onChange={(e) => setForm({ ...form, lead_time_weeks: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Required On Site</label>
            <input
              type="date"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.required_on_site}
              onChange={(e) => setForm({ ...form, required_on_site: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Order By {computedOrderBy && !form.target_order_date && (
                <span className="text-2xs text-primary normal-case ml-1">(computed: {new Date(`${computedOrderBy}T00:00:00`).toLocaleDateString()})</span>
              )}
            </label>
            <input
              type="date"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={form.target_order_date}
              onChange={(e) => setForm({ ...form, target_order_date: e.target.value })}
              placeholder={computedOrderBy ?? ""}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Cost ($)</label>
          <input
            type="number"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
          <textarea
            rows={3}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
