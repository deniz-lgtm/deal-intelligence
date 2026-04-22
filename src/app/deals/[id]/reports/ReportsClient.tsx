"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Archive, CheckCircle2, Download, Eye, FileText, FolderArchive, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { ArtifactRow } from "@/lib/db";
import type { KindMeta, ArtifactCategory } from "@/lib/artifact-generators";

type HydratedArtifact = ArtifactRow & {
  computed_status: "current" | "stale";
  stale_reasons: string[];
  kind_meta: KindMeta | null;
};

interface Props {
  dealId: string;
  dealName: string;
  artifacts: HydratedArtifact[];
}

const CATEGORY_ORDER: ArtifactCategory[] = [
  "investor_packages",
  "analysis_outputs",
  "deal_documents",
];

const CATEGORY_LABELS: Record<ArtifactCategory, string> = {
  investor_packages: "Investor Packages",
  analysis_outputs: "Analysis Outputs",
  deal_documents: "Deal Documents",
};

const CATEGORY_DESCRIPTIONS: Record<ArtifactCategory, string> = {
  investor_packages: "IC packages, pitch decks, memos, one-pagers",
  analysis_outputs: "Proforma, DD abstracts, zoning reports",
  deal_documents: "LOIs and deal-stage documents",
};

export default function ReportsClient({ dealId, dealName, artifacts }: Props) {
  const router = useRouter();
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<ArtifactCategory, HydratedArtifact[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const artifact of artifacts) {
      const cat = artifact.kind_meta?.category ?? "deal_documents";
      const bucket = map.get(cat) ?? [];
      bucket.push(artifact);
      map.set(cat, bucket);
    }
    return map;
  }, [artifacts]);

  async function archive(id: string) {
    setArchivingId(id);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Archived");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setArchivingId(null);
    }
  }

  async function regenerate(id: string) {
    setRegeneratingId(id);
    try {
      const res = await fetch(`/api/deals/${dealId}/artifacts/${id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (payload.error === "generator_not_implemented") {
          toast.info("Generator not wired yet — ships in a later phase");
          return;
        }
        throw new Error(payload.message || payload.error || "Regeneration failed");
      }
      toast.success("Regenerated — new version saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderArchive className="h-4 w-4" />
          <span>{dealName}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Reports &amp; Packages</h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Every generated artifact for this deal — investor packages, analysis
          outputs, and deal documents. When inputs change, artifacts are
          flagged stale until regenerated.
        </p>
      </header>

      {artifacts.length === 0 ? (
        <EmptyState />
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={cat} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {CATEGORY_DESCRIPTIONS[cat]}
                </p>
              </div>
              <div className="border rounded-lg overflow-hidden divide-y">
                {items.map((artifact) => (
                  <ArtifactRowView
                    key={artifact.id}
                    dealId={dealId}
                    artifact={artifact}
                    onArchive={archive}
                    onRegenerate={regenerate}
                    archiving={archivingId === artifact.id}
                    regenerating={regeneratingId === artifact.id}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function ArtifactRowView({
  dealId,
  artifact,
  onArchive,
  onRegenerate,
  archiving,
  regenerating,
}: {
  dealId: string;
  artifact: HydratedArtifact;
  onArchive: (id: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
  archiving: boolean;
  regenerating: boolean;
}) {
  const stale = artifact.computed_status === "stale";
  const formatLabel = (artifact.mime_type ?? "").split("/").pop()?.toUpperCase() ?? "—";
  const kindLabel = artifact.kind_meta?.label ?? artifact.category ?? artifact.kind ?? "Artifact";
  const tooltip = stale
    ? `Stale since inputs changed: ${artifact.stale_reasons.join(", ") || "deal state"}`
    : "Up to date with current deal state";

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{artifact.name}</span>
          <span className="text-xs uppercase tracking-wider text-muted-foreground border rounded px-1.5 py-0.5">
            {kindLabel}
          </span>
          <span className="text-xs uppercase tracking-wider text-muted-foreground border rounded px-1.5 py-0.5">
            {formatLabel}
          </span>
          <span className="text-xs text-muted-foreground">v{artifact.version}</span>
          <StatusChip stale={stale} tooltip={tooltip} />
        </div>
        {artifact.ai_summary && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {artifact.ai_summary}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">
          Generated {formatDate(artifact.uploaded_at)}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/deals/${dealId}/reports/${artifact.id}`}>
            <Eye className="h-4 w-4 mr-1" />
            View
          </Link>
        </Button>
        {artifact.file_path && (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`/api/deals/${dealId}/artifacts/${artifact.id}/download`}
              download={artifact.original_name}
            >
              <Download className="h-4 w-4 mr-1" />
              Download
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRegenerate(artifact.id)}
          disabled={regenerating}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? "Regenerating" : "Regenerate"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onArchive(artifact.id)}
          disabled={archiving}
        >
          <Archive className="h-4 w-4 mr-1" />
          {archiving ? "Archiving" : "Archive"}
        </Button>
      </div>
    </div>
  );
}

function StatusChip({ stale, tooltip }: { stale: boolean; tooltip: string }) {
  if (stale) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200"
        title={tooltip}
      >
        <AlertCircle className="h-3 w-3" />
        Stale
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200"
      title={tooltip}
    >
      <CheckCircle2 className="h-3 w-3" />
      Current
    </span>
  );
}

function EmptyState() {
  return (
    <div className="border-2 border-dashed rounded-lg p-12 text-center space-y-2">
      <FolderArchive className="h-8 w-8 text-muted-foreground mx-auto" />
      <div className="font-medium">No generated artifacts yet</div>
      <div className="text-sm text-muted-foreground max-w-md mx-auto">
        Generate an IC Package, investment memo, proforma, or other report from
        the relevant authoring page and it will appear here. Older exports
        saved through the prior document library are also surfaced.
      </div>
    </div>
  );
}
