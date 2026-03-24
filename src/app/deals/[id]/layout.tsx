"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  FileText,
  CheckSquare,
  MessageSquare,
  LayoutDashboard,
  Star,
  Calculator,
  Camera,
  FileSignature,
  ScrollText,
  FileSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_LABELS } from "@/lib/types";
import type { DealStatus } from "@/lib/types";

interface Deal {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  status: DealStatus;
  starred: boolean;
}

const NAV_ITEMS = [
  { href: "", label: "Overview", icon: LayoutDashboard },
  { href: "/om-analysis", label: "OM Analysis", icon: FileSearch },
  { href: "/underwriting", label: "Underwriting", icon: Calculator },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/photos", label: "Photos", icon: Camera },
  { href: "/checklist", label: "Checklist", icon: CheckSquare },
  { href: "/loi", label: "LOI", icon: FileSignature },
  { href: "/dd-abstract", label: "DD Abstract", icon: ScrollText },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

const STATUS_COLORS: Record<string, string> = {
  prospecting: "bg-blue-100 text-blue-700",
  diligence: "bg-amber-100 text-amber-700",
  loi: "bg-purple-100 text-purple-700",
  under_contract: "bg-indigo-100 text-indigo-700",
  closed: "bg-emerald-100 text-emerald-700",
  dead: "bg-gray-100 text-gray-500",
};

export default function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    fetch(`/api/deals/${params.id}`)
      .then((r) => r.json())
      .then((j) => setDeal(j.data))
      .catch(console.error);
  }, [params.id]);

  const basePath = `/deals/${params.id}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header bar ── */}
      <header className="gradient-header sticky top-0 z-20 shadow-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 py-3">
            {/* Back link */}
            <Link href="/">
              <button className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">All Deals</span>
              </button>
            </Link>
            <span className="text-white/30">/</span>

            {/* Brand mark */}
            <Link href="/" className="flex items-center gap-2 text-white font-semibold text-sm">
              <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                <Building2 className="h-4 w-4 text-white" />
              </div>
              <span className="hidden sm:inline opacity-80">FlexBay OS</span>
            </Link>

            <span className="text-white/30">/</span>

            {deal ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-white text-sm truncate max-w-[200px] sm:max-w-sm">
                  {deal.name}
                </span>
                {deal.starred && (
                  <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />
                )}
                {deal.city && (
                  <span className="text-xs text-white/60 hidden md:inline">
                    {deal.city}, {deal.state}
                  </span>
                )}
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0",
                    STATUS_COLORS[deal.status] ?? "bg-white/20 text-white"
                  )}
                >
                  {DEAL_STAGE_LABELS[deal.status] || deal.status}
                </span>
              </div>
            ) : (
              <div className="h-5 w-40 rounded bg-white/20 animate-pulse" />
            )}
          </div>
        </div>

        {/* ── Tab nav ── */}
        <div className="bg-white/5 border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex gap-0.5 overflow-x-auto scrollbar-none py-1">
              {NAV_ITEMS.map((item) => {
                const fullPath = `${basePath}${item.href}`;
                const isActive =
                  item.href === ""
                    ? pathname === basePath
                    : pathname.startsWith(fullPath);
                const Icon = item.icon;

                return (
                  <Link key={item.href} href={fullPath}>
                    <button
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-all whitespace-nowrap",
                        isActive
                          ? "bg-white text-primary shadow-sm"
                          : "text-white/70 hover:text-white hover:bg-white/10"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
