"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Plus,
  Star,
  Search,
  Building2,
  TrendingUp,
  FileSearch,
  BookOpen,
  LayoutGrid,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import KanbanCard from "@/components/KanbanCard";
import type { Deal, DealStatus } from "@/lib/types";
import { DEAL_PIPELINE, DEAL_STAGE_LABELS } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  om_score?: number;
}

const COLUMN_COLORS: Record<DealStatus, { dot: string; count: string }> = {
  sourcing: { dot: "bg-zinc-400", count: "text-zinc-400" },
  screening: { dot: "bg-blue-400", count: "text-blue-400" },
  loi: { dot: "bg-amber-400", count: "text-amber-400" },
  under_contract: { dot: "bg-orange-400", count: "text-orange-400" },
  diligence: { dot: "bg-primary", count: "text-primary" },
  closing: { dot: "bg-emerald-400", count: "text-emerald-400" },
  closed: { dot: "bg-emerald-500", count: "text-emerald-500" },
  dead: { dot: "bg-red-400", count: "text-red-400" },
};

export default function DashboardPage() {
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  const filtered = deals.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.city?.toLowerCase().includes(q)
    );
  });

  // Group deals by status into columns
  const columns = [...DEAL_PIPELINE, "dead" as DealStatus];
  const dealsByStatus = columns.reduce<Record<string, DealWithStats[]>>((acc, status) => {
    acc[status] = filtered.filter((d) => d.status === status);
    return acc;
  }, {});

  const stats = {
    total: deals.length,
    active: deals.filter((d) => !["closed", "dead"].includes(d.status)).length,
    starred: deals.filter((d) => d.starred).length,
    analyzed: deals.filter((d) => d.om_score != null).length,
  };

  return (
    <div className="min-h-screen bg-background noise flex flex-col">
      {/* ── Hero header ── */}
      <header className="relative overflow-hidden border-b border-border/40 shrink-0">
        <div className="absolute inset-0 gradient-mesh" />
        <div className="relative max-w-full mx-auto px-6 sm:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg gradient-gold flex items-center justify-center">
                <Building2 className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-display text-lg text-foreground tracking-tight">
                Deal Intelligence
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* Quick stats */}
              <div className="hidden md:flex items-center gap-4 mr-4">
                {[
                  { label: "Active", value: stats.active, accent: "text-emerald-400" },
                  { label: "Starred", value: stats.starred, accent: "text-amber-400" },
                  { label: "Analyzed", value: stats.analyzed, accent: "text-blue-400" },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="flex items-center gap-1.5 text-xs">
                    <span className={cn("font-bold tabular-nums", accent)}>{value}</span>
                    <span className="text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
              <Link href="/business-plans">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                  Plans
                </Button>
              </Link>
              <Link href="/deals/new">
                <Button size="sm" className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  New Deal
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ── Search bar ── */}
      <div className="shrink-0 border-b border-border/30 bg-card/30 backdrop-blur-sm px-6 sm:px-8 py-3">
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

      {/* ── Kanban board ── */}
      <main className="flex-1 overflow-x-auto px-6 sm:px-8 py-6">
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
            <Link href="/deals/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create your first deal
              </Button>
            </Link>
          </div>
        ) : (
          <div className="flex gap-4 min-w-max animate-fade-up">
            {columns.map((status) => {
              const colDeals = dealsByStatus[status] || [];
              const colors = COLUMN_COLORS[status];
              const isEmpty = colDeals.length === 0;

              return (
                <div
                  key={status}
                  className="w-72 shrink-0 flex flex-col"
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("w-2 h-2 rounded-full", colors.dot)} />
                      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        {DEAL_STAGE_LABELS[status]}
                      </h3>
                    </div>
                    <span className={cn("text-xs font-bold tabular-nums", colors.count)}>
                      {colDeals.length}
                    </span>
                  </div>

                  {/* Column body */}
                  <div
                    className={cn(
                      "flex-1 rounded-xl border border-border/30 p-2 space-y-2 min-h-[120px]",
                      isEmpty
                        ? "bg-muted/5 border-dashed"
                        : "bg-muted/10"
                    )}
                  >
                    {isEmpty ? (
                      <div className="flex items-center justify-center h-full min-h-[100px]">
                        <p className="text-2xs text-muted-foreground/30">No deals</p>
                      </div>
                    ) : (
                      colDeals.map((deal) => (
                        <KanbanCard
                          key={deal.id}
                          deal={deal}
                          onStar={handleStar}
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
    </div>
  );
}
