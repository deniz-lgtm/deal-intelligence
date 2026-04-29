"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

/**
 * Inline-editable scalars used on the schedule gantt rows. These are
 * intentionally tiny — clickable spans that swap into native HTML
 * inputs while editing, save on Enter / blur, and revert on Escape.
 *
 * Pattern is consistent across the field-type components so the row
 * layout stays compact: same height as the static rendering, same
 * paddings, no shifts when you click in.
 */

interface NumberFieldProps {
  /** Current value; null/undefined renders the empty placeholder. */
  value: number | null | undefined;
  /** Save handler — called only when the value actually changed. */
  onSave: (value: number) => void | Promise<void>;
  /** Suffix appended to the static value, e.g. "d" for "10d". */
  suffix?: string;
  /** Min/max bounds applied to the input + the saved value. */
  min?: number;
  max?: number;
  /** Hover tooltip text. */
  title?: string;
  /** Display when value is null/undefined; click still enters edit mode. */
  placeholder?: string;
  className?: string;
}

export function InlineNumber({
  value,
  onSave,
  suffix = "",
  min = 0,
  max,
  title,
  placeholder = "—",
  className = "",
}: NumberFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === "" || next === String(value ?? "")) return;
    let n = Number(next);
    if (!Number.isFinite(n)) return;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    await onSave(n);
  };

  const cancel = () => {
    setDraft(value != null ? String(value) : "");
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        className={`w-12 bg-background border border-primary/40 rounded px-1 py-0 text-2xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
        // Stop the parent button (label click → edit dialog) from
        // hijacking the click.
        onClick={(e) => e.stopPropagation()}
        min={min}
        max={max}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value != null ? String(value) : "");
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDraft(value != null ? String(value) : "");
          setEditing(true);
        }
      }}
      title={title || `Click to edit${suffix ? ` (${suffix})` : ""}`}
      className={`text-2xs text-muted-foreground tabular-nums cursor-pointer hover:text-foreground hover:bg-muted/40 rounded px-1 transition-colors ${className}`}
    >
      {value != null ? `${value}${suffix}` : placeholder}
    </span>
  );
}

interface CurrencyFieldProps {
  value: number | null | undefined;
  onSave: (value: number | null) => void | Promise<void>;
  /** Step size for the underlying number input. */
  step?: number;
  min?: number;
  title?: string;
  placeholder?: string;
  className?: string;
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function InlineCurrency({
  value,
  onSave,
  step = 100,
  min = 0,
  title,
  placeholder = "—",
  className = "",
}: CurrencyFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === "") {
      if (value != null) await onSave(null);
      return;
    }
    if (next === String(value ?? "")) return;
    let n = Number(next);
    if (!Number.isFinite(n)) return;
    if (min != null) n = Math.max(min, n);
    await onSave(n);
  };

  const cancel = () => {
    setDraft(value != null ? String(value) : "");
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        step={step}
        min={min}
        className={`w-20 bg-background border border-primary/40 rounded px-1 py-0 text-2xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value != null ? String(value) : "");
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDraft(value != null ? String(value) : "");
          setEditing(true);
        }
      }}
      title={title || "Click to edit budget"}
      className={`text-2xs tabular-nums cursor-pointer hover:text-foreground hover:bg-muted/40 rounded px-1 transition-colors ${
        value != null && value > 0 ? "text-emerald-400/90" : "text-muted-foreground"
      } ${className}`}
    >
      {value != null && value > 0 ? currencyFmt.format(value) : placeholder}
    </span>
  );
}

interface DateFieldProps {
  value: string | null | undefined; // YYYY-MM-DD
  onSave: (value: string | null) => void | Promise<void>;
  title?: string;
  placeholder?: string;
  className?: string;
}

export function InlineDate({
  value,
  onSave,
  title,
  placeholder = "Set date",
  className = "",
}: DateFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === (value ?? "")) return;
    await onSave(next === "" ? null : next);
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        className={`bg-background border border-primary/40 rounded px-1 py-0 text-2xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value ?? "");
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDraft(value ?? "");
          setEditing(true);
        }
      }}
      title={title || "Click to edit start date"}
      className={`text-2xs cursor-pointer hover:text-foreground hover:bg-muted/40 rounded px-1 transition-colors tabular-nums ${className}`}
    >
      {value ?? placeholder}
    </span>
  );
}

interface PredecessorOption {
  id: string;
  label: string;
  /** Schedule track of the predecessor — used for the "show all tracks" toggle and a small chip. */
  track: string | null;
}

interface PredecessorPickerProps {
  /** Current predecessor id; null = anchor phase. */
  value: string | null;
  /** All phases on the deal (across tracks). */
  options: PredecessorOption[];
  /** Track of the phase being edited. Same-track predecessors come first; cross-track only show when the toggle is on. */
  ownTrack: string | null;
  /** Excludes the phase itself (so it can't be its own predecessor) plus any descendants. */
  excludeIds?: Set<string>;
  onSave: (predecessorId: string | null) => void | Promise<void>;
  className?: string;
}

export function InlinePredecessor({
  value,
  options,
  ownTrack,
  excludeIds,
  onSave,
  className = "",
}: PredecessorPickerProps) {
  const [open, setOpen] = useState(false);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = options.find((o) => o.id === value) ?? null;

  const filtered = options
    .filter((o) => !excludeIds?.has(o.id))
    .filter((o) => showAllTracks || !ownTrack || (o.track ?? "development") === ownTrack)
    .filter((o) =>
      query.trim() === ""
        ? true
        : o.label.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => {
      // Same-track first, then alphabetical.
      const aSame = (a.track ?? "development") === (ownTrack ?? "development") ? 0 : 1;
      const bSame = (b.track ?? "development") === (ownTrack ?? "development") ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      return a.label.localeCompare(b.label);
    });

  const pickAndClose = async (id: string | null) => {
    setOpen(false);
    setQuery("");
    if (id === value) return;
    await onSave(id);
  };

  return (
    <div className={`relative inline-block ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Click to change predecessor"
        className={`text-2xs px-1 rounded transition-colors hover:bg-muted/40 ${
          current ? "text-muted-foreground hover:text-foreground" : "text-amber-400/80"
        }`}
      >
        {current ? (
          <span className="inline-flex items-center gap-1">
            <span>← {current.label}</span>
            <Pencil className="h-2 w-2 opacity-50" />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">⚓ anchor</span>
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 top-5 z-30 w-72 rounded-md border border-border bg-popover shadow-xl py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 pb-2 space-y-1.5">
            <input
              type="text"
              autoFocus
              placeholder="Search phases…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showAllTracks}
                onChange={(e) => setShowAllTracks(e.target.checked)}
              />
              Show all tracks
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto border-t border-border/50">
            <button
              onClick={() => pickAndClose(null)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 ${
                value == null ? "text-amber-400" : "text-muted-foreground"
              }`}
            >
              {value == null && <Check className="h-3 w-3" />}
              <span>⚓ Anchor (no predecessor)</span>
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-2xs text-muted-foreground">
                No phases match.
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  onClick={() => pickAndClose(o.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 ${
                    o.id === value ? "text-primary" : ""
                  }`}
                >
                  {o.id === value && <Check className="h-3 w-3" />}
                  <span className="truncate flex-1">{o.label}</span>
                  {o.track && o.track !== ownTrack && (
                    <span className="text-2xs uppercase tracking-wide text-muted-foreground/70">
                      {o.track.slice(0, 3)}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          {current && (
            <div className="border-t border-border/50 px-2 pt-2">
              <button
                onClick={() => pickAndClose(null)}
                className="w-full text-left text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <X className="h-3 w-3" />
                Clear (make anchor)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
