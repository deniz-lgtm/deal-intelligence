"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
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
  Activity,
  Presentation,
  MapPin,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_LABELS } from "@/lib/types";
import type { DealStatus } from "@/lib/types";
import { useAuth } from "@clerk/nextjs";
import ShareDealDialog from "@/components/ShareDealDialog";
import { usePermissions } from "@/lib/usePermissions";

interface Deal {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  status: DealStatus;
  starred: boolean;
  owner_id: string | null;
}

const NAV_ITEMS = [
  { href: "", label: "Overview", icon: LayoutDashboard },
  { href: "/om-analysis", label: "OM Analysis", icon: FileSearch },
  { href: "/site-zoning", label: "Site & Zoning", icon: MapPin },
  { href: "/underwriting", label: "Underwriting", icon: Calculator },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/photos", label: "Photos", icon: Camera },
  { href: "/checklist", label: "Checklist", icon: CheckSquare },
  { href: "/project", label: "Project", icon: ClipboardList },
  { href: "/loi", label: "LOI", icon: FileSignature },
  { href: "/dd-abstract", label: "DD Abstract", icon: ScrollText },
  { href: "/investment-package", label: "Inv. Package", icon: Presentation },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/deal-log", label: "Deal Log", icon: Activity },
];

const STATUS_COLORS: Record<string, string> = {
  sourcing: "bg-zinc-500/20 text-zinc-300",
  screening: "bg-blue-500/20 text-blue-300",
  loi: "bg-amber-500/20 text-amber-300",
  under_contract: "bg-orange-500/20 text-orange-300",
  diligence: "bg-primary/20 text-primary",
  closing: "bg-emerald-500/20 text-emerald-300",
  closed: "bg-emerald-500/20 text-emerald-300",
  dead: "bg-red-500/20 text-red-300",
};

export default function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const { can } = usePermissions();
  const [deal, setDeal] = useState<Deal | null>(null);
  const pathname = usePathname();
  const { userId } = useAuth();

  useEffect(() => {
    fetch(`/api/deals/${params.id}`)
      .then((r) => r.json())
      .then((j) => setDeal(j.data))
      .catch(console.error);
  }, [params.id]);

  const basePath = `/deals/${params.id}`;

  return (
    <div className="min-h-screen bg-background noise flex flex-col">
      {/* ── Header bar ── */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 h-12">
            {/* Back link */}
            <Link href="/">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Deals</span>
              </button>
            </Link>
            <span className="text-border text-xs">/</span>

            {deal ? (
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="font-display text-sm text-foreground truncate max-w-[140px] sm:max-w-xs">
                  {deal.name}
                </span>
                {deal.starred && (
                  <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />
                )}
                {deal.city && (
                  <span className="text-2xs text-muted-foreground hidden md:inline">
                    {deal.city}, {deal.state}
                  </span>
                )}
                <span
                  className={cn(
                    "text-2xs px-2 py-0.5 rounded-full font-medium flex-shrink-0",
                    STATUS_COLORS[deal.status] ?? "bg-muted text-muted-foreground"
                  )}
                >
                  {DEAL_STAGE_LABELS[deal.status] || deal.status}
                </span>
                <div className="ml-auto flex-shrink-0">
                  {userId && can("deals.share") && (
                    <ShareDealDialog
                      dealId={deal.id}
                      dealName={deal.name}
                      ownerId={deal.owner_id}
                      currentUserId={userId}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="h-4 w-40 rounded bg-muted/30 animate-pulse" />
            )}
          </div>
        </div>

        {/* ── Tab nav ── */}
        <div className="border-t border-border/30">
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
                        "flex items-center gap-1.5 px-3 py-1.5 text-2xs font-medium rounded-md transition-all duration-150 whitespace-nowrap",
                        isActive
                          ? "gradient-gold text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
