"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  FolderArchive,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
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
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);

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
      setOpenActionsId(null);
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
      setOpenActionsId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-10">
      <header className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
            <FolderArchive className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="truncate">{dealName}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Reports &amp; Packages
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose">
            Every generated artifact for this deal. When inputs change,
            artifacts are flagged stale until regenerated.
          </p>
        </div>
        {/* Header CTA — one tap from library to authoring. Shown whenever
            there's content; the empty state has its own prominent CTA. */}
        {artifacts.length > 0 && (
          <Button asChild size="sm" className="shrink-0">
            <Link href={`/deals/${dealId}/investment-package`}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Package
            </Link>
          </Button>
        )}
      </header>

      {artifacts.length === 0 ? (
        <EmptyState dealId={dealId} />
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={cat} className="space-y-3">
              <div>
                <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
                    actionsOpen={openActionsId === artifact.id}
                    onToggleActions={() =>
                      setOpenActionsId(openActionsId === artifact.id ? null : artifact.id)
                    }
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
  actionsOpen,
  onToggleActions,
}: {
  dealId: string;
  artifact: HydratedArtifact;
  onArchive: (id: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
  archiving: boolean;
  regenerating: boolean;
  actionsOpen: boolean;
  onToggleActions: () => void;
}) {
  const stale = artifact.computed_status === "stale";
  // mime_type like "application/pdf" → "PDF". Shown only on wider screens;
  // all generated artifacts are PDFs today, so it's low-value noise on mobile.
  const formatLabel =
    (artifact.mime_type ?? "").split("/").pop()?.toUpperCase() ?? "—";
  const kindLabel =
    artifact.kind_meta?.label ?? artifact.category ?? artifact.kind ?? "Artifact";
  const tooltip = stale
    ? `Stale — inputs changed since generation: ${artifact.stale_reasons.join(", ") || "deal state"}`
    : "Up to date with current deal state";

  return (
    <div className="px-3 py-3 sm:px-4 sm:py-3 hover:bg-muted/30 transition-colors">
      {/* Top row — title + chips. Stacks on mobile, inline on desktop. */}
      <div className="flex items-start gap-3">
        <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-medium truncate text-sm sm:text-base">
            {artifact.name}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="uppercase tracking-wider text-muted-foreground border rounded px-1.5 py-0.5">
              {kindLabel}
            </span>
            <span className="hidden sm:inline-flex uppercase tracking-wider text-muted-foreground border rounded px-1.5 py-0.5">
              {formatLabel}
            </span>
            <span className="text-muted-foreground">v{artifact.version}</span>
            <StatusChip stale={stale} tooltip={tooltip} />
          </div>
          {/* Stale reason inline — tooltips aren't reachable on touch. Only
              rendered for stale rows so current rows stay visually quiet. */}
          {stale && artifact.stale_reasons.length > 0 && (
            <div className="text-xs text-amber-800 dark:text-amber-300">
              {artifact.stale_reasons.join(", ")} changed since generation
            </div>
          )}
          {artifact.ai_summary && (
            <div className="text-xs text-muted-foreground truncate sm:whitespace-normal">
              {artifact.ai_summary}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Generated {formatDate(artifact.uploaded_at)}
          </div>
        </div>

        {/* Mobile: dropdown trigger. Desktop: inline actions. */}
        <div className="sm:hidden shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleActions}
            aria-expanded={actionsOpen}
            aria-label="Artifact actions"
          >
            {actionsOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="hidden sm:flex items-center gap-1 shrink-0">
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
            <RefreshCw
              className={`h-4 w-4 mr-1 ${regenerating ? "animate-spin" : ""}`}
            />
            {regenerating ? "Regenerating" : "Regenerate"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onArchive(artifact.id)}
            disabled={archiving}
            aria-label="Archive"
          >
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mobile actions sheet — expanded row. */}
      {actionsOpen && (
        <div className="sm:hidden mt-3 pt-3 border-t grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" asChild className="justify-start">
            <Link href={`/deals/${dealId}/reports/${artifact.id}`}>
              <Eye className="h-4 w-4 mr-1.5" />
              View
            </Link>
          </Button>
          {artifact.file_path && (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="justify-start"
            >
              <a
                href={`/api/deals/${dealId}/artifacts/${artifact.id}/download`}
                download={artifact.original_name}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Download
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRegenerate(artifact.id)}
            disabled={regenerating}
            className="justify-start"
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 ${regenerating ? "animate-spin" : ""}`}
            />
            {regenerating ? "Regenerating" : "Regenerate"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onArchive(artifact.id)}
            disabled={archiving}
            className="justify-start"
          >
            <Archive className="h-4 w-4 mr-1.5" />
            {archiving ? "Archiving" : "Archive"}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusChip({ stale, tooltip }: { stale: boolean; tooltip: string }) {
  if (stale) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200"
        title={tooltip}
      >
        <AlertCircle className="h-3 w-3" />
        Stale
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200"
      title={tooltip}
    >
      <CheckCircle2 className="h-3 w-3" />
      Current
    </span>
  );
}

function EmptyState({ dealId }: { dealId: string }) {
  return (
    <div className="border-2 border-dashed rounded-lg p-8 sm:p-12 text-center space-y-4">
      <div className="space-y-2">
        <FolderArchive className="h-10 w-10 text-muted-foreground mx-auto" />
        <div className="font-medium text-base">No generated artifacts yet</div>
        <div className="text-sm text-muted-foreground max-w-md mx-auto">
          Generate an IC Package, investment memo, proforma, DD abstract,
          zoning report, or LOI — the PDF lands here with version history
          and auto-detected staleness when deal inputs change.
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Button asChild size="sm">
          <Link href={`/deals/${dealId}/investment-package`}>
            <Sparkles className="h-4 w-4 mr-1.5" />
            Generate Package
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/deals/${dealId}/underwriting`}>
            Generate Proforma
          </Link>
        </Button>
      </div>
    </div>
  );
}
