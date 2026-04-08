"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Plus, X, User, Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAKEHOLDER_LABELS } from "@/lib/types";
import type { Contact, StakeholderType } from "@/lib/types";

interface ContactPickerProps {
  /** Currently selected contact id */
  value: string | null | undefined;
  /** Display label for the currently picked contact (optional fallback when no contact loaded) */
  displayLabel?: string;
  /** Called when user picks a contact OR creates a new one. New contacts return their full row. */
  onChange: (contact: Contact | null) => void;
  /** Optional role to bias new-contact creation defaults */
  defaultRole?: StakeholderType;
  /** Placeholder text */
  placeholder?: string;
  /** Optional className wrapper */
  className?: string;
  /** If true, renders a smaller compact version */
  compact?: boolean;
}

/**
 * Reusable contact picker / typeahead. Searches /api/contacts as the user
 * types and lets them pick an existing contact or create a new one inline.
 */
export default function ContactPicker({
  value,
  displayLabel,
  onChange,
  defaultRole = "broker",
  placeholder = "Search contacts...",
  className,
  compact = false,
}: ContactPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<Contact | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch the picked contact's details when value changes externally
  useEffect(() => {
    if (!value) {
      setPicked(null);
      return;
    }
    if (picked?.id === value) return;
    fetch(`/api/contacts/${value}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setPicked(j.data))
      .catch(() => {});
  }, [value, picked?.id]);

  // Search debounce
  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = q ? `/api/contacts?q=${encodeURIComponent(q)}` : `/api/contacts`;
      const res = await fetch(url);
      const json = await res.json();
      setResults(json.data || []);
    } catch (err) {
      console.error("Failed to search contacts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(query), 150);
    return () => clearTimeout(t);
  }, [query, open, search]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handlePick = (contact: Contact) => {
    setPicked(contact);
    onChange(contact);
    setOpen(false);
    setQuery("");
  };

  const handleClear = () => {
    setPicked(null);
    onChange(null);
    setQuery("");
  };

  const handleCreate = async () => {
    if (!query.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: query.trim(),
          role: defaultRole,
        }),
      });
      const json = await res.json();
      if (json.data) {
        handlePick(json.data);
      }
    } catch (err) {
      console.error("Failed to create contact:", err);
    } finally {
      setCreating(false);
    }
  };

  const inputHeight = compact ? "h-8" : "h-9";

  // Show picked contact as a chip
  if (picked) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5",
          inputHeight,
          className
        )}
      >
        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
          <span className="text-sm font-medium truncate">{picked.name}</span>
          {picked.company && (
            <span className="text-xs text-muted-foreground truncate">@ {picked.company}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Clear contact"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Show fallback display label (legacy free-text data) with a link to upgrade
  if (displayLabel && !open) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-2.5",
          inputHeight,
          className
        )}
      >
        <span className="text-sm flex-1 truncate text-muted-foreground italic">
          {displayLabel}
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setQuery(displayLabel);
          }}
          className="text-xs text-primary hover:underline"
        >
          Link contact
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-background px-2.5",
          inputHeight
        )}
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {results.length > 0 ? (
            <div className="py-1">
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handlePick(c)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{c.name}</span>
                      <span className="text-2xs text-muted-foreground uppercase tracking-wider">
                        {STAKEHOLDER_LABELS[c.role]}
                      </span>
                    </div>
                    {(c.company || c.email) && (
                      <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        {c.company && (
                          <>
                            <Building2 className="h-3 w-3" />
                            {c.company}
                          </>
                        )}
                        {c.email && <span>· {c.email}</span>}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-3 text-sm text-muted-foreground text-center">
              {loading ? "Searching..." : "No matches"}
            </div>
          )}

          {query.trim() && (
            <div className="border-t border-border/40 p-1">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm text-primary disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                <span>
                  Create &quot;<strong>{query.trim()}</strong>&quot; as new {STAKEHOLDER_LABELS[defaultRole]}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
