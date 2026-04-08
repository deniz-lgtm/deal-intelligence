"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Building2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  TrendingUp,
  Clock,
  BarChart3,
  FileSearch,
  MessageSquare,
  Calculator,
  FileText,
  Activity,
  ArrowRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import KanbanCard from "@/components/KanbanCard";
import { AppShell } from "@/components/AppShell";
import { TodayStrip } from "@/components/today/TodayStrip";
import type { Deal, DealStatus } from "@/lib/types";
import { usePipeline } from "@/lib/usePipeline";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { usePermissions } from "@/lib/usePermissions";

interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  total_project_cost?: number | null;
}

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: string;
  deal_id: string;
  deal_name: string;
}

const COLUMN_COLORS: Record<DealStatus, { dot: string; count: string; dropBg: string }> = {
  sourcing: { dot: "bg-zinc-400", count: "text-zinc-400", dropBg: "bg-zinc-400/5 border-zinc-400/30" },
  screening: { dot: "bg-blue-400", count: "text-blue-400", dropBg: "bg-blue-400/5 border-blue-400/30" },
  loi: { dot: "bg-amber-400", count: "text-amber-400", dropBg: "bg-amber-400/5 border-amber-400/30" },
  under_contract: { dot: "bg-orange-400", count: "text-orange-400", dropBg: "bg-orange-400/5 border-orange-400/30" },
  diligence: { dot: "bg-primary", count: "text-primary", dropBg: "bg-primary/5 border-primary/30" },
  closing: { dot: "bg-emerald-400", count: "text-emerald-400", dropBg: "bg-emerald-400/5 border-emerald-400/30" },
  closed: { dot: "bg-emerald-500", count: "text-emerald-500", dropBg: "bg-emerald-500/5 border-emerald-500/30" },
  dead: { dot: "bg-red-400", count: "text-red-400", dropBg: "bg-red-400/5 border-red-400/30" },
  archived: { dot: "bg-zinc-300", count: "text-zinc-400", dropBg: "bg-zinc-300/5 border-zinc-300/30" },
};

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  om_analysis: FileSearch,
  chat: MessageSquare,
  underwriting: Calculator,
  document: FileText,
  deal: Building2,
};

const ACTIVITY_COLORS: Record<string, string> = {
  om_analysis: "bg-indigo-500/10 text-indigo-400",
  chat: "bg-blue-500/10 text-blue-400",
  underwriting: "bg-purple-500/10 text-purple-400",
  document: "bg-emerald-500/10 text-emerald-400",
  deal: "bg-primary/10 text-primary",
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const { can } = usePermissions();
  const { stages: pipelineStages, labelMap: stageLabels } = usePipeline();
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showFeed, setShowFeed] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  useEffect(() => {
    loadDeals();
  }, []);

  const loadDeals = async () => {
    try {
      const res = await fetch("/api/deals");
      const json = await res.json();
      if (json.data) setDeals(json.data);
    } catch (err) {
      console.error("Failed to load deals:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadActivity = useCallback(async () => {
    if (activityEvents.length > 0) return; // already loaded
    setActivityLoading(true);
    try {
      const res = await fetch("/api/activity");
      const json = await res.json();
      if (json.data) setActivityEvents(json.data);
    } catch (err) {
      console.error("Failed to load activity:", err);
    } finally {
      setActivityLoading(false);
    }
  }, [activityEvents.length]);

  const handleStar = async (id: string, starred: boolean) => {
    setDeals((prev) =>
      prev.map((d) => (d.id === id ? { ...d, starred } : d))
    );
    await fetch(`/api/deals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred }),
    });
    toast.success(starred ? "Deal starred" : "Star removed");
  };

  // ── Drag & Drop ──
  const handleDragStart = (e: React.DragEvent, dealId: string) => {
    setDraggingDealId(dealId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dealId);
    // Make the drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggingDealId(null);
    setDragOverColumn(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: DealStatus) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData("text/plain");
    setDraggingDealId(null);
    setDragOverColumn(null);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.status === newStatus) return;

    const oldStatus = deal.status;

    // Optimistic update
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, status: newStatus } : d))
    );

    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(`Moved to ${stageLabels[newStatus] ?? newStatus}`);
    } catch {
      // Revert on error
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, status: oldStatus } : d))
      );
      toast.error("Failed to move deal");
    }
  };

  const filtered = deals.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.city?.toLowerCase().includes(q)
    );
  });

  // Pipeline stages come from the admin-editable DB (or fall back to defaults).
  // We always append "dead" and "archived" as off-pipeline columns.
  const pipelineIds = pipelineStages.map((s) => s.id) as DealStatus[];
  const columns = [...pipelineIds, "dead" as DealStatus, "archived" as DealStatus];
  const dealsByStatus = columns.reduce<Record<string, DealWithStats[]>>((acc, status) => {
    acc[status] = filtered.filter((d) => d.status === status);
    return acc;
  }, {});

  // ── Analytics computation ──
  const activeDeals = deals.filter((d) => !["closed", "dead", "archived"].includes(d.status));
  const dealCost = (d: DealWithStats) => (d.total_project_cost && d.total_project_cost > 0 ? d.total_project_cost : d.asking_price) || 0;
  const pipelineDeals = deals.filter((d) => ["under_contract", "diligence", "closing", "closed"].includes(d.status));
  const totalPipelineValue = pipelineDeals.reduce((sum, d) => sum + dealCost(d), 0);
  const avgScore = (() => {
    const scored = deals.filter((d) => d.om_score != null);
    if (scored.length === 0) return null;
    return (scored.reduce((s, d) => s + (d.om_score || 0), 0) / scored.length).toFixed(1);
  })();

  const columnMetrics = columns.map((status) => {
    const colDeals = dealsByStatus[status] || [];
    const value = colDeals.reduce((s, d) => s + dealCost(d), 0);
    return { status, count: colDeals.length, value };
  });

  const toggleFeed = () => {
    const next = !showFeed;
    setShowFeed(next);
    if (next) loadActivity();
  };

  return (
    <AppShell>
    <div className="flex flex-col flex-1 min-h-0" onDragEnd={handleDragEnd}>
      {/* ── Header (Pipeline-specific toolbar; workspace nav lives in the left rail) ── */}
      <header className="relative overflow-hidden border-b border-border/40 shrink-0">
        <div className="absolute inset-0 gradient-mesh" />
        <div className="relative max-w-full mx-auto px-6 sm:px-8">
          <div className="flex items-center justify-between h-14 min-w-0">
            <div className="flex items-center gap-3">
              <span className="font-display text-base text-foreground tracking-tight">
                Pipeline
              </span>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                Kanban view
              </span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <Button size="sm" variant="ghost"
                className={cn("text-xs gap-1.5 hidden sm:inline-flex", showFeed ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                onClick={toggleFeed}>
                <Activity className="h-3.5 w-3.5" /> Feed
              </Button>
              <Button size="sm" variant="ghost"
                className={cn("text-xs gap-1.5 hidden sm:inline-flex", showAnalytics ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setShowAnalytics((v) => !v)}>
                <BarChart3 className="h-3.5 w-3.5" /> Analytics
                {showAnalytics ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
              <div className="w-px h-5 bg-border/40 mx-1 hidden sm:block" />
              {can("deals.create") && (
                <Link href="/deals/new">
                  <Button size="sm" className="text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    New Deal
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Today strip (AI command center summary) ── */}
      <TodayStrip />

      {/* ── Analytics row (collapsible) ── */}
      {showAnalytics && (
        <div className="shrink-0 border-b border-border/30 bg-card/30 backdrop-blur-sm animate-fade-up">
          <div className="max-w-full mx-auto px-6 sm:px-8 py-4">
            {/* Top summary */}
            <div className="flex items-center gap-6 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums tracking-tight">{formatCurrency(totalPipelineValue)}</p>
                  <p className="text-2xs text-muted-foreground">Pipeline Value</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums tracking-tight">{activeDeals.length}</p>
                  <p className="text-2xs text-muted-foreground">Active Deals</p>
                </div>
              </div>
              {avgScore && (
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileSearch className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums tracking-tight">{avgScore}</p>
                    <p className="text-2xs text-muted-foreground">Avg OM Score</p>
                  </div>
                </div>
              )}
            </div>

            {/* Per-column value bar */}
            <div className="flex items-end gap-4">
              {columnMetrics.filter(m => m.status !== "dead" && m.status !== "archived").map((m) => {
                const maxValue = Math.max(...columnMetrics.map((c) => c.value), 1);
                const barHeight = m.value > 0 ? Math.max(4, Math.round((m.value / maxValue) * 40)) : 0;
                const colors = COLUMN_COLORS[m.status as DealStatus];
                return (
                  <div key={m.status} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                    {m.value > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums truncate">
                        {formatCurrency(m.value)}
                      </span>
                    )}
                    <div
                      className={cn("w-full rounded-sm transition-all", colors.dot)}
                      style={{ height: `${barHeight}px`, opacity: barHeight > 0 ? 1 : 0.15, minHeight: barHeight > 0 ? undefined : "4px" }}
                    />
                    <span className="text-[10px] text-muted-foreground/60 truncate">
                      {stageLabels[m.status as DealStatus] ?? m.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Search bar ── */}
      <div className="shrink-0 border-b border-border/30 bg-card/20 px-6 sm:px-8 py-2.5">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-border/50 rounded-lg bg-background/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted-foreground/30"
            />
          </div>
          <span className="text-2xs text-muted-foreground tabular-nums">
            {filtered.length} deal{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Main area: Kanban + Activity Feed ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Kanban board */}
        <main className="flex-1 overflow-x-auto px-6 sm:px-8 py-5">
          {loading ? (
            <div className="flex gap-4 min-w-max">
              {columns.map((status) => (
                <div key={status} className="w-72 shrink-0">
                  <div className="h-8 w-24 rounded bg-muted/30 animate-pulse mb-3" />
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-28 rounded-lg border border-border/30 bg-card/30 animate-pulse" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : deals.length === 0 ? (
            <div className="text-center py-32 animate-fade-up">
              <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-6">
                <Building2 className="h-9 w-9 text-muted-foreground/20" />
              </div>
              <h2 className="font-display text-2xl mb-2 text-foreground">No deals yet</h2>
              <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
                Create your first deal to start building your pipeline.
              </p>
              {can("deals.create") && (
                <Link href="/deals/new">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first deal
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="flex gap-4 min-w-max animate-fade-up">
              {columns.map((status) => {
                const colDeals = dealsByStatus[status] || [];
                const colors = COLUMN_COLORS[status];
                const isEmpty = colDeals.length === 0;
                const isDragOver = dragOverColumn === status;
                const draggingDeal = draggingDealId ? deals.find((d) => d.id === draggingDealId) : null;
                const isValidDrop = draggingDeal && draggingDeal.status !== status;

                return (
                  <div key={status} className="w-72 shrink-0 flex flex-col">
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-2 h-2 rounded-full", colors.dot)} />
                        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                          {stageLabels[status] ?? status}
                        </h3>
                      </div>
                      <span className={cn("text-xs font-bold tabular-nums", colors.count)}>
                        {colDeals.length}
                      </span>
                    </div>

                    {/* Column body (drop zone) */}
                    <div
                      onDragOver={(e) => handleDragOver(e, status)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, status)}
                      className={cn(
                        "flex-1 rounded-xl border p-2 space-y-2 min-h-[120px] transition-all duration-200",
                        isDragOver && isValidDrop
                          ? colors.dropBg
                          : isEmpty
                          ? "bg-muted/5 border-border/30 border-dashed"
                          : "bg-muted/10 border-border/30"
                      )}
                    >
                      {isEmpty && !isDragOver ? (
                        <div className="flex items-center justify-center h-full min-h-[100px]">
                          <p className="text-2xs text-muted-foreground/30">No deals</p>
                        </div>
                      ) : isEmpty && isDragOver ? (
                        <div className="flex items-center justify-center h-full min-h-[100px]">
                          <p className="text-2xs text-muted-foreground/60">Drop here</p>
                        </div>
                      ) : (
                        colDeals.map((deal) => (
                          <KanbanCard
                            key={deal.id}
                            deal={deal}
                            onStar={handleStar}
                            onDragStart={handleDragStart}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* ── Activity Feed sidebar ── */}
        {showFeed && (
          <aside className="w-80 shrink-0 border-l border-border/30 bg-card/30 backdrop-blur-sm flex flex-col animate-fade-up overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">Activity Feed</h3>
              </div>
              <button onClick={() => setShowFeed(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activityLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-7 h-7 rounded-lg bg-muted/30 animate-pulse shrink-0" />
                      <div className="flex-1">
                        <div className="h-3 w-24 rounded bg-muted/30 animate-pulse mb-1.5" />
                        <div className="h-3 w-full rounded bg-muted/20 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activityEvents.length === 0 ? (
                <div className="p-8 text-center">
                  <Activity className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {activityEvents.map((event, i) => {
                    const Icon = ACTIVITY_ICONS[event.type] || Activity;
                    const color = ACTIVITY_COLORS[event.type] || "bg-muted/30 text-muted-foreground";
                    return (
                      <div key={i} className="flex gap-3 px-4 py-3 hover:bg-muted/10 transition-colors">
                        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", color)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/deals/${event.deal_id}`}
                            className="text-2xs font-semibold text-foreground hover:text-primary transition-colors truncate block"
                          >
                            {event.deal_name}
                          </Link>
                          <p className="text-2xs text-muted-foreground truncate mt-0.5">{event.description}</p>
                          <p className="text-[10px] text-muted-foreground/40 mt-0.5">{formatRelativeTime(event.timestamp)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
    </AppShell>
  );
}
