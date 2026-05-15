"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  FileSearch,
  FolderOpen,
  Inbox,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DEAL_STAGE_LABELS, type Deal } from "@/lib/types";
import { formatCurrency, titleCase } from "@/lib/utils";
import { usePermissions } from "@/lib/usePermissions";

interface DealWithStats extends Deal {
  document_count?: number;
  total_project_cost?: number | null;
}

interface InboxItem {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  asking_price?: number | null;
  created_at?: string;
  analysis_status?: string | null;
}

interface DueTask {
  id: string;
  deal_id: string;
  deal_name: string;
  title: string;
  due_date: string | null;
  kind: string;
  priority: string | null;
}

export default function HomePage() {
  const { can } = usePermissions();
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [tasksDue, setTasksDue] = useState<DueTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dealsRes, inboxRes, tasksRes] = await Promise.all([
          fetch("/api/deals"),
          fetch("/api/inbox/items").catch(() => null),
          fetch("/api/home/tasks-due").catch(() => null),
        ]);
        const dealsJson = await dealsRes.json().catch(() => ({ data: [] }));
        const inboxJson = inboxRes ? await inboxRes.json().catch(() => ({ data: [] })) : { data: [] };
        const tasksJson = tasksRes ? await tasksRes.json().catch(() => ({ data: [] })) : { data: [] };
        if (cancelled) return;
        setDeals(Array.isArray(dealsJson.data) ? dealsJson.data : []);
        setInboxItems(Array.isArray(inboxJson.data) ? inboxJson.data : []);
        setTasksDue(Array.isArray(tasksJson.data) ? tasksJson.data : []);
      } catch (error) {
        console.error("Failed to load deal desk:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDeals = useMemo(
    () => deals.filter((deal) => deal.status !== "dead" && deal.status !== "archived"),
    [deals]
  );
  const recentDeals = useMemo(() => activeDeals.slice(0, 8), [activeDeals]);
  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recentDeals;
    return activeDeals
      .filter((deal) =>
        [deal.name, deal.address, deal.city, deal.state]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 12);
  }, [activeDeals, recentDeals, search]);

  const focusCards = [
    {
      href: "/inbox",
      label: "Review inbox",
      value: inboxItems.length,
      body:
        inboxItems.length > 0
          ? "OMs and front-end deals waiting for your read."
          : "No unreviewed inbox deals right now.",
      icon: Inbox,
    },
    {
      href: "/review-doc",
      label: "Review a document",
      value: "Drop",
      body: "File a proposal, OM, report, plan, or email attachment into a deal folder.",
      icon: FileSearch,
    },
    {
      href: "/deals/new",
      label: "Start BOE",
      value: "New",
      body: "Create a quick deal folder and start the high-level underwriting pass.",
      icon: Plus,
    },
  ];

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/40 bg-card/40 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                Deal Desk
              </div>
              <h1 className="mt-2 font-display text-2xl">What needs your attention?</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                A quieter front door for screening deals, reviewing documents, and jumping back into active BOEs.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href="/review-doc">
                  <FileSearch className="h-3.5 w-3.5" />
                  Review Doc
                </Link>
              </Button>
              {can("deals.create") && (
                <Button asChild size="sm" className="gap-1.5">
                  <Link href="/deals/new">
                    <Plus className="h-3.5 w-3.5" />
                    New BOE
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading deal desk
            </div>
          ) : (
            <div className="mx-auto max-w-7xl space-y-5">
              <section className="grid gap-3 md:grid-cols-3">
                {focusCards.map((card) => {
                  const Icon = card.icon;
                  const disabled = card.href === "/deals/new" && !can("deals.create");
                  const body = (
                    <div className="flex h-full flex-col justify-between rounded-xl border border-border/60 bg-card p-4 shadow-card transition-colors group-hover:bg-muted/25">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="text-xl font-semibold tabular-nums">{card.value}</span>
                      </div>
                      <div className="mt-5">
                        <h2 className="text-sm font-semibold">{card.label}</h2>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.body}</p>
                        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
                          Open
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>
                  );
                  return disabled ? (
                    <div key={card.label} className="opacity-50">
                      {body}
                    </div>
                  ) : (
                    <Link key={card.label} href={card.href} className="group block">
                      {body}
                    </Link>
                  );
                })}
              </section>

              <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
                <div className="rounded-xl border border-border/60 bg-card shadow-card">
                  <div className="flex flex-col gap-3 border-b border-border/50 p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 text-primary" />
                        <h2 className="text-sm font-semibold">Deal folders</h2>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recent active BOEs and front-end deals.
                      </p>
                    </div>
                    <div className="relative w-full md:w-72">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search deals..."
                        className="w-full rounded-lg border border-border/50 bg-background/50 py-2 pl-8 pr-3 text-xs outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                      />
                    </div>
                  </div>

                  {filteredDeals.length === 0 ? (
                    <div className="p-8 text-center">
                      <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/40" />
                      <p className="mt-3 text-sm font-medium">No deal folders found</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Start a BOE or review a document into a new folder.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {filteredDeals.map((deal) => (
                        <Link
                          key={deal.id}
                          href={`/deals/${deal.id}`}
                          className="group grid gap-3 p-4 transition-colors hover:bg-muted/20 md:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-semibold">{deal.name}</h3>
                              <Badge variant="secondary" className="text-[10px]">
                                {DEAL_STAGE_LABELS[deal.status] || titleCase(deal.status)}
                              </Badge>
                              {deal.property_type && (
                                <Badge variant="outline" className="text-[10px]">
                                  {titleCase(deal.property_type)}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {[deal.address, deal.city, deal.state].filter(Boolean).join(", ") || "No address yet"}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-4 md:justify-end">
                            <div className="text-left md:text-right">
                              <p className="text-xs font-medium tabular-nums">
                                {formatCurrency(deal.total_project_cost || deal.asking_price)}
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {deal.document_count || 0} docs
                              </p>
                            </div>
                            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-5">
                  <Panel
                    title="Inbox"
                    icon={<Inbox className="h-4 w-4 text-primary" />}
                    href="/inbox"
                    hrefLabel="Open inbox"
                  >
                    {inboxItems.length === 0 ? (
                      <EmptyLine text="No unreviewed inbox deals." />
                    ) : (
                      <div className="space-y-2">
                        {inboxItems.slice(0, 4).map((item) => (
                          <Link
                            key={item.id}
                            href="/inbox"
                            className="block rounded-lg border border-border/50 bg-background/50 p-3 transition-colors hover:bg-muted/30"
                          >
                            <p className="line-clamp-1 text-xs font-medium">{item.name}</p>
                            <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                              {[item.address, item.city, item.state].filter(Boolean).join(", ") || "Needs triage"}
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="Due soon"
                    icon={<Clock3 className="h-4 w-4 text-amber-400" />}
                    href="/inbox"
                    hrefLabel="Review"
                  >
                    {tasksDue.length === 0 ? (
                      <EmptyLine text="No due tasks across active deals." />
                    ) : (
                      <div className="space-y-2">
                        {tasksDue.slice(0, 5).map((task) => (
                          <Link
                            key={task.id}
                            href={`/deals/${task.deal_id}`}
                            className="block rounded-lg border border-border/50 bg-background/50 p-3 transition-colors hover:bg-muted/30"
                          >
                            <p className="line-clamp-2 text-xs font-medium">{task.title}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {task.deal_name} {task.due_date ? `- due ${formatShortDate(task.due_date)}` : "- no date"}
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="Assistant"
                    icon={<MessageSquare className="h-4 w-4 text-blue-400" />}
                    href="/review-doc"
                    hrefLabel="Review doc"
                  >
                    <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                      <p className="text-xs leading-5 text-muted-foreground">
                        For now, use Review Doc for proposals and loose files. The next pass should fold this directly into the Inbox so every messy input starts in one place.
                      </p>
                    </div>
                  </Panel>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

function Panel({
  title,
  icon,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  hrefLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <Link href={href} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {hrefLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
      {text}
    </div>
  );
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
