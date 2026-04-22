import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { artifactQueries, dealQueries, documentQueries, underwritingQueries } from "@/lib/db";
import { KIND_META, isArtifactKind } from "@/lib/artifact-generators";
import { buildInputSnapshot, checkStaleness, staleReasons } from "@/lib/artifact-hash";
import type { ArtifactKind } from "@/lib/artifact-hash";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDate } from "@/lib/utils";

interface PageProps {
  params: { id: string; artifactId: string };
}

/**
 * Viewer for a single artifact. Renders a metadata card + (for PDFs)
 * an inline iframe preview pointing at the blob URL, plus the full
 * version chain so analysts can compare against prior generations.
 */
export default async function ArtifactViewerPage({ params }: PageProps) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) redirect("/sign-in");

  if (process.env.NEXT_PUBLIC_REPORTS_LIBRARY !== "1") {
    redirect(`/deals/${params.id}`);
  }

  const [artifact, deal, uw, chain] = await Promise.all([
    artifactQueries.getById(params.artifactId),
    dealQueries.getById(params.id).catch(() => null),
    underwritingQueries.getByDealId(params.id).catch(() => null),
    documentQueries.getVersionChain(params.artifactId).catch(() => []),
  ]);

  if (!artifact || artifact.deal_id !== params.id) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-sm text-muted-foreground">Artifact not found.</p>
        <Button variant="outline" asChild className="mt-4">
          <Link href={`/deals/${params.id}/reports`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to library
          </Link>
        </Button>
      </div>
    );
  }

  const currentInputs = {
    deal: deal ? { id: deal.id, updated_at: deal.updated_at } : null,
    underwriting: uw
      ? {
          id: (uw as { id: string }).id,
          updated_at: (uw as { updated_at: string }).updated_at,
        }
      : null,
  };
  const storedSnapshot = artifact.input_snapshot as ReturnType<typeof buildInputSnapshot> | null;
  const computedStatus = checkStaleness(artifact.input_hash, currentInputs);
  const reasons = computedStatus === "stale" ? staleReasons(storedSnapshot, currentInputs) : [];
  const meta = artifact.kind && isArtifactKind(artifact.kind) ? KIND_META[artifact.kind as ArtifactKind] : null;
  const isPdf = artifact.mime_type === "application/pdf";

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/deals/${params.id}/reports`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to library
          </Link>
        </Button>
      </div>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{artifact.name}</h1>
          <div className="text-sm text-muted-foreground flex gap-3 flex-wrap">
            <span>{meta?.label ?? artifact.category}</span>
            <span>·</span>
            <span>v{artifact.version}</span>
            <span>·</span>
            <span>Generated {formatDate(artifact.uploaded_at)}</span>
            {artifact.file_size && (
              <>
                <span>·</span>
                <span>{formatBytes(artifact.file_size)}</span>
              </>
            )}
          </div>
          <div className="text-sm">
            {computedStatus === "stale" ? (
              <span className="text-amber-800">
                Stale — inputs changed since generation: {reasons.join(", ") || "deal state"}
              </span>
            ) : (
              <span className="text-emerald-800">Up to date</span>
            )}
          </div>
        </div>
        {artifact.file_path && (
          <Button asChild>
            <a
              href={`/api/deals/${params.id}/artifacts/${artifact.id}/download`}
              download={artifact.original_name}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </a>
          </Button>
        )}
      </header>

      {artifact.ai_summary && (
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          {artifact.ai_summary}
        </div>
      )}

      {isPdf && artifact.file_path && (
        <iframe
          src={artifact.file_path}
          className="w-full h-[75vh] border rounded-md"
          title={artifact.name}
        />
      )}

      {!isPdf && artifact.file_path && (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Inline preview isn&apos;t supported for {artifact.mime_type ?? "this format"}.
          Use Download to open the file.
        </div>
      )}

      {chain.length > 1 && (
        <section className="space-y-3 pt-4 border-t">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Version history
          </h2>
          <ul className="text-sm space-y-1">
            {(chain as Record<string, unknown>[])
              .slice()
              .reverse()
              .map((row) => {
                const r = row as {
                  id: string;
                  version: number;
                  uploaded_at: string;
                  name: string;
                };
                const isThis = r.id === artifact.id;
                return (
                  <li key={r.id} className="flex items-center gap-3">
                    <span className="text-muted-foreground w-12">v{r.version}</span>
                    <span className="text-muted-foreground w-40">
                      {formatDate(r.uploaded_at)}
                    </span>
                    {isThis ? (
                      <span className="font-medium">{r.name} (current)</span>
                    ) : (
                      <Link
                        href={`/deals/${params.id}/reports/${r.id}`}
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {r.name}
                      </Link>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}
