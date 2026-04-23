"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Kanban,
  Inbox,
  BarChart3,
  BookOpen,
  Users,
  Shield,
  HardHat,
  PanelLeftClose,
  PanelLeftOpen,
  Compass,
  Building,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/usePermissions";

const INBOX_POLL_INTERVAL_MS = 60_000; // refresh inbox badge every minute

// Persistent left-rail shell for the workspace-level routes (/, /comps-library,
// /contacts, /business-plans, /admin, etc.). Keeps the main content area
// flexible — pages render their existing headers and bodies inside <children>.
//
// This replaces the previous "top-header-only" layout and unblocks adding
// new workspace-level features without cramming them into the per-deal
// sidebar or the root-page header button row.

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  permission?: string;
  adminOnly?: boolean;
  comingSoon?: boolean;
  badgeKey?: "inbox";
}

// Workspace-level entries sit above the three role departments so the
// shared tools (Contacts, Business Plans, Comps) are reachable with one
// glance, regardless of which role a user primarily operates in.
//
//   (unlabeled)   Home, Inbox, Contacts, Business Plans    — shared workspace
//   Acquisition   Pipeline, Comps Library                  — the hunt (gold)
//   Development   Projects                                 — shaping (verdigris)
//   Construction  Projects                                 — making (copper)
//
// Each phase group's label picks up its accent color in the render below so
// the sidebar reads as three clearly-owned workspaces. Sub-pages that don't
// have real portfolio routes yet are intentionally omitted — per-deal
// construction / development screens remain reachable from each deal's
// detail page, so leaving them out of the sidebar isn't a regression.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Home", icon: Home },
      { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "inbox" },
      { href: "/contacts", label: "Contacts", icon: Users, permission: "contacts.access" },
      { href: "/business-plans", label: "Business Plans", icon: BookOpen, permission: "business_plans.access" },
    ],
  },
  {
    label: "Acquisition",
    items: [
      { href: "/acquisition", label: "Pipeline", icon: Compass },
      { href: "/comps-library", label: "Comps Library", icon: BarChart3 },
    ],
  },
  {
    label: "Development",
    items: [
      { href: "/development", label: "Projects", icon: Building },
    ],
  },
  {
    label: "Construction",
    items: [
      { href: "/construction", label: "Projects", icon: HardHat },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, isAdmin } = usePermissions();
  const [collapsed, setCollapsed] = useState(false);
  const [inboxBadge, setInboxBadge] = useState<number>(0);

  // Persist collapse state across navigations.
  useEffect(() => {
    const stored = localStorage.getItem("appShellCollapsed");
    if (stored !== null) setCollapsed(stored === "1");
  }, []);

  // Poll the inbox badge count. Updates immediately on mount and then on
  // a timer so navigating around the app keeps the count fresh.
  useEffect(() => {
    let cancelled = false;
    const fetchBadge = async () => {
      try {
        const res = await fetch("/api/inbox/settings");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          setInboxBadge(Number(json.data?.pending_count ?? 0));
        }
      } catch {
        // silent — badge is best-effort
      }
    };
    fetchBadge();
    const timer = setInterval(fetchBadge, INBOX_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("appShellCollapsed", next ? "1" : "0");
      return next;
    });
  };

  const renderNavItem = (item: NavItem) => {
    // Visibility gating
    if (item.permission && !can(item.permission)) return null;
    if (item.adminOnly && !isAdmin) return null;

    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname.startsWith(item.href);
    const Icon = item.icon;

    // Resolve badge count for items that have a badgeKey
    const badgeCount =
      item.badgeKey === "inbox" && inboxBadge > 0 ? inboxBadge : 0;

    const body = (
      <button
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150 relative",
          collapsed && "justify-center",
          item.comingSoon && "opacity-40 cursor-not-allowed",
          isActive && !item.comingSoon
            ? "gradient-gold text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        disabled={item.comingSoon}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        {/* Collapsed-rail indicator dot for unread inbox */}
        {collapsed && badgeCount > 0 && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
        )}
        {!collapsed && (
          <span className="truncate flex-1 text-left">{item.label}</span>
        )}
        {!collapsed && badgeCount > 0 && (
          <span
            className={cn(
              "text-[9px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
              isActive
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-primary/20 text-primary"
            )}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
        {!collapsed && item.comingSoon && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
            Soon
          </span>
        )}
      </button>
    );

    // "Coming soon" items are not clickable
    if (item.comingSoon) {
      return (
        <div key={item.href} className="flex">
          {body}
        </div>
      );
    }
    return (
      <Link key={item.href} href={item.href} className="flex">
        {body}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background noise flex">
      {/* Left rail */}
      <aside
        className={cn(
          "sticky top-0 self-start h-screen border-r border-border/40 bg-card/40 backdrop-blur-xl transition-all duration-200 flex-shrink-0 z-30 overflow-y-auto scrollbar-none",
          collapsed ? "w-14" : "w-56"
        )}
      >
        <div className="flex items-center justify-between px-3 h-14 border-b border-border/30">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded-md gradient-gold flex items-center justify-center flex-shrink-0">
                <Kanban className="h-3.5 w-3.5 text-primary-foreground" />
              </span>
              <span className="font-nameplate text-base leading-none tracking-tight text-foreground truncate">
                Deal Intel
              </span>
            </Link>
          )}
          <button
            onClick={toggle}
            className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="py-3 px-2 flex flex-col gap-4">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="flex flex-col gap-0.5">
              {group.label && !collapsed && (
                <div
                  className={cn(
                    "px-2 pb-1 text-2xs uppercase tracking-[0.15em] font-medium",
                    group.label === "Acquisition" && "text-[hsl(var(--phase-acq))]",
                    group.label === "Development" && "text-[hsl(var(--phase-dev))]",
                    group.label === "Construction" && "text-[hsl(var(--phase-con))]",
                    !["Acquisition", "Development", "Construction"].includes(group.label) &&
                      "text-muted-foreground/60",
                  )}
                >
                  {group.label}
                </div>
              )}
              {group.label && collapsed && gi > 0 && (
                <div className="mx-2 mb-1 border-t border-border/30" />
              )}
              {group.items.map(renderNavItem)}
            </div>
          ))}

          {isAdmin && (
            <div className="mt-auto flex flex-col gap-0.5 pt-3 border-t border-border/30">
              <Link href="/admin" className="flex">
                <button
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-all duration-150",
                    collapsed && "justify-center",
                    pathname.startsWith("/admin")
                      ? "gradient-gold text-primary-foreground shadow-sm"
                      : "text-indigo-200/80 hover:text-indigo-100 hover:bg-indigo-500/10"
                  )}
                  title={collapsed ? "Admin" : undefined}
                >
                  <Shield className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && <span className="truncate">Admin</span>}
                </button>
              </Link>
            </div>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
