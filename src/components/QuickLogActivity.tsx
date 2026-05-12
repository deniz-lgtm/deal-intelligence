"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CONTACT_ACTIVITY_LABELS,
  type Contact,
  type ContactActivityKind,
} from "@/lib/types";
import { Button } from "@/components/ui/button";

const KINDS: ContactActivityKind[] = ["call", "email", "meeting", "note", "intro", "send"];

/**
 * Global "log activity" hotkey — ⌘L / Ctrl+L opens a popover from
 * anywhere. Pick a contact, pick a kind, type a one-liner, submit.
 * Logs to /api/contacts/[id]/activities which also bumps the contact's
 * last_touched_at. Closes on success.
 */
export function QuickLogActivity() {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Contact | null>(null);
  const [kind, setKind] = useState<ContactActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      // Skip if user is typing in an input — except when explicitly
      // pressing ⌘L (the mod key suppresses normal text input).
      if (isMod && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((j) => Array.isArray(j?.data) && setContacts(j.data))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setPicked(null);
      setSubject("");
      setKind("note");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = q.trim()
    ? contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6)
    : [];

  const submit = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${picked.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          subject: subject.trim() || null,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to log activity");
        return;
      }
      toast.success(`Logged ${CONTACT_ACTIVITY_LABELS[kind]} · ${picked.name}`);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close quick log"
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="fixed left-1/2 top-[20vh] z-50 w-[min(520px,92vw)] -translate-x-1/2 rounded-xl border border-border/60 bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-primary">
            Log activity · ⌘L
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!picked ? (
          <div>
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a contact…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            <ul className="mt-2 max-h-[40vh] overflow-y-auto">
              {filtered.length === 0 && q.trim() && (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No contacts match.
                </li>
              )}
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="truncate text-foreground/90">{c.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {[c.company, c.role].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm">
              <span className="font-medium">{picked.name}</span>
              {picked.company && (
                <span className="ml-2 text-xs text-muted-foreground">{picked.company}</span>
              )}
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="ml-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                change
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    k === kind
                      ? "border-primary/55 bg-primary/15 text-primary"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {CONTACT_ACTIVITY_LABELS[k]}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What happened? (optional)"
              maxLength={200}
              className="w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
            />
            <div className="flex justify-end">
              <Button size="sm" disabled={saving} onClick={submit}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Log
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
