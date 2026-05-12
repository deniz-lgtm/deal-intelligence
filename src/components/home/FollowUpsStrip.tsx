"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/types";

/**
 * Contacts owed a follow-up today or earlier. Sits below the
 * DecisionsDueStrip on the Command Center.
 */
export function FollowUpsStrip() {
  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contacts/follow-ups")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && Array.isArray(j.data)) setRows(j.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || rows.length === 0) return null;

  const overdue = rows.filter((c) => c.next_action_at && new Date(c.next_action_at) < new Date()).length;

  return (
    <section className="border-b border-border/40 bg-card/30 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex shrink-0 items-center gap-2">
          <CalendarCheck2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Follow up
          </span>
          {overdue > 0 && (
            <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-500">
              {overdue} overdue
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {rows.slice(0, 8).map((c) => {
            const overdue = c.next_action_at && new Date(c.next_action_at) < new Date();
            return (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className={cn(
                  "inline-flex max-w-[260px] items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition hover:bg-background/60",
                  overdue
                    ? "border-rose-500/35 bg-rose-500/10 text-rose-500"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-500"
                )}
                title={c.next_action_note || c.name}
              >
                <span className="truncate font-medium text-foreground/90">{c.name}</span>
                {c.next_action_note && (
                  <span className="truncate opacity-80">· {c.next_action_note}</span>
                )}
              </Link>
            );
          })}
          {rows.length > 8 && (
            <Link
              href="/contacts"
              className="inline-flex items-center px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              +{rows.length - 8} more
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
