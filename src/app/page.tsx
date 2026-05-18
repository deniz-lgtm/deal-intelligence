"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  Database,
  ExternalLink,
  FolderOpen,
  Inbox,
  Link2,
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
import { toast } from "sonner";

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

interface NotionImportRecord {
  notion_page_id: string;
  notion_url: string;
  deal_id: string | null;
  action: "created" | "linked" | "updated" | "skipped" | "needs_review";
  name: string;
  updated_fields?: string[];
  match_reason?: string;
}

export default function HomePage() {
  const { can } = usePermissions();
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [linkingNotionMatch, setLinkingNotionMatch] = useState<string | null>(null);
  const [lastNotionImport, setLastNotionImport] = useState<{
    scanned: number;
    created: number;
    linked: number;
    updated: number;
    skipped: number;
    needs_review?: number;
    records?: NotionImportRecord[];
  } | null>(null);
  const [search, setSearch] = useState("");

  const loadDealDesk = useCallback(async (cancelled?: () => boolean) => {
    try {
      const [dealsRes, inboxRes] = await Promise.all([
        fetch("/api/deals"),
        fetch("/api/inbox/items").catch(() => null),
      ]);
      const dealsJson = await dealsRes.json().catch(() => ({ data: [] }));
      const inboxJson = inboxRes ? await inboxRes.json().catch(() => ({ data: [] })) : { data: [] };
      if (cancelled?.()) return;
      setDeals(Array.isArray(dealsJson.data) ? dealsJson.data : []);
      setInboxItems(Array.isArray(inboxJson.data) ? inboxJson.data : []);
    } catch (error) {
      console.error("Failed to load deal desk:", error);
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDealDesk(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadDealDesk]);

  const importFromNotion = async () => {
    setSyncingNotion(true);
    try {
      const res = await fetch("/api/notion/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_size: 75 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not import Notion Pipeline");
      setLastNotionImport(json.data);
      toast.success(
        `Notion sync: ${json.data.created} created, ${json.data.linked} linked, ${json.data.needs_review || 0} need review`
      );
      await loadDealDesk();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import Notion Pipeline");
    } finally {
      setSyncingNotion(false);
    }
  };

  const linkReviewMatch = async (record: NotionImportRecord) => {
    if (!record.deal_id) {
      toast.error("Open the deal and link this Notion project manually.");
      return;
    }
    setLinkingNotionMatch(record.notion_page_id);
    try {
      const res = await fetch("/api/notion/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: record.deal_id,
          notion_project_id: record.notion_page_id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not link Notion project");
      setLastNotionImport((prev) =>
        prev
          ? {
              ...prev,
              linked: prev.linked + 1,
              needs_review: Math.max(0, (prev.needs_review || 0) - 1),
              records: prev.records?.map((item) =>
                item.notion_page_id === record.notion_page_id
                  ? { ...item, action: "linked" as const }
                  : item
              ),
            }
          : prev
      );
      await loadDealDesk();
      toast.success("Linked Notion project to existing deal");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not link Notion project");
    } finally {
      setLinkingNotionMatch(null);
    }
  };

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
      href: "/deals/new",
      label: "Start BOE",
      value: "New",
      body: "Create a quick deal folder and start the high-level underwriting pass.",
      icon: Plus,
    },
    {
      href: "/comps-library",
      label: "Find comps",
      value: "Repo",
      body: "Open the comps and market reference library before you underwrite too deeply.",
      icon: FolderOpen,
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
              <Button variant="outline" size="sm" className="gap-1.5" onClick={importFromNotion} disabled={syncingNotion}>
                {syncingNotion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                Sync Notion
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
                    title="Notion source of truth"
                    icon={<Database className="h-4 w-4 text-emerald-400" />}
                    href="/"
                    hrefLabel="Sync"
                    onAction={importFromNotion}
                  >
                    <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                      <div className="flex items-start gap-2">
                        <Clock3 className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs leading-5 text-muted-foreground">
                          Notion owns team tasks, RFIs, risks, schedules, and meetings. Sync imports missing Pipeline projects as DI deal shells and only fills blank local fields.
                        </p>
                      </div>
                      {lastNotionImport && (
                        <>
                          <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px]">
                            <SyncStat label="Scan" value={lastNotionImport.scanned} />
                            <SyncStat label="New" value={lastNotionImport.created} />
                            <SyncStat label="Link" value={lastNotionImport.linked || 0} />
                            <SyncStat label="Review" value={lastNotionImport.needs_review || 0} />
                          </div>
                          {(lastNotionImport.records || []).some((record) => record.action === "needs_review") && (
                            <div className="mt-3 space-y-2">
                              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Review likely matches
                              </p>
                              {(lastNotionImport.records || [])
                                .filter((record) => record.action === "needs_review")
                                .slice(0, 3)
                                .map((record) => (
                                  <div key={record.notion_page_id} className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-xs font-medium text-amber-100">{record.name}</p>
                                        <p className="mt-0.5 text-[11px] text-amber-100/70">
                                          {record.match_reason || "possible duplicate"}
                                        </p>
                                      </div>
                                      <a
                                        href={record.notion_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-0.5 text-amber-100/70 hover:text-amber-100"
                                        aria-label="Open Notion project"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="mt-2 h-7 w-full gap-1.5 border-amber-500/30 bg-transparent text-[11px] text-amber-100 hover:bg-amber-500/15"
                                      onClick={() => linkReviewMatch(record)}
                                      disabled={!record.deal_id || linkingNotionMatch === record.notion_page_id}
                                    >
                                      {linkingNotionMatch === record.notion_page_id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Link2 className="h-3.5 w-3.5" />
                                      )}
                                      Link to existing deal
                                    </Button>
                                  </div>
                                ))}
                            </div>
                          )}
                        </>
                      )}
                      <Button size="sm" className="mt-3 h-8 w-full gap-1.5 text-xs" onClick={importFromNotion} disabled={syncingNotion}>
                        {syncingNotion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                        Sync Pipeline deals
                      </Button>
                    </div>
                  </Panel>

                  <Panel
                    title="Assistant"
                    icon={<MessageSquare className="h-4 w-4 text-blue-400" />}
                    href="/inbox"
                    hrefLabel="Open inbox"
                  >
                    <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                      <p className="text-xs leading-5 text-muted-foreground">
                        Drop messy inputs into Inbox or a deal&apos;s Documents tab. Reviews, questions, and red flags can then be pushed to Notion with the Pipeline relation attached.
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
  onAction,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  hrefLabel: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {hrefLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Link href={href} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {hrefLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function SyncStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/50 bg-card/60 px-2 py-1">
      <p className="font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
    </div>
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
