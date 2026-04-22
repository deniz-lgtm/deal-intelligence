import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { artifactQueries, dealQueries, underwritingQueries } from "@/lib/db";
import { KIND_META, isArtifactKind } from "@/lib/artifact-generators";
import { buildInputSnapshot, checkStaleness, staleReasons } from "@/lib/artifact-hash";
import type { ArtifactKind } from "@/lib/artifact-hash";
import ReportsClient from "./ReportsClient";

interface PageProps {
  params: { id: string };
}

/**
 * Reports & Packages library.
 *
 * Central per-deal view of every generated artifact — IC Packages,
 * investment memos, proforma PDFs, DD abstracts, zoning reports, LOIs.
 * Staleness is computed on the server at request time by re-hashing
 * the current deal + UW state and comparing to the artifact's stored
 * hash, so users always see truthful "current vs out-of-date" chips.
 */
export default async function ReportsPage({ params }: PageProps) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) redirect("/sign-in");

  const [deal, uw, rows] = await Promise.all([
    dealQueries.getById(params.id).catch(() => null),
    underwritingQueries.getByDealId(params.id).catch(() => null),
    artifactQueries.listLatest(params.id, { includeArchived: false }),
  ]);

  if (!deal) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Deal not found.
      </div>
    );
  }

  // Recompute staleness once on the server so the client gets flat,
  // ready-to-render rows. Matches the GET /artifacts response shape.
  const currentInputs = {
    deal: { id: deal.id, updated_at: deal.updated_at },
    underwriting: uw
      ? {
          id: (uw as { id: string }).id,
          updated_at: (uw as { updated_at: string }).updated_at,
        }
      : null,
  };

  const artifacts = rows.map((row) => {
    const storedSnapshot = row.input_snapshot as ReturnType<typeof buildInputSnapshot> | null;
    const computedStatus = checkStaleness(row.input_hash, currentInputs);
    const reasons = computedStatus === "stale" ? staleReasons(storedSnapshot, currentInputs) : [];
    return {
      ...row,
      computed_status: computedStatus,
      stale_reasons: reasons,
      kind_meta:
        row.kind && isArtifactKind(row.kind)
          ? KIND_META[row.kind as ArtifactKind]
          : null,
    };
  });

  return <ReportsClient dealId={params.id} dealName={deal.name} artifacts={artifacts} />;
}
