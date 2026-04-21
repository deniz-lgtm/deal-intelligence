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
  Layers,
  Globe,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_LABELS, EXECUTION_PHASE_CONFIG } from "@/lib/types";
import type { DealStatus, DealScope, ExecutionPhase } from "@/lib/types";
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
  deal_scope: DealScope | null;
}

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  muted?: boolean;
  mutedReason?: string;
};

type NavGroup = {
  label: string | null;
  items: NavItem[];
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
      { href: "/programming", label: "Programming", icon: Layers },
      { href: "/underwriting", label: "Underwriting", icon: Calculator },
      { href: "/comps", label: "Comps", icon: BarChart3 },
      { href: "/location", label: "Location Intel", icon: Globe },
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

// Acquisition deals don't add new SF, so Programming (unit mix / massing) and
// Site & Zoning (density bonuses / site plan drawing) are rarely needed. We
// keep the nav items clickable but de-emphasize them so users aren't funneled
// into ground-up workflows for a straight buy-and-operate deal.
const ACQUISITION_MUTED_HREFS = new Set(["/programming", "/site-zoning"]);
const MUTED_REASON_ACQUISITION = "Not typically used for acquisition deals.";

function applyScopeGating(groups: NavGroup[], dealScope: DealScope | null): NavGroup[] {
  if (dealScope !== "acquisition") return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      ACQUISITION_MUTED_HREFS.has(item.href)
        ? { ...item, muted: true, mutedReason: MUTED_REASON_ACQUISITION }
        : item
    ),
  }));
}

function getNavGroups(
  executionPhase: ExecutionPhase | null,
  dealScope: DealScope | null
): NavGroup[] {
  const base = executionPhase
    ? (() => {
        const groups = [...BASE_NAV_GROUPS];
        groups.splice(4, 0, CONSTRUCTION_NAV_GROUP);
        return groups;
      })()
    : BASE_NAV_GROUPS;
  return applyScopeGating(base, dealScope);
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
  // Mobile: the sidebar is hidden off-screen by default and slid in as an
  // overlay drawer when `mobileSidebarOpen` is true. The same header
  // toggle drives both desktop collapse and mobile open/close.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Per-group collapse state keyed by group label. Overview (no label) is
  // never collapsible. Defaults: Analysis open, everything else closed so
  // the sidebar reads as a lean nav with optional disclosure.
  const [navGroupsCollapsed, setNavGroupsCollapsed] = useState<Record<string, boolean>>({
    Files: true,
    Execution: true,
    Activity: true,
    Construction: true,
  });
  const pathname = usePathname();
  const { userId } = useAuth();

  useEffect(() => {
    const stored = localStorage.getItem("dealSidebarCollapsed");
    if (stored !== null) setSidebarCollapsed(stored === "1");
    const storedGroups = localStorage.getItem("dealNavGroupsCollapsed");
    if (storedGroups) {
      try { setNavGroupsCollapsed(JSON.parse(storedGroups)); } catch {}
    }
  }, []);

  const toggleSidebar = () => {
    // Below the `md` breakpoint (768px) we toggle the mobile drawer;
    // otherwise we toggle desktop collapse. Falling back to desktop
    // behavior on the server-side render is safe — this handler only
    // runs in response to a click.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSidebarOpen((prev) => !prev);
      return;
    }
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dealSidebarCollapsed", next ? "1" : "0");
      return next;
    });
  };

  // Close the mobile drawer on route changes so navigation feels snappy
  // and the backdrop doesn't linger after tapping a nav link.
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  const toggleNavGroup = (label: string) => {
    setNavGroupsCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      localStorage.setItem("dealNavGroupsCollapsed", JSON.stringify(next));
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
        {/* Mobile drawer backdrop — visible only when the drawer is open
            on a narrow viewport. Tapping it closes the drawer. */}
        {mobileSidebarOpen && (
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden fixed inset-0 top-12 z-30 bg-black/50 backdrop-blur-sm"
          />
        )}
        {/* ── Sidebar nav ──
            Desktop (md+): sticky in-flow column; width driven by
            sidebarCollapsed (w-14 vs w-56).
            Mobile (<md): fixed off-screen drawer, slid in by translate
            when mobileSidebarOpen. Width locked to w-56 on mobile so the
            labels are always readable when it's open. */}
        <aside
          className={cn(
            "border-r border-border/40 bg-card/40 backdrop-blur-xl overflow-y-auto scrollbar-none transition-transform duration-200",
            // Mobile drawer positioning
            "fixed left-0 top-12 bottom-0 z-40 w-56",
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
            // Desktop overrides: sticky in-flow, width from collapse state, no transform
            "md:sticky md:top-12 md:self-start md:h-[calc(100vh-3rem)] md:flex-shrink-0 md:translate-x-0 md:transition-all",
            sidebarCollapsed ? "md:w-14" : "md:w-56"
          )}
        >
          <nav className="py-3 px-2 flex flex-col gap-4 min-h-full">
            {getNavGroups(deal?.execution_phase ?? null, deal?.deal_scope ?? null).map((group, gi) => {
              // Groups with a label can be collapsed by the user. When the
              // whole sidebar is in icon-only mode we ignore per-group
              // collapse so all icons remain reachable — the compact mode
              // already hides labels anyway.
              const groupCollapsed = !!(group.label && !sidebarCollapsed && navGroupsCollapsed[group.label]);
              return (
              <div key={gi} className="flex flex-col gap-0.5">
                {/* Group label header — always rendered on mobile (drawer is
                    w-56 and needs the labels); hidden on desktop when the
                    sidebar is in icon-only collapsed mode. */}
                {group.label && (
                  <button
                    onClick={() => toggleNavGroup(group.label!)}
                    className={cn(
                      "w-full flex items-center gap-1 px-2 pb-1 text-2xs uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground font-medium text-left",
                      sidebarCollapsed && "md:hidden"
                    )}
                  >
                    {groupCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    <span>{group.label}</span>
                  </button>
                )}
                {/* Thin separator replaces the group label when the desktop
                    sidebar is collapsed (icon-only). Hidden on mobile since
                    the group label is always visible there. */}
                {group.label && sidebarCollapsed && gi > 0 && (
                  <div className="hidden md:block mx-2 mb-1 border-t border-border/30" />
                )}
                {!groupCollapsed && group.items.map((item) => {
                  const fullPath = `${basePath}${item.href}`;
                  const isActive =
                    item.href === ""
                      ? pathname === basePath
                      : pathname.startsWith(fullPath);
                  const Icon = item.icon;

                  const linkTitle = item.muted
                    ? `${item.label} — ${item.mutedReason ?? ""}`.trim()
                    : sidebarCollapsed
                    ? item.label
                    : undefined;

                  return (
                    <Link key={item.href} href={fullPath} title={linkTitle}>
                      <button
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150",
                          // Center icons only on desktop-collapsed; mobile
                          // drawer is always w-56 so labels stay inline.
                          sidebarCollapsed && "md:justify-center",
                          isActive
                            ? "gradient-gold text-primary-foreground shadow-sm"
                            : item.muted
                            ? "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className={cn("truncate", sidebarCollapsed && "md:hidden")}>
                          {item.label}
                        </span>
                      </button>
                    </Link>
                  );
                })}
              </div>
              );
            })}

            {isAdmin && (
              <div className="mt-auto flex flex-col gap-0.5 pt-3 border-t border-border/30">
                <Link href="/admin" title={sidebarCollapsed ? "Admin" : undefined}>
                  <button
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150",
                      sidebarCollapsed && "md:justify-center",
                      pathname.startsWith("/admin")
                        ? "gradient-gold text-primary-foreground shadow-sm"
                        : "text-indigo-200/80 hover:text-indigo-100 hover:bg-indigo-500/10"
                    )}
                  >
                    <Shield className="h-4 w-4 flex-shrink-0" />
                    <span className={cn("truncate", sidebarCollapsed && "md:hidden")}>Admin</span>
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
