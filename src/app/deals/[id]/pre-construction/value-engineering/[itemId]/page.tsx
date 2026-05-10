"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ListChecks,
  Save,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export default function VEDetailPage({ params }: { params: { id: string; itemId: string } }) {
  const router = useRouter();
  const { id: dealId, itemId } = params;
  const [item, setItem] = useState<VEItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    proposer: "",
    cost_savings: 0,
    schedule_impact_days: 0,
    scope_impact: "",
    status: "proposed" as VEStatus,
    decision_note: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/ve-items`);
      const j = await res.json();
      const found = (j.data || []).find((x: VEItem) => x.id === itemId);
      if (found) {
        setItem(found);
        setDraft({
          title: found.title,
          description: found.description || "",
          proposer: found.proposer || "",
          cost_savings: Number(found.cost_savings) || 0,
          schedule_impact_days: Number(found.schedule_impact_days) || 0,
          scope_impact: found.scope_impact || "",
          status: found.status,
          decision_note: found.decision_note || "",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [dealId, itemId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/ve-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description || null,
          proposer: draft.proposer || null,
          cost_savings: draft.cost_savings,
          schedule_impact_days: draft.schedule_impact_days,
          scope_impact: draft.scope_impact || null,
          status: draft.status,
          decision_note: draft.decision_note || null,
        }),
      });
      setEditing(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: VEStatus, note?: string) => {
    await fetch(`/api/deals/${dealId}/ve-items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(note ? { decision_note: note } : {}) }),
    });
    load();
  };

  const remove = async () => {
    if (!confirm("Delete this VE item?")) return;
    await fetch(`/api/deals/${dealId}/ve-items/${itemId}`, { method: "DELETE" });
    router.push(`/deals/${dealId}/pre-construction/value-engineering`);
  };

  if (loading) return <div className="text-xs text-muted-foreground py-8">Loading…</div>;
  if (!item) return <div className="text-xs text-red-400 py-8">VE item not found.</div>;

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
          <span className="text-2xs tabular-nums text-muted-foreground">VE-{String(item.number).padStart(3, "0")}</span>
          {!editing && <h1 className="font-display text-2xl truncate">{item.title}</h1>}
          {!editing && <Badge variant="secondary" className={cn("text-2xs", STATUS_CFG[item.status].tone)}>{STATUS_CFG[item.status].label}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              {item.status === "proposed" || item.status === "in_review" ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setStatus("accepted")}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Accept
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setStatus("rejected")}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </>
              ) : item.status === "accepted" ? (
                <Button variant="outline" size="sm" onClick={() => setStatus("applied")}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Applied
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={remove} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); load(); }} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
          <TrendingDown className="h-4 w-4 text-emerald-400" />
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Cost Savings</div>
            <div className="text-base font-bold tabular-nums text-emerald-400">{fc(Number(item.cost_savings))}</div>
          </div>
        </div>
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
          <Clock className={cn(
            "h-4 w-4",
            Number(item.schedule_impact_days) > 0 ? "text-amber-300" : Number(item.schedule_impact_days) < 0 ? "text-emerald-400" : "text-muted-foreground"
          )} />
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Schedule Δ</div>
            <div className="text-base font-bold tabular-nums">
              {Number(item.schedule_impact_days) === 0 ? "—" : `${Number(item.schedule_impact_days) >= 0 ? "+" : ""}${item.schedule_impact_days}d`}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 flex items-center gap-3">
          <Badge variant="secondary" className={cn("text-2xs", STATUS_CFG[item.status].tone)}>{STATUS_CFG[item.status].label}</Badge>
          {item.decided_at && (
            <span className="text-2xs text-muted-foreground">
              {new Date(item.decided_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border/40 bg-card/40 p-5 max-w-3xl space-y-4">
        {editing ? (
          <>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Detail / rationale</label>
              <textarea
                rows={5}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Proposer</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={draft.proposer}
                  onChange={(e) => setDraft({ ...draft, proposer: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Savings ($)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={draft.cost_savings}
                  onChange={(e) => setDraft({ ...draft, cost_savings: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Schedule Δ (days)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={draft.schedule_impact_days}
                  onChange={(e) => setDraft({ ...draft, schedule_impact_days: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Scope impact</label>
              <textarea
                rows={3}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
                value={draft.scope_impact}
                onChange={(e) => setDraft({ ...draft, scope_impact: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as VEStatus })}
                >
                  <option value="proposed">Proposed</option>
                  <option value="in_review">In Review</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="applied">Applied</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Decision note</label>
              <textarea
                rows={3}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
                value={draft.decision_note}
                onChange={(e) => setDraft({ ...draft, decision_note: e.target.value })}
              />
            </div>
          </>
        ) : (
          <>
            <Field label="Detail / rationale">
              {item.description ? <p className="whitespace-pre-wrap text-sm">{item.description}</p> : <span className="text-muted-foreground/60 italic text-sm">—</span>}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Proposer">{item.proposer || <span className="text-muted-foreground/60">—</span>}</Field>
              <Field label="Created">{new Date(item.created_at).toLocaleDateString()}</Field>
            </div>
            <Field label="Scope impact">
              {item.scope_impact ? <p className="whitespace-pre-wrap text-sm">{item.scope_impact}</p> : <span className="text-muted-foreground/60 italic text-sm">—</span>}
            </Field>
            {item.decision_note && (
              <div className="rounded-md border border-border/40 bg-background/40 p-3">
                <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">Decision note</div>
                <p className="text-sm whitespace-pre-wrap">{item.decision_note}</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
