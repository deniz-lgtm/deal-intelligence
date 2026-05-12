"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  ClipboardSignature,
  Hammer,
  Handshake,
  ListChecks,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon: typeof Hammer;
}

const TABS: Tab[] = [
  { href: "/pre-construction/bids", label: "Bid Leveler", icon: Handshake },
  { href: "/pre-construction/value-engineering", label: "VE Log", icon: ListChecks },
  { href: "/pre-construction/constructability", label: "Constructability & GMP", icon: ClipboardSignature },
  { href: "/pre-construction/long-lead", label: "Long-Lead", icon: Truck },
  { href: "/pre-construction/buyout", label: "Buyout", icon: Hammer },
];

export default function PreConstructionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const params = useParams<{ id: string }>();
  const base = `/deals/${params.id}`;

  return (
    <div className="space-y-4">
      <nav
        aria-label="Pre-construction"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border/40 px-4 sm:-mx-6 sm:px-6"
      >
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const isActive = pathname.startsWith(href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={href}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
