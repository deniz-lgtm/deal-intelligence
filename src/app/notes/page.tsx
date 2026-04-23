"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Notes hub. A workspace-wide repository of every deal_note across every
// deal the user can access. Three affordances:
//   - Search box filters text.
//   - Category chips filter by context / thesis / risk / review / site_walk.
//   - Deal dropdown scopes to a single deal (or ?deal=<id> in the URL —
//     the deal-overview page links straight to a scoped view so analysts
//     coming from a specific deal still see its notes by default).
//
// Each note card click-throughs to the parent deal. Most-recent first.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Search,
  StickyNote,
  Brain,
  Users,
  Lightbulb,
  AlertTriangle,
  Footprints,
  Loader2,
  ExternalLink,
  X,
} from "lucide-react";
import { DEAL_NOTE_CATEGORIES, type DealNoteCategory } from "@/lib/types";

const CATEGORY_STYLES: Record<DealNoteCategory, { icon: typeof Brain; color: string; bg: string }> = {
  context: { icon: Brain, color: "text-primary", bg: "bg-primary/10" },
  thesis: { icon: Lightbulb, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  risk: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-400/10" },
  review: { icon: Users, color: "text-amber-400", bg: "bg-amber-500/10" },
  site_walk: { icon: Footprints, color: "text-teal-400", bg: "bg-teal-400/10" },
};

interface NoteRow {
  id: string;
  deal_id: string;
  deal_name: string;
  text: string;
  category: string;
  source: string;
  created_at: string;
}

export default function NotesPage() {
  const search = useSearchParams();
  const initialDeal = search.get("deal") || "";

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<DealNoteCategory | "all">("all");
  const [dealFilter, setDealFilter] = useState<string>(initialDeal);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Always fetch the full accessible set; filters run client-side so
        // the dropdown can list every deal the user has touched without a
        // separate /api/deals call. Server caps at 1000 rows which is
        // plenty for single-user workspaces and shared instances alike.
        const res = await fetch(`/api/notes`);
        const j = await res.json();
        if (!cancelled && Array.isArray(j.data)) setNotes(j.data);
      } catch (e) {
        console.error("Failed to load notes:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Unique deals from the result set for the dropdown.
  const deals = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of notes) if (!seen.has(n.deal_id)) seen.set(n.deal_id, n.deal_name);
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [notes]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return notes.filter((n) => {
      if (dealFilter && n.deal_id !== dealFilter) return false;
      if (categoryFilter !== "all" && n.category !== categoryFilter) return false;
      if (qLower && !n.text.toLowerCase().includes(qLower) && !n.deal_name.toLowerCase().includes(qLower)) return false;
      return true;
    });
  }, [notes, q, categoryFilter, dealFilter]);

  // Group by deal for readability when no deal filter is applied.
  const grouped = useMemo(() => {
    if (dealFilter) return [{ deal_id: dealFilter, deal_name: deals.find((d) => d.id === dealFilter)?.name || "", notes: filtered }];
    const by = new Map<string, { deal_id: string; deal_name: string; notes: NoteRow[] }>();
    for (const n of filtered) {
      const cur = by.get(n.deal_id) || { deal_id: n.deal_id, deal_name: n.deal_name, notes: [] as NoteRow[] };
      cur.notes.push(n);
      by.set(n.deal_id, cur);
    }
    return Array.from(by.values()).sort((a, b) => a.deal_name.localeCompare(b.deal_name));
  }, [filtered, deals, dealFilter]);

  const activeDealName = dealFilter ? deals.find((d) => d.id === dealFilter)?.name : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
              <ArrowLeft className="h-3 w-3" />
              Dashboard
            </Link>
            <h1 className="font-nameplate text-3xl leading-none tracking-tight flex items-center gap-2.5">
              <StickyNote className="h-5 w-5 text-primary" strokeWidth={1.5} />
              Notes
              {activeDealName && (
                <span className="text-base text-muted-foreground font-normal">
                  / {activeDealName}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {filtered.length} of {notes.length} notes
              {dealFilter ? ` on ${activeDealName}` : " across all deals"}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="space-y-3 mb-6">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search notes and deal names..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border/60 rounded-lg outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setCategoryFilter("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border/60 hover:bg-muted/40"
              }`}
            >
              All categories
            </button>
            {(Object.keys(DEAL_NOTE_CATEGORIES) as DealNoteCategory[]).map((cat) => {
              const style = CATEGORY_STYLES[cat];
              const cfg = DEAL_NOTE_CATEGORIES[cat];
              const active = categoryFilter === cat;
              const Icon = style.icon;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    active
                      ? `${style.bg} ${style.color} ring-1 ring-inset ring-current/30`
                      : "bg-card border border-border/60 hover:bg-muted/40"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {deals.length > 1 && (
            <div className="flex items-center gap-2">
              <select
                value={dealFilter}
                onChange={(e) => setDealFilter(e.target.value)}
                className="text-xs border border-border/60 rounded-md px-2.5 py-1.5 bg-card outline-none"
              >
                <option value="">All deals ({deals.length})</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {dealFilter && (
                <button
                  onClick={() => setDealFilter("")}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear deal filter
                </button>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border/40 rounded-xl">
            <StickyNote className="h-7 w-7 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">
              {notes.length === 0 ? "No notes yet across any of your deals." : "No notes match the current filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.deal_id} className="border border-border/60 rounded-xl bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/40 bg-muted/10 flex items-center justify-between">
                  <Link
                    href={`/deals/${group.deal_id}`}
                    className="text-sm font-semibold text-foreground hover:text-primary inline-flex items-center gap-1.5"
                  >
                    {group.deal_name}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <span className="text-[11px] text-muted-foreground">
                    {group.notes.length} {group.notes.length === 1 ? "note" : "notes"}
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {group.notes.map((note) => {
                    const cat = note.category as DealNoteCategory;
                    const style = CATEGORY_STYLES[cat] || CATEGORY_STYLES.context;
                    const cfg = DEAL_NOTE_CATEGORIES[cat] || DEAL_NOTE_CATEGORIES.context;
                    const Icon = style.icon;
                    return (
                      <div key={note.id} className="px-4 py-3 flex items-start gap-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${style.bg} ${style.color}`}
                        >
                          <Icon className="h-2.5 w-2.5" />
                          {cfg.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm whitespace-pre-wrap break-words">{note.text}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {note.source === "chat" ? "via chat" : note.source === "ai" ? "AI generated" : "manual"}
                            {" · "}
                            {new Date(note.created_at).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
