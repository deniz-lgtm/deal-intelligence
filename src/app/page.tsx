"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Plus,
  Star,
  Search,
  Building2,
  TrendingUp,
  CheckSquare,
  FileSearch,
  BookOpen,
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
  { value: "starred", label: "⭐ Starred" },
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
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="gradient-header sticky top-0 z-20 shadow-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-md px-2 py-1">
              <Image
                src="/flexbay-logo.png"
                alt="FlexBay"
                width={100}
                height={32}
                className="h-7 w-auto"
              />
            </div>
            <div className="h-5 w-px bg-white/30" />
            <div>
              <h1 className="font-bold text-base leading-none text-white">Deal Intelligence</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/business-plans">
              <Button
                size="sm"
                variant="ghost"
                className="text-white/80 hover:text-white hover:bg-white/15 font-medium"
              >
                <BookOpen className="h-4 w-4 mr-1.5" />
                Business Plans
              </Button>
            </Link>
            <Link href="/deals/new">
              <Button
                size="sm"
                className="bg-white text-primary hover:bg-white/90 shadow-sm font-semibold"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New Deal
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard
            icon={<Building2 className="h-5 w-5" />}
            label="Total Deals"
            value={stats.total}
            color="text-primary"
            bg="bg-primary/8"
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5" />}
            label="Active"
            value={stats.active}
            color="text-blue-600"
            bg="bg-blue-50"
          />
          <StatCard
            icon={<Star className="h-5 w-5" />}
            label="Starred"
            value={stats.starred}
            color="text-amber-500"
            bg="bg-amber-50"
          />
          <StatCard
            icon={<FileSearch className="h-5 w-5" />}
            label="OM Analyzed"
            value={stats.analyzed}
            color="text-emerald-600"
            bg="bg-emerald-50"
          />
        </div>

        {/* ── Search + Filters ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search deals, addresses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-card"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all font-medium ${
                  statusFilter === f.value
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-card hover:bg-accent border-border text-muted-foreground hover:text-foreground"
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
                className="h-56 rounded-xl border bg-card animate-pulse shadow-card"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Building2 className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <h2 className="text-lg font-semibold mb-2">
              {deals.length === 0 ? "No deals yet" : "No deals match your filters"}
            </h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              {deals.length === 0
                ? "Start by creating your first deal and uploading diligence documents."
                : "Try adjusting your search or filter."}
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
            <p className="text-xs text-muted-foreground mb-3">
              {filtered.length} deal{filtered.length !== 1 ? "s" : ""}
              {statusFilter !== "all" || search ? " (filtered)" : ""}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((deal) => (
                <DealCard
                  key={deal.id}
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
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="border rounded-xl p-4 bg-card flex items-center gap-3 shadow-card hover:shadow-lifted transition-shadow">
      <div className={`h-10 w-10 rounded-xl ${bg} flex items-center justify-center shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}
