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
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Mailbox,
  Users,
  BarChart3,
  Share2,
  Footprints,
  DollarSign,
  Wallet,
  FileCheck,
  HardHat,
  ClipboardCheck,
  FileWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_LABELS, EXECUTION_PHASE_CONFIG } from "@/lib/types";
import type { DealStatus, ExecutionPhase } from "@/lib/types";
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
  execution_phase: ExecutionPhase | null;
}

type NavGroup = {
  label: string | null;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
};

const BASE_NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Analysis",
    items: [
      { href: "/om-analysis", label: "OM Analysis", icon: FileSearch },
      { href: "/site-zoning", label: "Site & Zoning", icon: MapPin },
      { href: "/underwriting", label: "Underwriting", icon: Calculator },
      { href: "/comps", label: "Comps & Market", icon: BarChart3 },
    ],
  },
  {
    label: "Files",
    items: [
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/photos", label: "Photos", icon: Camera },
    ],
  },
  {
    label: "Execution",
    items: [
      { href: "/checklist", label: "Checklist", icon: CheckSquare },
      { href: "/project", label: "Project", icon: ClipboardList },
      { href: "/site-walk", label: "Site Walk", icon: Footprints },
      { href: "/loi", label: "LOI", icon: FileSignature },
      { href: "/dd-abstract", label: "DD Abstract", icon: ScrollText },
      { href: "/investment-package", label: "Inv. Package", icon: Presentation },
      { href: "/room", label: "Deal Room", icon: Share2 },
    ],
  },
  {
    label: "Activity",
    items: [
      { href: "/chat", label: "Chat", icon: MessageSquare },
      { href: "/communication", label: "Communication", icon: Mailbox },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/deal-log", label: "Deal Log", icon: Activity },
    ],
  },
];

const CONSTRUCTION_NAV_GROUP: NavGroup = {
  label: "Construction",
  items: [
    { href: "/construction", label: "Dashboard", icon: HardHat },
    { href: "/construction/budget", label: "Hard Costs", icon: DollarSign },
    { href: "/construction/draws", label: "Draws", icon: Wallet },
    { href: "/construction/permits", label: "Permits", icon: FileCheck },
    { href: "/construction/vendors", label: "Vendors", icon: Users },
    { href: "/construction/reports", label: "Reports", icon: ClipboardCheck },
    { href: "/construction/change-orders", label: "Change Orders", icon: FileWarning },
  ],
};

function getNavGroups(executionPhase: ExecutionPhase | null): NavGroup[] {
  if (!executionPhase) return BASE_NAV_GROUPS;
  // Insert Construction group after Execution (index 3)
  const groups = [...BASE_NAV_GROUPS];
  groups.splice(4, 0, CONSTRUCTION_NAV_GROUP);
  return groups;
}

const STATUS_COLORS: Record<string, string> = {
  sourcing: "bg-zinc-500/20 text-zinc-300",
  screening: "bg-blue-500/20 text-blue-300",
  loi: "bg-amber-500/20 text-amber-300",
  under_contract: "bg-orange-500/20 text-orange-300",
  diligence: "bg-primary/20 text-primary",
  closing: "bg-emerald-500/20 text-emerald-300",
  closed: "bg-emerald-500/20 text-emerald-300",
  dead: "bg-red-500/20 text-red-300",
  // Execution phases
  preconstruction: "bg-blue-500/20 text-blue-300",
  construction: "bg-amber-500/20 text-amber-300",
  punch_list: "bg-orange-500/20 text-orange-300",
  lease_up: "bg-purple-500/20 text-purple-300",
  stabilization: "bg-emerald-500/20 text-emerald-300",
};

export default function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const { can, isAdmin } = usePermissions();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const { userId } = useAuth();

  useEffect(() => {
    const stored = localStorage.getItem("dealSidebarCollapsed");
    if (stored !== null) setSidebarCollapsed(stored === "1");
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dealSidebarCollapsed", next ? "1" : "0");
      return next;
    });
  };

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
        <div className="px-4 sm:px-6">
          <div className="flex items-center gap-3 h-12">
            <button
              onClick={toggleSidebar}
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
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
                {deal.execution_phase && (
                  <span
                    className={cn(
                      "text-2xs px-2 py-0.5 rounded-full font-medium flex-shrink-0",
                      EXECUTION_PHASE_CONFIG[deal.execution_phase]?.color ?? "bg-muted text-muted-foreground"
                    )}
                  >
                    {EXECUTION_PHASE_CONFIG[deal.execution_phase]?.label ?? deal.execution_phase}
                  </span>
                )}
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

      </header>

      <div className="flex-1 flex min-h-0">
        {/* ── Sidebar nav ── */}
        <aside
          className={cn(
            "sticky top-12 self-start h-[calc(100vh-3rem)] border-r border-border/40 bg-card/40 backdrop-blur-xl transition-all duration-200 flex-shrink-0 overflow-y-auto scrollbar-none",
            sidebarCollapsed ? "w-14" : "w-56"
          )}
        >
          <nav className="py-3 px-2 flex flex-col gap-4 min-h-full">
            {getNavGroups(deal?.execution_phase ?? null).map((group, gi) => (
              <div key={gi} className="flex flex-col gap-0.5">
                {group.label && !sidebarCollapsed && (
                  <div className="px-2 pb-1 text-2xs uppercase tracking-wider text-muted-foreground/60 font-medium">
                    {group.label}
                  </div>
                )}
                {group.label && sidebarCollapsed && gi > 0 && (
                  <div className="mx-2 mb-1 border-t border-border/30" />
                )}
                {group.items.map((item) => {
                  const fullPath = `${basePath}${item.href}`;
                  const isActive =
                    item.href === ""
                      ? pathname === basePath
                      : pathname.startsWith(fullPath);
                  const Icon = item.icon;

                  return (
                    <Link key={item.href} href={fullPath} title={sidebarCollapsed ? item.label : undefined}>
                      <button
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150",
                          sidebarCollapsed && "justify-center",
                          isActive
                            ? "gradient-gold text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {!sidebarCollapsed && (
                          <span className="truncate">{item.label}</span>
                        )}
                      </button>
                    </Link>
                  );
                })}
              </div>
            ))}

            {isAdmin && (
              <div className="mt-auto flex flex-col gap-0.5 pt-3 border-t border-border/30">
                <Link href="/admin" title={sidebarCollapsed ? "Admin" : undefined}>
                  <button
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150",
                      sidebarCollapsed && "justify-center",
                      pathname.startsWith("/admin")
                        ? "gradient-gold text-primary-foreground shadow-sm"
                        : "text-indigo-200/80 hover:text-indigo-100 hover:bg-indigo-500/10"
                    )}
                  >
                    <Shield className="h-4 w-4 flex-shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">Admin</span>}
                  </button>
                </Link>
              </div>
            )}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
