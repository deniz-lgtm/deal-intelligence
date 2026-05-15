"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Home,
  Inbox,
  Kanban,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/usePermissions";

const INBOX_POLL_INTERVAL_MS = 60_000;

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  permission?: string;
  adminOnly?: boolean;
  comingSoon?: boolean;
  badgeKey?: "inbox";
}

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: "Command",
    items: [
      { href: "/", label: "Deal Pipeline", icon: Home },
      { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "inbox" },
    ],
  },
  {
    label: "Knowledge + Design",
    items: [
      { href: "/playbook", label: "Playbook", icon: BookOpen },
      { href: "/floor-plans", label: "Floor Plans", icon: LayoutDashboard },
      { href: "/comps-library", label: "Comps Library", icon: BarChart3 },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/contacts", label: "Contacts", icon: Users, permission: "contacts.access" },
      { href: "/business-plans", label: "Business Plans", icon: BookOpen },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, isAdmin } = usePermissions();
  const [collapsed, setCollapsed] = useState(false);
  const [inboxBadge, setInboxBadge] = useState<number>(0);

  useEffect(() => {
    const stored = localStorage.getItem("appShellCollapsed");
    if (stored !== null) setCollapsed(stored === "1");
  }, []);

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
        // Badge is best effort.
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
    if (item.permission && !can(item.permission)) return null;
    if (item.adminOnly && !isAdmin) return null;

    const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = item.icon;
    const badgeCount = item.badgeKey === "inbox" && inboxBadge > 0 ? inboxBadge : 0;

    const body = (
      <button
        className={cn(
          "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-all duration-150",
          collapsed && "justify-center",
          item.comingSoon && "cursor-not-allowed opacity-40",
          isActive && !item.comingSoon
            ? "gradient-gold text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
        disabled={item.comingSoon}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        {collapsed && badgeCount > 0 && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
        )}
        {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
        {!collapsed && badgeCount > 0 && (
          <span
            className={cn(
              "min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[9px] font-semibold",
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
    <div className="flex min-h-screen bg-background noise">
      <aside
        className={cn(
          "sticky top-0 z-30 h-screen flex-shrink-0 self-start overflow-y-auto border-r border-border/40 bg-card/40 backdrop-blur-xl transition-all duration-200 scrollbar-none",
          collapsed ? "w-14" : "w-56"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border/30 px-3">
          {!collapsed && (
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md gradient-gold">
                <Kanban className="h-3.5 w-3.5 text-primary-foreground" />
              </span>
              <span className="truncate font-nameplate text-base leading-none tracking-tight text-foreground">
                Deal Intel
              </span>
            </Link>
          )}
          <button
            onClick={toggle}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex flex-col gap-4 px-2 py-3">
          {NAV_GROUPS.map((group, index) => (
            <div key={group.label ?? index} className="flex flex-col gap-0.5">
              {group.label && !collapsed && (
                <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  {group.label}
                </div>
              )}
              {group.label && collapsed && index > 0 && (
                <div className="mx-2 mb-1 border-t border-border/30" />
              )}
              {group.items.map(renderNavItem)}
            </div>
          ))}

          {isAdmin && (
            <div className="mt-auto flex flex-col gap-0.5 border-t border-border/30 pt-3">
              <Link href="/admin" className="flex">
                <button
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-all duration-150",
                    collapsed && "justify-center",
                    pathname.startsWith("/admin")
                      ? "gradient-gold text-primary-foreground shadow-sm"
                      : "text-indigo-200/80 hover:bg-indigo-500/10 hover:text-indigo-100"
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

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
