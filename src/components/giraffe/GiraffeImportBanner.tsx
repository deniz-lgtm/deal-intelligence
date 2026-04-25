"use client";

import { useEffect, useState } from "react";
import { UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import GiraffeImportDialog from "./GiraffeImportDialog";

interface Props {
  dealId: string;
  /** Called after a successful import so the consuming page can reload. */
  onCommitted: () => void;
}

interface GiraffeDoc {
  id: string;
  original_name: string;
  created_at: string;
}

/**
 * Programming / Site-Zoning banner for Giraffe imports.
 *
 * Always offers a manual upload button. Additionally, if the deal's
 * Documents tab has any .geojson files categorized as `giraffe_export`,
 * a one-click "Use this file" path surfaces the most-recent one — this
 * is the "auto-detect" promise from Documents intake: land the file in
 * Documents, work the data in on the page that actually uses it.
 */
export default function GiraffeImportBanner({ dealId, onCommitted }: Props) {
  const [docs, setDocs] = useState<GiraffeDoc[]>([]);
  const [open, setOpen] = useState(false);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/documents?category=giraffe_export`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const rows: GiraffeDoc[] = Array.isArray(j.data)
          ? j.data.filter((d: { category?: string }) => d.category === "giraffe_export")
          : [];
        setDocs(rows);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dealId]);

  // Manual upload path is always available — if there's no existing
  // doc, still render a collapsed prompt.
  const hasDocs = docs.length > 0;
  if (dismissed && !hasDocs) return (
    <Button variant="outline" size="sm" onClick={() => { setSeedId(null); setOpen(true); }}>
      <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
      Import from Giraffe
    </Button>
  );

  return (
    <>
      {!dismissed && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span className="text-base" role="img" aria-label="Giraffe">🦒</span>
          </div>
          <div className="flex-1 min-w-0">
            {hasDocs ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  Giraffe export on this deal
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {docs[0].original_name} · Import to seed the site plan, massing, and zoning fields below.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Using Giraffe for feasibility?</p>
                <p className="text-xs text-muted-foreground">
                  Export as GeoJSON and drop it here to auto-populate the site plan, massing,
                  and zoning fields. We&apos;ll handle the deal from there.
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasDocs ? (
              <Button
                size="sm"
                onClick={() => {
                  setSeedId(docs[0].id);
                  setOpen(true);
                }}
              >
                Import
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSeedId(null);
                  setOpen(true);
                }}
              >
                <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
                Upload
              </Button>
            )}
            <button
              onClick={() => setDismissed(true)}
              title="Dismiss"
              className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      <GiraffeImportDialog
        dealId={dealId}
        open={open}
        onOpenChange={setOpen}
        onCommitted={() => {
          onCommitted();
          setDismissed(true);
        }}
        seedFromDocumentId={seedId}
      />
    </>
  );
}
