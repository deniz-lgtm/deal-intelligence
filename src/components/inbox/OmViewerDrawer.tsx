"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

interface OmViewerDrawerProps {
  open: boolean;
  inboxItemId: string | null;
  itemLabel?: string | null;
  onClose: () => void;
}

/**
 * Right-side drawer that renders the source OM PDF for an inbox item
 * inline. Saves the analyst from leaving the screening queue to verify
 * the extracted fields.
 */
export function OmViewerDrawer({ open, inboxItemId, itemLabel, onClose }: OmViewerDrawerProps) {
  const [docId, setDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !inboxItemId) return;
    let cancelled = false;
    setDocId(null);
    setError(null);
    setLoading(true);
    fetch(`/api/inbox/items/${inboxItemId}/screen`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const id = j?.data?.om_document_id ?? null;
        if (!id) setError("No OM document found for this item.");
        setDocId(id);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load OM document.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, inboxItemId]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close OM viewer"
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Offering memo viewer"
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-3xl flex-col border-l border-border/60 bg-card shadow-xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-3">
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Offering memo
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              {itemLabel || "OM viewer"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="relative flex-1 overflow-hidden bg-background">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading OM…
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {error}
            </div>
          )}
          {!loading && !error && docId && (
            <iframe
              title="Offering memo"
              src={`/api/documents/${docId}/view`}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </aside>
    </>
  );
}
