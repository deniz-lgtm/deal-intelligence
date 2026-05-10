"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Handshake, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NewBuyoutPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const [form, setForm] = useState({
    trade: "",
    scope_summary: "",
    target_award_date: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.trade.trim()) {
      alert("Trade is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/buyout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          trade: form.trade.trim(),
          scope_summary: form.scope_summary || null,
          target_award_date: form.target_award_date || null,
          notes: form.notes || null,
        }),
      });
      const j = await res.json();
      router.push(`/deals/${dealId}/pre-construction/buyout/${j.data?.id ?? ""}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/deals/${dealId}/pre-construction/buyout`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Handshake className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl">New Buyout Package</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/pre-construction/buyout`}>
            <Button variant="ghost" size="sm" disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </Link>
          <Button size="sm" onClick={submit} disabled={saving || !form.trade.trim()}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
          </Button>
        </div>
      </header>

      <div className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-2xl space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Trade <span className="text-red-400">*</span></label>
          <input
            autoFocus
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.trade}
            onChange={(e) => setForm({ ...form, trade: e.target.value })}
            placeholder="e.g., Electrical, HVAC, Drywall, Roofing"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Scope Summary</label>
          <textarea
            rows={4}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
            value={form.scope_summary}
            onChange={(e) => setForm({ ...form, scope_summary: e.target.value })}
            placeholder="Brief scope description; what's in / out of this trade package"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Target Award Date</label>
          <input
            type="date"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            value={form.target_award_date}
            onChange={(e) => setForm({ ...form, target_award_date: e.target.value })}
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
