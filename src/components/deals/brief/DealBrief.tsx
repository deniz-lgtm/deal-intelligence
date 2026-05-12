"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building,
  ClipboardCheck,
  FileSearch,
  Quote,
  Sparkles,
  Users,
} from "lucide-react";
import { cn, formatCurrency, formatNumber, titleCase } from "@/lib/utils";
import type { Deal, DealNote, DealContactLink } from "@/lib/types";

interface DecisionRow {
  id: string;
  number: number;
  title: string;
  status: string;
  due_date: string | null;
}

interface DealBriefProps {
  deal: Deal;
}

function quantTone(score: number | null | undefined) {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-500";
  if (score >= 55) return "text-amber-500";
  return "text-rose-500";
}

function relDays(due: string | null) {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  if (days < 0) return { tone: "overdue" as const, label: `${Math.abs(days)}d overdue` };
  if (days === 0) return { tone: "overdue" as const, label: "Today" };
  if (days <= 7) return { tone: "soon" as const, label: `in ${days}d` };
  return { tone: "later" as const, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
}

/**
 * Deal Brief canvas — the daily home of a single deal. Reads-only and
 * link-through to the deeper pages. Lives above the legacy deal detail
 * blocks until those get migrated in.
 */
export function DealBrief({ deal }: DealBriefProps) {
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [contacts, setContacts] = useState<DealContactLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/deals/${deal.id}/notes`).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch(`/api/deals/${deal.id}/decisions`).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch(`/api/deals/${deal.id}/contacts`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([n, d, c]) => {
      if (cancelled) return;
      setNotes(Array.isArray(n?.data) ? n.data : []);
      setDecisions(Array.isArray(d?.data) ? d.data : []);
      setContacts(Array.isArray(c?.data) ? c.data : []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [deal.id]);

  const thesis = useMemo(
    () => notes.find((n) => n.category === "thesis"),
    [notes]
  );
  const risks = useMemo(() => notes.filter((n) => n.category === "risk").slice(0, 3), [notes]);
  const openDecisions = useMemo(
    () => decisions.filter((d) => d.status === "open").slice(0, 5),
    [decisions]
  );
  const pinnedContacts = useMemo(() => contacts.slice(0, 5), [contacts]);

  const basePath = `/deals/${deal.id}`;

  return (
    <section className="space-y-4">
      {/* ── Thesis line + headline metrics ─────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Quote className="h-3 w-3" />
              Thesis
            </div>
            {thesis ? (
              <p className="mt-1 text-sm italic text-foreground/90">{thesis.text}</p>
            ) : (
              <Link
                href={`${basePath}/chat`}
                className="mt-1 inline-flex text-sm text-muted-foreground/70 hover:text-primary"
              >
                Write a one-line thesis →
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-xl">
            <BriefMetric label="Ask" value={deal.asking_price ? formatCurrency(deal.asking_price) : "—"} />
            <BriefMetric
              label={deal.units && deal.units > 0 ? "Units" : "SF"}
              value={
                deal.units && deal.units > 0
                  ? formatNumber(deal.units)
                  : deal.square_footage
                    ? formatNumber(deal.square_footage)
                    : "—"
              }
            />
            <BriefMetric
              label="Score"
              value={typeof deal.quant_composite === "number" ? `${Math.round(deal.quant_composite)}/100` : "—"}
              tone={quantTone(deal.quant_composite)}
            />
            <BriefMetric label="Year" value={deal.year_built ? String(deal.year_built) : "—"} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Decisions ───────────────────────────────────────────────── */}
        <BriefCard
          icon={ClipboardCheck}
          title="Open decisions"
          action={{ href: `${basePath}/decisions`, label: "All" }}
        >
          {loading ? (
            <BriefSkeleton />
          ) : openDecisions.length === 0 ? (
            <BriefEmpty>No open decisions.</BriefEmpty>
          ) : (
            <ul className="divide-y divide-border/40">
              {openDecisions.map((d) => {
                const due = relDays(d.due_date);
                return (
                  <li key={d.id} className="py-2 first:pt-0 last:pb-0">
                    <Link
                      href={`${basePath}/decisions`}
                      className="flex items-start gap-2 text-sm hover:text-primary"
                    >
                      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground">
                        #{d.number}
                      </span>
                      <span className="flex-1 truncate text-foreground/90">{d.title}</span>
                      {due && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            due.tone === "overdue" && "bg-rose-500/15 text-rose-500",
                            due.tone === "soon" && "bg-amber-500/15 text-amber-500",
                            due.tone === "later" && "bg-muted/60 text-muted-foreground"
                          )}
                        >
                          {due.label}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </BriefCard>

        {/* ── People ──────────────────────────────────────────────────── */}
        <BriefCard
          icon={Users}
          title="People on this deal"
          action={{ href: `${basePath}/contacts`, label: "All" }}
        >
          {loading ? (
            <BriefSkeleton />
          ) : pinnedContacts.length === 0 ? (
            <BriefEmpty>No contacts linked yet.</BriefEmpty>
          ) : (
            <ul className="divide-y divide-border/40">
              {pinnedContacts.map((c) => (
                <li key={c.link_id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground/90">{c.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {[titleCase(c.role_on_deal ?? c.role), c.company].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {c.is_source && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Source
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </BriefCard>

        {/* ── Risks ───────────────────────────────────────────────────── */}
        <BriefCard
          icon={AlertTriangle}
          title="Top risks"
          action={{ href: `${basePath}/chat`, label: "Log" }}
        >
          {loading ? (
            <BriefSkeleton />
          ) : risks.length === 0 ? (
            <BriefEmpty>No risks logged.</BriefEmpty>
          ) : (
            <ul className="space-y-2">
              {risks.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-xs text-foreground/90"
                >
                  {r.text}
                </li>
              ))}
            </ul>
          )}
        </BriefCard>
      </div>

      {/* ── Outputs row ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3 sm:p-4">
        <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Drill in
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <BriefLink href={`${basePath}/om-analysis`} label="Offering memo" icon={FileSearch} />
          <BriefLink href={`${basePath}/underwriting`} label="Underwriting" icon={Activity} />
          <BriefLink href={`${basePath}/comps`} label="Comps" icon={Building} />
          <BriefLink href={`${basePath}/investment-package`} label="IC package" icon={ClipboardCheck} />
        </div>
      </div>
    </section>
  );
}

// ─── Small atoms ─────────────────────────────────────────────────────────

function BriefMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 text-sm font-semibold text-foreground", tone)}>{value}</div>
    </div>
  );
}

function BriefCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof ClipboardCheck;
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Icon className="h-3 w-3" />
          {title}
        </div>
        {action && (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary"
          >
            {action.label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function BriefLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof ClipboardCheck;
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center justify-between rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm transition-colors hover:border-primary/45 hover:bg-primary/5"
    >
      <span className="inline-flex items-center gap-2 text-foreground/80 group-hover:text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
        {label}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary" />
    </Link>
  );
}

function BriefSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/40" />
      ))}
    </div>
  );
}

function BriefEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground/70">{children}</p>;
}
