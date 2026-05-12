"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Search as SearchIcon,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Contact, Deal } from "@/lib/types";

type Mode = "all" | "deals" | "contacts";

interface PaletteItem {
  kind: "deal" | "contact";
  id: string;
  label: string;
  hint: string;
  href: string;
}

/**
 * Global command palette mounted by AppShell. Opens on ⌘K / Ctrl+K
 * from anywhere in the app. Searches deals + contacts and routes on
 * Enter. Lightweight by design — fetches once on first open, filters
 * client-side from there.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("all");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedRef = useRef(false);

  // Keyboard handler — global open shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Fetch lazily on first open.
  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    Promise.all([
      fetch("/api/deals").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("/api/contacts").then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([d, c]) => {
      if (Array.isArray(d?.data)) setDeals(d.data);
      if (Array.isArray(c?.data)) setContacts(c.data);
    });
  }, [open]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const lower = q.toLowerCase().trim();
    const out: PaletteItem[] = [];

    if (mode !== "contacts") {
      for (const d of deals) {
        const match =
          !lower ||
          d.name?.toLowerCase().includes(lower) ||
          d.address?.toLowerCase().includes(lower) ||
          d.city?.toLowerCase().includes(lower);
        if (!match) continue;
        out.push({
          kind: "deal",
          id: d.id,
          label: d.name,
          hint: [d.city, d.state].filter(Boolean).join(", ") || d.status,
          href: `/deals/${d.id}`,
        });
      }
    }
    if (mode !== "deals") {
      for (const c of contacts) {
        const match =
          !lower ||
          c.name?.toLowerCase().includes(lower) ||
          c.email?.toLowerCase().includes(lower) ||
          c.company?.toLowerCase().includes(lower);
        if (!match) continue;
        out.push({
          kind: "contact",
          id: c.id,
          label: c.name,
          hint: [c.company, c.role].filter(Boolean).join(" · "),
          href: `/contacts/${c.id}`,
        });
      }
    }
    return out.slice(0, 30);
  }, [q, mode, deals, contacts]);

  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(Math.max(0, items.length - 1));
  }, [items, activeIndex]);

  const navigate = (item?: PaletteItem) => {
    const target = item ?? items[activeIndex];
    if (!target) return;
    router.push(target.href);
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      navigate();
    }
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close command palette"
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="fixed left-1/2 top-[20vh] z-50 w-[min(680px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <SearchIcon className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Jump to a deal, contact, or page…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1 border-b border-border/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em]">
          {(["all", "deals", "contacts"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full px-2.5 py-1 transition-colors",
                m === mode
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <ul className="max-h-[55vh] overflow-y-auto p-1">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </li>
          ) : (
            items.map((item, i) => {
              const Icon = item.kind === "deal" ? Building2 : User;
              const active = i === activeIndex;
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => navigate(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
                      active ? "bg-primary/15 text-foreground" : "text-foreground/90 hover:bg-muted/40"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{item.label}</div>
                      {item.hint && (
                        <div className="truncate text-[11px] text-muted-foreground">{item.hint}</div>
                      )}
                    </div>
                    <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {item.kind}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="border-t border-border/40 bg-card/80 px-3 py-1.5 text-[10px] text-muted-foreground">
          ⌘K to toggle · ↑↓ navigate · ↵ open · esc close
        </div>
      </div>
    </>
  );
}
