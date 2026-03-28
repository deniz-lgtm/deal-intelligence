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
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import DealCard from "@/components/DealCard";
import type { Deal, DealStatus } from "@/lib/types";
import { toast } from "sonner";

interface DealWithStats extends Deal {
  document_count?: number;
  checklist_complete?: number;
  checklist_total?: number;
  om_score?: number;
}

const STATUS_FILTERS: { value: DealStatus | "all" | "starred"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "starred", label: "Starred" },
  { value: "sourcing", label: "Sourcing" },
  { value: "screening", label: "Screening" },
  { value: "loi", label: "LOI" },
  { value: "under_contract", label: "Under Contract" },
  { value: "diligence", label: "Diligence" },
  { value: "closing", label: "Closing" },
  { value: "closed", label: "Closed" },
  { value: "dead", label: "Dead" },
];

export default function DashboardPage() {
  const [deals, setDeals] = useState<DealWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
    const matchesSearch =
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.address.toLowerCase().includes(search.toLowerCase()) ||
      d.city.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "starred" ? d.starred : d.status === statusFilter);

    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: deals.length,
    active: deals.filter((d) => !["closed", "dead"].includes(d.status)).length,
    starred: deals.filter((d) => d.starred).length,
    analyzed: deals.filter((d) => d.om_score != null).length,
  };

  return (
    <div className="min-h-screen bg-background noise">
      {/* ── Hero header ── */}
      <header className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 gradient-mesh" />
        <div className="relative max-w-7xl mx-auto px-6 sm:px-8">
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
              <Link href="/business-plans">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                  Business Plans
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

          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-8 pt-4">
            {[
              { icon: LayoutGrid, label: "Total Deals", value: stats.total, accent: "text-primary" },
              { icon: TrendingUp, label: "Active", value: stats.active, accent: "text-emerald-400" },
              { icon: Star, label: "Starred", value: stats.starred, accent: "text-amber-400" },
              { icon: FileSearch, label: "OM Analyzed", value: stats.analyzed, accent: "text-blue-400" },
            ].map(({ icon: Icon, label, value, accent }, i) => (
              <div
                key={label}
                className={`animate-fade-up stagger-${i + 1} group flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-card/50 hover:bg-card hover:border-border transition-all duration-300`}
              >
                <div className={`h-10 w-10 rounded-xl bg-muted flex items-center justify-center ${accent}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5 uppercase tracking-wider">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-8">
        {/* ── Search + Filters ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8 animate-fade-up stagger-5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search deals, addresses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-border/60 rounded-xl bg-card/50 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted-foreground/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`shrink-0 text-2xs px-3 py-2 rounded-lg transition-all duration-200 font-medium ${
                  statusFilter === f.value
                    ? "gradient-gold text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Deals grid ── */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className={`animate-fade-up stagger-${Math.min(i + 1, 6)} h-72 rounded-xl border border-border/40 bg-card/30 overflow-hidden`}
              >
                <div className="h-full p-5 flex flex-col">
                  <div className="flex gap-2 mb-4">
                    <div className="h-5 w-16 rounded-full bg-muted/50 animate-pulse" />
                    <div className="h-5 w-20 rounded-full bg-muted/50 animate-pulse" />
                  </div>
                  <div className="h-6 w-3/4 rounded bg-muted/50 animate-pulse mb-2" />
                  <div className="h-4 w-1/2 rounded bg-muted/30 animate-pulse mb-6" />
                  <div className="flex gap-4 mb-auto">
                    <div className="h-4 w-24 rounded bg-muted/40 animate-pulse" />
                    <div className="h-4 w-16 rounded bg-muted/30 animate-pulse" />
                  </div>
                  <div className="flex gap-2 mt-4">
                    <div className="h-9 flex-1 rounded-lg bg-muted/30 animate-pulse" />
                    <div className="h-9 flex-1 rounded-lg bg-muted/30 animate-pulse" />
                    <div className="h-9 flex-1 rounded-lg bg-muted/40 animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-32 animate-fade-up">
            <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-6">
              <Building2 className="h-9 w-9 text-muted-foreground/20" />
            </div>
            <h2 className="font-display text-2xl mb-2 text-foreground">
              {deals.length === 0 ? "No deals yet" : "No matches"}
            </h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
              {deals.length === 0
                ? "Create your first deal to start building your pipeline."
                : "Try adjusting your search or filter criteria."}
            </p>
            {deals.length === 0 && (
              <Link href="/deals/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first deal
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {filtered.length} deal{filtered.length !== 1 ? "s" : ""}
                {statusFilter !== "all" || search ? " filtered" : ""}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((deal, i) => (
                <div key={deal.id} className={`animate-fade-up stagger-${Math.min(i + 1, 6)}`}>
                  <DealCard
                    deal={deal}
                    documentCount={deal.document_count}
                    checklistProgress={
                      deal.checklist_total
                        ? {
                            complete: deal.checklist_complete || 0,
                            total: deal.checklist_total,
                          }
                        : undefined
                    }
                    onStar={handleStar}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
