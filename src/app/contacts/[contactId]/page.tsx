"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Mail,
  Phone,
  Plus,
  Save,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn, titleCase } from "@/lib/utils";
import {
  CONTACT_ACTIVITY_LABELS,
  RELATIONSHIP_STAGE_LABELS,
  RELATIONSHIP_STAGE_ORDER,
  STAKEHOLDER_LABELS,
  type ContactActivity,
  type ContactActivityKind,
  type ContactWithDeals,
  type RelationshipStage,
} from "@/lib/types";

interface ActivityRow extends ContactActivity {
  deal_name: string | null;
}

const RELATIONSHIP_STAGE_TONE: Record<RelationshipStage, string> = {
  cold: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  warm: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  active: "border-emerald-500/35 bg-emerald-500/10 text-emerald-500",
  source: "border-primary/35 bg-primary/10 text-primary",
  partner: "border-violet-500/35 bg-violet-500/10 text-violet-400",
};

const ACTIVITY_KINDS: ContactActivityKind[] = [
  "call",
  "email",
  "meeting",
  "note",
  "intro",
  "send",
];

function relativeTime(value: string | null | undefined) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86_400 * 7) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ContactPage() {
  const params = useParams<{ contactId: string }>();
  const contactId = params?.contactId;
  const [contact, setContact] = useState<ContactWithDeals | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const [c, a] = await Promise.all([
        fetch(`/api/contacts/${contactId}`).then((r) => r.json()),
        fetch(`/api/contacts/${contactId}/activities`).then((r) => r.json()),
      ]);
      setContact(c.data ?? null);
      setActivities(Array.isArray(a.data) ? a.data : []);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateField = async (patch: Record<string, unknown>) => {
    if (!contactId) return;
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Update failed");
      return;
    }
    toast.success("Saved");
    load();
  };

  if (loading && !contact) {
    return (
      <AppShell>
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (!contact) {
    return (
      <AppShell>
        <div className="p-8 text-sm text-muted-foreground">Contact not found.</div>
      </AppShell>
    );
  }

  const stage = (contact.relationship_stage ?? "warm") as RelationshipStage;

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/40 bg-card/40 px-6 py-3">
          <div className="mx-auto flex max-w-5xl flex-col gap-3">
            <Link
              href="/contacts"
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              All contacts
            </Link>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">
                    {contact.name}
                  </h1>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      RELATIONSHIP_STAGE_TONE[stage]
                    )}
                  >
                    {RELATIONSHIP_STAGE_LABELS[stage]}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {[STAKEHOLDER_LABELS[contact.role], contact.company].filter(Boolean).join(" · ")}
                  </span>
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <Mail className="h-3 w-3" />
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {contact.phone}
                    </span>
                  )}
                </div>
              </div>
              <Button size="sm" onClick={() => setLogOpen((v) => !v)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Log activity
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto p-6">
          {/* Relationship + next action */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Relationship stage
              </div>
              <div className="flex flex-wrap gap-2">
                {RELATIONSHIP_STAGE_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => updateField({ relationship_stage: s })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      s === stage
                        ? RELATIONSHIP_STAGE_TONE[s]
                        : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    {RELATIONSHIP_STAGE_LABELS[s]}
                  </button>
                ))}
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Last touched: {relativeTime(contact.last_touched_at) ?? "—"}
              </div>
            </div>

            <NextActionCard
              currentDate={contact.next_action_at}
              currentNote={contact.next_action_note}
              onSave={(date, note) => updateField({ next_action_at: date, next_action_note: note })}
            />
          </section>

          {/* Log activity panel */}
          {logOpen && (
            <LogActivityCard
              contactId={contactId!}
              dealOptions={contact.deals.map((d) => ({ id: d.deal_id, name: d.deal_name }))}
              onLogged={() => {
                setLogOpen(false);
                load();
              }}
            />
          )}

          {/* Deals on this contact */}
          <section className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Deals
            </div>
            {contact.deals.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">Not linked to any deals yet.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {contact.deals.map((d) => (
                  <li key={d.link_id} className="py-2">
                    <Link
                      href={`/deals/${d.deal_id}`}
                      className="flex items-center justify-between gap-3 text-sm hover:text-primary"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-foreground/90">{d.deal_name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[d.city, d.state].filter(Boolean).join(", ") || "—"}
                          {d.role_on_deal && ` · ${titleCase(d.role_on_deal)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.is_source && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Source
                          </span>
                        )}
                        <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                          {d.deal_status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Activity timeline */}
          <section className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Activity
            </div>
            {activities.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">No activity logged yet.</p>
            ) : (
              <ul className="space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[10px] font-semibold uppercase text-muted-foreground">
                      {a.kind.slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium text-foreground/90">
                          {CONTACT_ACTIVITY_LABELS[a.kind]}
                        </span>
                        {a.deal_name && (
                          <Link
                            href={`/deals/${a.deal_id}`}
                            className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-primary"
                          >
                            {a.deal_name}
                          </Link>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {relativeTime(a.occurred_at)}
                        </span>
                      </div>
                      {a.subject && (
                        <div className="mt-0.5 text-sm text-foreground/90">{a.subject}</div>
                      )}
                      {a.body && (
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                          {a.body}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </AppShell>
  );
}

function NextActionCard({
  currentDate,
  currentNote,
  onSave,
}: {
  currentDate: string | null;
  currentNote: string | null;
  onSave: (date: string | null, note: string | null) => void;
}) {
  const [date, setDate] = useState(currentDate?.slice(0, 10) ?? "");
  const [note, setNote] = useState(currentNote ?? "");

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <CalendarClock className="h-3 w-3" />
        Next action
      </div>
      <div className="space-y-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What to do — e.g. follow up on tour"
          maxLength={200}
          className="w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSave(date ? new Date(date).toISOString() : null, note.trim() || null)}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogActivityCard({
  contactId,
  dealOptions,
  onLogged,
}: {
  contactId: string;
  dealOptions: Array<{ id: string; name: string }>;
  onLogged: () => void;
}) {
  const [kind, setKind] = useState<ContactActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dealId, setDealId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          subject: subject.trim() || null,
          body: body.trim() || null,
          deal_id: dealId || null,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to log activity");
        return;
      }
      toast.success("Activity logged");
      setSubject("");
      setBody("");
      onLogged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-primary">
          Log activity
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                k === kind
                  ? "border-primary/55 bg-primary/15 text-primary"
                  : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {CONTACT_ACTIVITY_LABELS[k]}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject (optional)"
          maxLength={200}
          className="w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened?"
          rows={3}
          maxLength={4000}
          className="w-full resize-none rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        {dealOptions.length > 0 && (
          <select
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            className="w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
          >
            <option value="">No deal context</option>
            {dealOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex justify-end">
          <Button size="sm" disabled={saving} onClick={submit}>
            Log
          </Button>
        </div>
      </div>
    </div>
  );
}
