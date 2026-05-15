"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  LayoutDashboard,
  Star,
  Calculator,
  ScrollText,
  FileSearch,
  Activity,
  Presentation,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Mailbox,
  Users,
  BarChart3,
  Share2,
  DollarSign,
  Wallet,
  FileCheck,
  HardHat,
  ClipboardCheck,
  FileWarning,
  Layers,
  Globe,
  FolderArchive,
  ChevronDown,
  ChevronRight,
  Flag,
  GanttChart,
  CalendarDays,
  PencilRuler,
  Stamp,
  Leaf,
  Handshake,
  FileQuestion,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_LABELS, EXECUTION_PHASE_CONFIG } from "@/lib/types";
import type { DealStatus, DealScope, ExecutionPhase } from "@/lib/types";
import { useAuth } from "@clerk/nextjs";
import ShareDealDialog from "@/components/ShareDealDialog";
import { deriveDealStage, isStageAllowed } from "@/lib/deal-stage";
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
  show_in_development: boolean;
  show_in_construction: boolean;
}

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Render a hairline divider beneath this item — used to break the
   *  Construction group into pre-con prep vs. operational items without
   *  splitting them into two collapsible groups. */
  dividerAfter?: boolean;
  /** Key the layout reads a live count from. Currently only `tasks` is
   *  wired — surfaces the number of open task-shaped rows on this deal
   *  as a small badge next to the sidebar item. */
  badgeKey?: "tasks";
};

type NavGroup = {
  label: string | null;
  items: NavItem[];
};

// Deal-level navigation is intentionally narrow. The app is moving back
// toward a personal deal assistant: review the material, underwrite the
// BOE, capture follow-ups, and draft the memo. Legacy project-management
// surfaces still exist behind "More tools" where needed.
const OVERVIEW_NAV_GROUP: NavGroup = {
  label: "Deal",
  items: [
    { href: "", label: "Workspace", icon: LayoutDashboard },
    { href: "/chat", label: "Assistant", icon: MessageSquare },
    { href: "/tasks", label: "Follow-ups", icon: ClipboardList, badgeKey: "tasks" },
  ],
};

const ANALYSIS_NAV_GROUP: NavGroup = {
  label: "Analyze",
  items: [
    { href: "/underwriting", label: "BOE", icon: Calculator },
    { href: "/site", label: "Site Review", icon: FileSearch },
    { href: "/comps", label: "Comps", icon: BarChart3 },
  ],
};

const SCHEDULE_BASE_ITEMS: NavItem[] = [
  { href: "/schedule", label: "Master Schedule", icon: Flag },
];

// Development Schedule sub-tabs (Design / Entitlements / CEQA / Procurement)
// move inside the Development Schedule page itself rather than living on
// the sidebar. Keeps the sidebar quiet for analysts who don't context-switch
// between those four sub-views every click.
const DEVELOPMENT_SCHEDULE_ITEMS: NavItem[] = [
  { href: "/project", label: "Development Schedule", icon: GanttChart },
];

// Docs collapses the prior six-item Docs & Outputs group into three:
// Documents (raw files), Outputs (a hub for OM / Diligence Summary / IC /
// Output Library / Share Room), and Photos (kept top-level because it's
// part of the daily walking-the-site flow).
const DOCS_NAV_GROUP: NavGroup = {
  label: "Materials",
  items: [
    { href: "/documents", label: "Documents", icon: FileText },
    { href: "/investment-package", label: "Memo", icon: Presentation },
  ],
};

const ADVANCED_NAV_GROUP: NavGroup = {
  label: "Advanced",
  items: [
    { href: "/schedule", label: "Schedule", icon: Flag },
    { href: "/contacts", label: "Contacts", icon: Users },
  ],
};

// Construction collapses the prior 11-item operational group down to
// five: Pre-Construction, Dashboard, Schedule, Closeout, Reports. The
// Hard Costs / Draws / Permits / Vendors / Change Orders / RFIs pages
// stay reachable from the Construction Dashboard's Quick Links card —
// they're per-section deep dives that don't need to live in the daily
// sidebar.
const EXECUTION_NAV_GROUP: NavGroup = {
  label: "Execution",
  items: [
    { href: "/pre-construction/bids", label: "Pre-Construction", icon: Handshake, dividerAfter: true },
    { href: "/construction", label: "Dashboard", icon: HardHat },
    { href: "/construction/schedule", label: "Construction Schedule", icon: CalendarDays },
    { href: "/construction/closeout", label: "Closeout", icon: ClipboardCheck },
    { href: "/construction/reports", label: "Reports", icon: ClipboardList },
  ],
};

const NAV_GROUP_ORDER = new Map<string, number>([
  ["Deal", 1],
  ["Analyze", 2],
  ["Materials", 3],
  ["Advanced", 4],
  ["Execution", 5],
]);

// Massing-aware routes read the active project from `?massing=<id>`.
// The sidebar preserves the param when navigating between them so an
// analyst working on "Massing 2" doesn't bounce back to the base case
// every time they click over to the diligence summary or IC package.
// Site & Zoning no longer has massing tabs (the map moved to Programming).
const MASSING_AWARE_HREFS = new Set([
  "/underwriting",
  "/programming",
  "/site",
  "/dd-abstract",
  "/investment-package",
  "/outputs",
  "/reports",
]);

// These are the deal's daily operating surfaces. They should stay one
// click away regardless of stage; the stage model curates the rest of
// the sidebar around the current workflow.
const ALWAYS_VISIBLE_HREFS = new Set([
  "",
  "/tasks",
  "/chat",
  "/underwriting",
  "/site",
  "/schedule",
  "/documents",
  "/outputs",
]);


function applyScopeGating(
  groups: NavGroup[],
  dealScope: DealScope | null,
  showInDevelopment: boolean
): NavGroup[] {
  // If the owner has explicitly opted the deal into Development, the Dev
  // items become first-class even on an acquisition-scope deal — clicking
  // the Dev badge is the signal that the dev team is now involved.
  if (dealScope !== "acquisition" || showInDevelopment) return groups;
  return groups.map((group) => {
    if (group.label !== "Schedule") return group;
    return {
      ...group,
      items: group.items.filter((item) => !item.href.startsWith("/project")),
    };
  });
}

function getNavGroups(
  executionPhase: ExecutionPhase | null,
  dealScope: DealScope | null,
  showInDevelopment: boolean,
  showInConstruction: boolean,
  forceDevelopmentSchedule = false,
  forceExecutionGroup = false
): NavGroup[] {
  // Construction now contains both pre-con prep and operational items.
  // We show it as soon as any of these signal that the construction track
  // is relevant: a set execution phase, explicit pin to construction or
  // development, or a non-acquisition deal scope. This is the union of
  // the old construction + pre-con conditions — pre-con tools become
  // visible exactly when they used to, just inside the Construction
  // collapsible.
  const showConstructionGroup =
    executionPhase != null ||
    showInConstruction ||
    showInDevelopment ||
    dealScope !== "acquisition" ||
    forceExecutionGroup;
  const showDevelopmentSchedule =
    dealScope !== "acquisition" || showInDevelopment || forceDevelopmentSchedule;
  const scheduleGroup: NavGroup = {
    label: "Schedule",
    items: [
      ...SCHEDULE_BASE_ITEMS,
      ...(showDevelopmentSchedule ? DEVELOPMENT_SCHEDULE_ITEMS : []),
    ],
  };
  const base: NavGroup[] = [
    OVERVIEW_NAV_GROUP,
    ANALYSIS_NAV_GROUP,
    DOCS_NAV_GROUP,
    ADVANCED_NAV_GROUP,
  ];
  if (showAllExecutionTools(showConstructionGroup, forceExecutionGroup)) {
    base.push(EXECUTION_NAV_GROUP);
  }
  return applyScopeGating(base, dealScope, showInDevelopment).sort((a, b) => {
    const aOrder = a.label ? NAV_GROUP_ORDER.get(a.label) ?? 99 : 0;
    const bOrder = b.label ? NAV_GROUP_ORDER.get(b.label) ?? 99 : 0;
    return aOrder - bOrder;
  });
}

function showAllExecutionTools(showConstructionGroup: boolean, forceExecutionGroup: boolean) {
  // Construction pages are still available, but they should not dominate
  // a front-end deal review unless the user is already inside that flow.
  return showConstructionGroup && forceExecutionGroup;
}

// Hub-page parents recognise their sub-routes as "active" too. Without
// this, navigating from /deals/[id]/site to /deals/[id]/site-zoning would
// drop the highlight in the sidebar.
const HUB_ROUTE_MAP: Record<string, string[]> = {
  "/site": ["/programming", "/site-zoning", "/location", "/site-walk", "/photos"],
  "/outputs": ["/om-analysis", "/dd-abstract", "/investment-package", "/reports", "/room"],
};

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
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Commit an edited deal name. Optimistically updates the local deal
  // so the header reflects the change instantly; reverts on PATCH
  // failure. Trim + collapse whitespace so analysts can't accidentally
  // save a trailing-space name they can't see.
  const commitName = async () => {
    if (!deal) return;
    const trimmed = nameDraft.trim().replace(/\s+/g, " ");
    if (!trimmed || trimmed === deal.name) {
      setEditingName(false);
      return;
    }
    const prev = deal.name;
    setDeal({ ...deal, name: trimmed });
    setEditingName(false);
    setSavingName(true);
    try {
      const res = await fetch(`/api/deals/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Rename failed");
    } catch (err) {
      console.error(err);
      setDeal((d) => (d ? { ...d, name: prev } : d));
    } finally {
      setSavingName(false);
    }
  };
  // Mobile: the sidebar is hidden off-screen by default and slid in as an
  // overlay drawer when `mobileSidebarOpen` is true. The same header
  // toggle drives both desktop collapse and mobile open/close.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Per-group collapse state keyed by group label. Everything starts open
  // so a deal page does not feel like a set of hidden drawers.
  const [navGroupsCollapsed, setNavGroupsCollapsed] = useState<Record<string, boolean>>({});
  // When false, sidebar items are curated around the current stage's
  // allowlist (defined in lib/deal-stage), while the core deal tools
  // remain visible. Toggle to true to reveal the entire deal navigation.
  // Persisted to localStorage.
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeMassingId = searchParams?.get("massing") || null;
  const { userId } = useAuth();

  useEffect(() => {
    const stored = localStorage.getItem("dealSidebarCollapsed");
    if (stored !== null) setSidebarCollapsed(stored === "1");
    const storedGroups = localStorage.getItem("dealNavGroupsCollapsed.v2");
    if (storedGroups) {
      try {
        const parsed = JSON.parse(storedGroups) as Record<string, boolean>;
        setNavGroupsCollapsed((prev) => ({ ...prev, ...parsed }));
      } catch {}
    }
    if (localStorage.getItem("dealShowAllRoutes") === "1") setShowAllRoutes(true);
  }, []);

  const toggleShowAll = () => {
    setShowAllRoutes((prev) => {
      const next = !prev;
      localStorage.setItem("dealShowAllRoutes", next ? "1" : "0");
      return next;
    });
  };

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
      localStorage.setItem("dealNavGroupsCollapsed.v2", JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    fetch(`/api/deals/${params.id}`)
      .then((r) => r.json())
      .then((j) => setDeal(j.data))
      .catch(console.error);
  }, [params.id]);

  // Live count of open task-shaped rows on this deal — surfaced as a
  // badge on the Tasks sidebar item. Refreshes whenever the user
  // navigates within the deal so creates/completes elsewhere reflect.
  const [openTaskCount, setOpenTaskCount] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${params.id}/unified-tasks?kind=task,diligence,decision,general`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !Array.isArray(j?.data)) return;
        setOpenTaskCount(
          (j.data as { status: string }[]).filter((t) => t.status !== "complete").length,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [params.id, pathname]);

  const basePath = `/deals/${params.id}`;
  const currentStage = deriveDealStage(deal?.status, deal?.execution_phase);

  const isActiveHref = (href: string) => {
    const fullPath = `${basePath}${href}`;
    if (href === "") return pathname === basePath;
    if (pathname.startsWith(fullPath)) return true;
    // Hub parents (Site, Outputs) light up when any of their member
    // routes are active.
    const members = HUB_ROUTE_MAP[href];
    if (members) {
      return members.some((m) => pathname.startsWith(`${basePath}${m}`));
    }
    return false;
  };

  // Stage filter: keep core tools, the active deep-linked route, and
  // the current stage's recommended routes. Groups whose items all get
  // filtered out are dropped so empty headers don't render. The user can
  // toggle "More tools" to restore the full list.
  const filterByStage = (groups: ReturnType<typeof getNavGroups>) => {
    if (showAllRoutes) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            ALWAYS_VISIBLE_HREFS.has(item.href) ||
            isStageAllowed(currentStage, item.href) ||
            isActiveHref(item.href)
        ),
      }))
      .filter((group) => group.items.length > 0);
  };
  const forceDevelopmentSchedule = pathname.startsWith(`${basePath}/project`);
  const forceExecutionGroup =
    pathname.startsWith(`${basePath}/construction`) ||
    pathname.startsWith(`${basePath}/pre-construction`);

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
                {editingName ? (
                  <input
                    type="text"
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingName(false);
                      }
                    }}
                    className="font-display text-sm text-foreground bg-transparent outline-none border-b border-primary/40 focus:border-primary min-w-[120px] max-w-xs"
                    disabled={savingName}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNameDraft(deal.name); setEditingName(true); }}
                    title="Click to rename"
                    className="font-display text-sm text-foreground truncate max-w-[140px] sm:max-w-xs text-left hover:text-primary transition-colors cursor-text"
                  >
                    {deal.name}
                  </button>
                )}
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
            {filterByStage(
              getNavGroups(
                deal?.execution_phase ?? null,
                deal?.deal_scope ?? null,
                deal?.show_in_development ?? false,
                deal?.show_in_construction ?? false,
                forceDevelopmentSchedule,
                forceExecutionGroup,
              )
            ).map((group, gi) => {
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
                      "w-full flex items-center gap-1 px-2 pb-1 text-2xs uppercase tracking-wider font-medium text-left",
                      // Phase groups pick up their accent tint (same
                      // mechanism used by AppShell); all other labels
                      // stay on the neutral muted scale.
                      group.label === "Deal" && "text-primary/80 hover:text-primary",
                      group.label === "Analyze" && "text-[hsl(var(--phase-acq))]/80 hover:text-[hsl(var(--phase-acq))]",
                      group.label === "Schedule" && "text-[hsl(var(--phase-dev))]/80 hover:text-[hsl(var(--phase-dev))]",
                      group.label === "Execution" && "text-[hsl(var(--phase-con))]/80 hover:text-[hsl(var(--phase-con))]",
                      !["Deal", "Analyze", "Schedule", "Execution"].includes(group.label) &&
                        "text-muted-foreground/60 hover:text-muted-foreground",
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
                  const baseHref = `${basePath}${item.href}`;
                  const fullPath = activeMassingId && MASSING_AWARE_HREFS.has(item.href)
                    ? `${baseHref}?massing=${encodeURIComponent(activeMassingId)}`
                    : baseHref;
                  const isActive = isActiveHref(item.href);
                  const Icon = item.icon;

                  const linkTitle = sidebarCollapsed ? item.label : undefined;

                  const badgeCount = item.badgeKey === "tasks" ? openTaskCount : 0;
                  return (
                    <div key={item.href}>
                      <Link href={fullPath} title={linkTitle}>
                        <button
                          className={cn(
                            "relative w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150",
                            // Center icons only on desktop-collapsed; mobile
                            // drawer is always w-56 so labels stay inline.
                            sidebarCollapsed && "md:justify-center",
                            isActive
                              ? "gradient-gold text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          {sidebarCollapsed && badgeCount > 0 && (
                            <span className="absolute right-1 top-1 hidden h-1.5 w-1.5 rounded-full bg-primary md:block" />
                          )}
                          <span className={cn("truncate flex-1 text-left", sidebarCollapsed && "md:hidden")}>
                            {item.label}
                          </span>
                          {!sidebarCollapsed && badgeCount > 0 && (
                            <span
                              className={cn(
                                "min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[9px] font-semibold",
                                isActive
                                  ? "bg-primary-foreground/20 text-primary-foreground"
                                  : "bg-primary/20 text-primary",
                              )}
                            >
                              {badgeCount > 99 ? "99+" : badgeCount}
                            </span>
                          )}
                        </button>
                      </Link>
                      {item.dividerAfter && (
                        <div className="mx-2 my-1 border-t border-border/30" />
                      )}
                    </div>
                  );
                })}
              </div>
              );
            })}

            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={toggleShowAll}
                className={cn(
                  "mx-2 mt-2 rounded-md border border-dashed border-border/50 px-2 py-1.5 text-2xs font-medium uppercase tracking-wider transition-colors",
                  showAllRoutes
                    ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground/70 hover:border-border hover:text-foreground"
                )}
                title="Toggle full deal navigation"
              >
                {showAllRoutes ? "Focused tools" : "More tools"}
              </button>
            )}

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
