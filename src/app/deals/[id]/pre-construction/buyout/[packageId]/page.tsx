"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Handshake, Trash2, Save, Loader2 } from "lucide-react";
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

export default function BuyoutDetailPage({ params }: { params: { id: string; packageId: string } }) {
  const router = useRouter();
  const { id: dealId, packageId } = params;
  const [pkg, setPkg] = useState<BuyoutPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<BuyoutPackage> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/buyout`);
      const j = await res.json();
      const found = (j.data || []).find((x: BuyoutPackage) => x.id === packageId);
      setPkg(found || null);
      setDraft(found ? { ...found } : null);
    } finally {
      setLoading(false);
    }
  }, [dealId, packageId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/buyout/${packageId}`, {
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
    if (!confirm("Delete this buyout package?")) return;
    await fetch(`/api/deals/${dealId}/buyout/${packageId}`, { method: "DELETE" });
    router.push(`/deals/${dealId}/pre-construction/buyout`);
  };

  if (loading) return <div className="text-xs text-muted-foreground py-8">Loading…</div>;
  if (!pkg || !draft) return <div className="text-xs text-red-400 py-8">Package not found.</div>;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/deals/${dealId}/pre-construction/buyout`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Handshake className="h-5 w-5 text-primary" />
          <span className="text-2xs tabular-nums text-muted-foreground">BO-{String(pkg.number).padStart(3, "0")}</span>
          <h1 className="font-display text-2xl truncate">{pkg.trade}</h1>
          <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[pkg.status])}>
            {STATUS_LABEL[pkg.status]}
          </Badge>
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
          <label className="text-xs text-muted-foreground mb-1 block">Trade</label>
          <input
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            value={draft.trade ?? ""}
            onChange={(e) => setDraft({ ...draft, trade: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Scope Summary</label>
          <textarea
            rows={4}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
            value={draft.scope_summary ?? ""}
            onChange={(e) => setDraft({ ...draft, scope_summary: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Target Award Date</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.target_award_date ?? ""} onChange={(e) => setDraft({ ...draft, target_award_date: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <select className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.status ?? "scope_in_review"}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
              <option value="scope_in_review">Scope in Review</option>
              <option value="out_to_bid">Out to Bid</option>
              <option value="leveling">Leveling</option>
              <option value="awarded">Awarded</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Awarded Date</label>
            <input type="date" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.awarded_date ?? ""} onChange={(e) => setDraft({ ...draft, awarded_date: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Awarded To</label>
            <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.awarded_to ?? ""} onChange={(e) => setDraft({ ...draft, awarded_to: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Amount ($)</label>
            <input type="number" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={draft.awarded_amount ?? 0} onChange={(e) => setDraft({ ...draft, awarded_amount: Number(e.target.value) })} />
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
