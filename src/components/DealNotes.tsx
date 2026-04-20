"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2, Loader2, Brain, Users, Lightbulb, AlertTriangle, StickyNote, Footprints, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DealNote, DealNoteCategory } from "@/lib/types";
import { DEAL_NOTE_CATEGORIES } from "@/lib/types";

const CATEGORY_STYLES: Record<DealNoteCategory, { icon: typeof Brain; color: string; bg: string }> = {
  context: { icon: Brain, color: "text-primary", bg: "bg-primary/10" },
  thesis: { icon: Lightbulb, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  risk: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-400/10" },
  review: { icon: Users, color: "text-amber-400", bg: "bg-amber-500/10" },
  site_walk: { icon: Footprints, color: "text-teal-400", bg: "bg-teal-400/10" },
};

interface DealNotesProps {
  dealId: string;
  compact?: boolean;
  // When set, the list renders at most `preview` notes and appends a
  // "View all N notes" link to /notes?deal=<dealId>. The add-note form
  // still renders so analysts can drop a note inline from the overview
  // page. Omit or set to undefined for the full listing.
  preview?: number;
  onNotesChanged?: () => void;
}

export default function DealNotes({ dealId, compact, preview, onNotesChanged }: DealNotesProps) {
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<DealNoteCategory>("context");
  const [adding, setAdding] = useState(false);

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/notes`);
      const json = await res.json();
      if (json.data) setNotes(json.data);
    } catch (err) {
      console.error("Failed to load notes:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const addNote = async () => {
    const trimmed = newText.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, category: newCategory }),
      });
      if (!res.ok) {
        console.error("Failed to add note:", res.status, await res.text());
        return;
      }
      const json = await res.json();
      if (json.data) {
        setNotes(prev => [json.data, ...prev]);
        setNewText("");
        onNotesChanged?.();
      }
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setAdding(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    try {
      await fetch(`/api/deals/${dealId}/notes?noteId=${noteId}`, { method: "DELETE" });
      setNotes(prev => prev.filter(n => n.id !== noteId));
      onNotesChanged?.();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Add note form */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as DealNoteCategory)}
            className="text-xs border rounded-md px-2 py-1.5 bg-background shrink-0"
          >
            {(Object.keys(DEAL_NOTE_CATEGORIES) as DealNoteCategory[]).map(cat => {
              const cfg = DEAL_NOTE_CATEGORIES[cat];
              return (
                <option key={cat} value={cat}>
                  {cfg.label}{cfg.inMemory ? " ✦" : ""}
                </option>
              );
            })}
          </select>
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add a note..."
            className="flex-1 text-sm border rounded-md px-3 py-1.5 bg-background outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNote(); } }}
          />
          <Button variant="outline" size="sm" onClick={addNote} disabled={adding || !newText.trim()}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          ✦ = included in AI memory &amp; analysis
        </p>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="text-center py-4">
          <StickyNote className="h-5 w-5 mx-auto text-muted-foreground/30 mb-1.5" />
          <p className="text-xs text-muted-foreground">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(preview ? notes.slice(0, preview) : notes).map(note => {
            const cat = note.category as DealNoteCategory;
            const style = CATEGORY_STYLES[cat] || CATEGORY_STYLES.context;
            const cfg = DEAL_NOTE_CATEGORIES[cat] || DEAL_NOTE_CATEGORIES.context;
            const Icon = style.icon;
            return (
              <div key={note.id} className="flex items-start gap-2 group">
                <span className={`inline-flex items-center gap-1 text-[10px] mt-0.5 px-1.5 py-0.5 rounded font-medium shrink-0 ${style.bg} ${style.color}`}>
                  <Icon className="h-2.5 w-2.5" />
                  {cfg.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${compact || preview ? "line-clamp-2" : ""}`}>{note.text}</p>
                  {!compact && !preview && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {note.source === "chat" ? "via chat" : note.source === "ai" ? "AI generated" : ""}
                      {note.source !== "manual" && " · "}
                      {new Date(note.created_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteNote(note.id)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {preview && notes.length > preview && (
            <Link
              href={`/notes?deal=${dealId}`}
              className="flex items-center justify-between gap-2 text-xs text-primary hover:underline pt-1.5 border-t border-border/30 mt-1"
            >
              <span>View all {notes.length} notes for this deal</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
