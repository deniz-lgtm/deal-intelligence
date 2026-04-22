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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/deals/${params.id}/reports`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to library
          </Link>
        </Button>
      </div>

      <header className="space-y-3">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight break-words">
          {artifact.name}
        </h1>
        <div className="text-xs sm:text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{meta?.label ?? artifact.category}</span>
          <span aria-hidden className="text-muted-foreground/50">·</span>
          <span>v{artifact.version}</span>
          <span aria-hidden className="text-muted-foreground/50">·</span>
          <span>Generated {formatDate(artifact.uploaded_at)}</span>
          {artifact.file_size && (
            <>
              <span aria-hidden className="text-muted-foreground/50">·</span>
              <span>{formatBytes(artifact.file_size)}</span>
            </>
          )}
        </div>
        <div className="text-xs sm:text-sm">
          {computedStatus === "stale" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200 px-2 py-0.5">
              Stale — {reasons.join(", ") || "deal state"} changed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200 px-2 py-0.5">
              Up to date
            </span>
          )}
        </div>
        {artifact.file_path && (
          <Button asChild className="w-full sm:w-auto">
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
        <div className="rounded-md border bg-muted/30 p-3 sm:p-4 text-xs sm:text-sm">
          {artifact.ai_summary}
        </div>
      )}

      {isPdf && artifact.file_path && (
        // Stream through the documents view route rather than embedding
        // the raw R2 URL — R2 returns InvalidArgumentAuthorization for
        // unsigned access to the raw bucket endpoint. On mobile, some
        // browsers don't render inline PDFs in iframes; we keep the
        // iframe as a best-effort preview and surface the download
        // button above as the reliable path.
        <iframe
          src={`/api/documents/${artifact.id}/view`}
          className="w-full h-[60vh] sm:h-[75vh] border rounded-md bg-white"
          title={artifact.name}
        />
      )}

      {!isPdf && artifact.file_path && (
        <div className="rounded-md border p-4 sm:p-6 text-center text-sm text-muted-foreground">
          Inline preview isn&apos;t supported for {artifact.mime_type ?? "this format"}.
          Use Download to open the file.
        </div>
      )}

      {chain.length > 1 && (
        <section className="space-y-3 pt-4 border-t">
          <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Version history
          </h2>
          <ul className="text-xs sm:text-sm divide-y border rounded-md">
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
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30"
                  >
                    <span className="text-muted-foreground w-8 shrink-0 font-medium">
                      v{r.version}
                    </span>
                    <span className="text-muted-foreground w-24 sm:w-32 shrink-0 text-xs">
                      {formatDate(r.uploaded_at)}
                    </span>
                    {isThis ? (
                      <span className="font-medium truncate">
                        {r.name}
                        <span className="ml-1.5 text-muted-foreground font-normal">
                          (current)
                        </span>
                      </span>
                    ) : (
                      <Link
                        href={`/deals/${params.id}/reports/${r.id}`}
                        className="underline decoration-dotted underline-offset-2 truncate"
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
