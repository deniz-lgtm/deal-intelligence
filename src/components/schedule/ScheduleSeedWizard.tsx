"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  SCHEDULE_BUNDLES,
  SCHEDULE_TRACK_LABELS,
  type ScheduleBundle,
  type ScheduleTrack,
} from "@/lib/types";

// ─── Schedule seed wizard ────────────────────────────────────────────────────
//
// Modal dialog launched from the home-page Schedule hero (empty deal rows)
// or the in-deal Schedule page. Lets the user opt in to slices of the
// default schedule rather than seeding everything across all three tracks.
//
// Each bundle (purchase chain, diligence items, IC checkpoints, design,
// permitting, …) is a checkbox. All bundles default to OFF — opt-in. The
// user picks what they need, sets an anchor date, and submits. The seed
// route filters DEFAULT_PHASES_BY_TRACK by the selected bundle ids.
//
// Aesthetic mirrors the schedule hero: font-nameplate header, narrow
// uppercase tracking on labels, hairline rules between sections.

interface Props {
  dealId: string;
  dealName: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful seed so the parent can refetch. */
  onSeeded: () => void;
}

const TRACK_ACCENT_VAR: Record<ScheduleTrack, string> = {
  acquisition: "--phase-acq",
  development: "--phase-dev",
  construction: "--phase-con",
};

const TRACK_ORDER: ScheduleTrack[] = ["acquisition", "development", "construction"];

export function ScheduleSeedWizard({ dealId, dealName, open, onClose, onSeeded }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorDate, setAnchorDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the wizard reopens — leftover selections from a prior
  // open would surprise the user (and the anchor date might be stale).
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setAnchorDate(new Date().toISOString().slice(0, 10));
      setError(null);
    }
  }, [open]);

  // Lock body scroll while open so background pages don't drift behind the
  // modal — the existing app doesn't have a global modal manager so handle
  // it locally.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Group bundles by track for rendering. SCHEDULE_BUNDLES is already in
  // a deterministic order; we just split it.
  const bundlesByTrack = useMemo(() => {
    const out: Record<ScheduleTrack, ScheduleBundle[]> = {
      acquisition: [],
      development: [],
      construction: [],
    };
    for (const b of SCHEDULE_BUNDLES) out[b.track].push(b);
    return out;
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundles: Array.from(selected),
          start_date: anchorDate,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        setError(`Seed failed (${res.status}). ${detail.slice(0, 200)}`);
        return;
      }
      onSeeded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 animate-fade-up"
      role="dialog"
      aria-modal="true"
      aria-labelledby="seed-wizard-title"
    >
      {/* Scrim — click to dismiss */}
      <button
        type="button"
        aria-label="Close wizard"
        className="absolute inset-0 bg-background/85 backdrop-blur-sm cursor-default"
        onClick={() => !submitting && onClose()}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-full overflow-hidden flex flex-col bg-card border border-border/60 rounded-lg shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border/40">
          <div className="min-w-0">
            <h2
              id="seed-wizard-title"
              className="font-nameplate text-2xl leading-none tracking-tight text-foreground"
            >
              Seed schedule
            </h2>
            <p className="mt-2 text-2xs uppercase tracking-[0.18em] text-muted-foreground/65 truncate">
              {dealName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            aria-label="Close"
            className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-card/40 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Anchor date row */}
        <div className="px-6 py-4 border-b border-border/30 flex items-center justify-between gap-4">
          <div>
            <p className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/65">
              Anchor date
            </p>
            <p className="mt-1 text-xs text-muted-foreground/55 max-w-[44ch]">
              First phase starts here. Predecessor chain extends from this
              point forward.
            </p>
          </div>
          <input
            type="date"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
            className="text-sm tabular-nums px-3 py-1.5 border border-border/50 rounded bg-background/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
        </div>

        {/* Bundle list */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {TRACK_ORDER.map((track) => {
            const bundles = bundlesByTrack[track];
            if (bundles.length === 0) return null;
            return (
              <section key={track}>
                <header className="flex items-baseline gap-2 mb-3">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `hsl(var(${TRACK_ACCENT_VAR[track]}))` }}
                  />
                  <h3 className="font-nameplate text-base text-foreground">
                    {SCHEDULE_TRACK_LABELS[track]}
                  </h3>
                </header>
                <ul className="space-y-1.5">
                  {bundles.map((b) => {
                    const isSelected = selected.has(b.id);
                    return (
                      <li key={b.id}>
                        <label
                          className={`group/row flex items-start gap-3 px-3 py-2.5 rounded border cursor-pointer transition-colors ${
                            isSelected
                              ? "border-primary/40 bg-primary/[0.04]"
                              : "border-border/40 hover:border-border/70 hover:bg-card/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(b.id)}
                            className="mt-1 shrink-0 h-3.5 w-3.5 rounded border-border/60 text-primary focus:ring-primary/30"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground leading-snug">
                              {b.label}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground/70 leading-snug">
                              {b.description}
                            </div>
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-border/40 flex items-center justify-between gap-3">
          <span className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/60 tabular-nums">
            {selected.size === 0
              ? "Nothing selected"
              : `${selected.size} ${selected.size === 1 ? "bundle" : "bundles"} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              className="px-4 py-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={selected.size === 0 || submitting}
              className="px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Seeding…" : "Seed selected"}
            </button>
          </div>
        </footer>

        {error && (
          <div className="px-6 py-2 border-t border-destructive/40 bg-destructive/[0.06] text-2xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
