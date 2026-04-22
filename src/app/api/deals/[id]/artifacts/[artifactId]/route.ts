/**
 * GET    /api/deals/[id]/artifacts/[artifactId]
 *        Full artifact row + computed staleness.
 *
 * PATCH  /api/deals/[id]/artifacts/[artifactId]
 *        Body: { status: 'archived' | 'current' } — toggle archive state.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { artifactQueries, dealQueries, underwritingQueries } from "@/lib/db";
import { KIND_META, isArtifactKind } from "@/lib/artifact-generators";
import { buildInputSnapshot, checkStaleness, staleReasons } from "@/lib/artifact-hash";
import type { ArtifactKind } from "@/lib/artifact-hash";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const row = await artifactQueries.getById(params.artifactId);
    if (!row || row.deal_id !== params.id) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const [deal, uw] = await Promise.all([
      dealQueries.getById(params.id).catch(() => null),
      underwritingQueries.getByDealId(params.id).catch(() => null),
    ]);

    const currentInputs = {
      deal: deal ? { id: deal.id, updated_at: deal.updated_at } : null,
      underwriting: uw ? { id: (uw as { id: string }).id, updated_at: (uw as { updated_at: string }).updated_at } : null,
    };
    const storedSnapshot = row.input_snapshot as ReturnType<typeof buildInputSnapshot> | null;
    const computedStatus = checkStaleness(row.input_hash, currentInputs);
    const reasons = computedStatus === "stale" ? staleReasons(storedSnapshot, currentInputs) : [];

    return NextResponse.json({
      artifact: {
        ...row,
        computed_status: computedStatus,
        stale_reasons: reasons,
        kind_meta: row.kind && isArtifactKind(row.kind) ? KIND_META[row.kind as ArtifactKind] : null,
      },
    });
  } catch (err) {
    console.error("GET /api/deals/[id]/artifacts/[artifactId] error:", err);
    return NextResponse.json({ error: "Failed to load artifact" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const row = await artifactQueries.getById(params.artifactId);
    if (!row || row.deal_id !== params.id) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const body = await req.json();
    const status = body.status as string | undefined;
    if (status !== "archived" && status !== "current") {
      return NextResponse.json(
        { error: "Invalid status. Expected 'archived' or 'current'." },
        { status: 400 }
      );
    }

    const updated =
      status === "archived"
        ? await artifactQueries.archive(params.artifactId)
        : await artifactQueries.unarchive(params.artifactId);

    return NextResponse.json({ artifact: updated });
  } catch (err) {
    console.error("PATCH /api/deals/[id]/artifacts/[artifactId] error:", err);
    return NextResponse.json({ error: "Failed to update artifact" }, { status: 500 });
  }
}
