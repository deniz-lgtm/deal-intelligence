"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ListChecks, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NewVEItemPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;
  const [form, setForm] = useState({
    title: "",
    description: "",
    proposer: "",
    cost_savings: 0,
    schedule_impact_days: 0,
    scope_impact: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) {
      alert("Title is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/ve-items`, {
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
      const j = await res.json();
      if (!res.ok) {
        alert(j.error || "Failed to create VE item.");
        return;
      }
      router.push(`/deals/${dealId}/pre-construction/value-engineering/${j.data.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/deals/${dealId}/pre-construction/value-engineering`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <ListChecks className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl">New Value Engineering Item</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/pre-construction/value-engineering`}>
            <Button variant="ghost" size="sm" disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </Link>
          <Button size="sm" onClick={submit} disabled={saving || !form.title.trim()}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Propose a savings opportunity against the active budget. Negative schedule days = saves time on the
        critical path. Items can be edited after creation; accepted items roll into the next budget version
        (typically V2 - Post-VE).
      </p>

      <div className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-2xl space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Title <span className="text-red-400">*</span></label>
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
            rows={5}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
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
          <textarea
            rows={3}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            value={form.scope_impact}
            onChange={(e) => setForm({ ...form, scope_impact: e.target.value })}
            placeholder="What changes about the scope, finish, or specification?"
          />
        </div>
      </div>
    </div>
  );
}
