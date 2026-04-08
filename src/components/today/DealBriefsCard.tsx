"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Briefcase, Loader2 } from "lucide-react";

interface DealBrief {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  asking_price: number | null;
  om_score: number | null;
  uw_score: number | null;
  updated_at: string;
  next_task: {
    title: string;
    due_date: string | null;
    priority: string | null;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  sourcing: "bg-zinc-500/20 text-zinc-300",
  screening: "bg-blue-500/20 text-blue-300",
  loi: "bg-amber-500/20 text-amber-300",
  under_contract: "bg-orange-500/20 text-orange-300",
  diligence: "bg-primary/20 text-primary",
  closing: "bg-emerald-500/20 text-emerald-300",
};

const STATUS_LABELS: Record<string, string> = {
  sourcing: "Sourcing",
  screening: "Screening",
  loi: "LOI",
  under_contract: "Under Contract",
  diligence: "Diligence",
  closing: "Closing",
};

export function DealBriefsCard() {
  const [briefs, setBriefs] = useState<DealBrief[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/workspace/deal-briefs?limit=5")
      .then((r) => r.json())
      .then((j) => setBriefs(j.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="border border-border/40 rounded-lg bg-card/60 backdrop-blur-sm p-3 min-h-[180px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Briefcase className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Active Deals</span>
        </div>
        {briefs.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Top {briefs.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : briefs.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-6 text-center">
          No active deals. Create one to see it here.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {briefs.map((b) => (
            <li key={b.id}>
              <Link
                href={`/deals/${b.id}`}
                className="block text-[11px] hover:bg-muted/30 -mx-1 px-1 py-1 rounded transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground truncate font-medium">
                      {b.name}
                    </div>
                    <div className="text-muted-foreground text-[10px] truncate">
                      {[b.city, b.state].filter(Boolean).join(", ") || "—"}
                      {b.next_task && (
                        <>
                          {" · "}
                          <span className="text-muted-foreground/80">
                            Next: {b.next_task.title}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      STATUS_COLORS[b.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {STATUS_LABELS[b.status] ?? b.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
