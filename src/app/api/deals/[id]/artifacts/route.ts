/**
 * GET  /api/deals/[id]/artifacts — list latest artifact per kind for a
 *      deal, with staleness recomputed from current deal + UW state.
 *
 * POST /api/deals/[id]/artifacts — generate a new artifact. Body:
 *        { kind: ArtifactKind, payload?: Record<string, unknown>,
 *          massingId?: string|null, previousId?: string|null }
 *      Dispatches to the per-kind generator; persists via artifactQueries.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { artifactQueries, dealQueries, underwritingQueries } from "@/lib/db";
import { isArtifactKind, loadGenerator, KIND_META } from "@/lib/artifact-generators";
import { ArtifactGeneratorNotImplementedError } from "@/lib/artifact-generators/_stub";
import { buildInputSnapshot, checkStaleness, staleReasons } from "@/lib/artifact-hash";
import type { ArtifactKind } from "@/lib/artifact-hash";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const url = new URL(req.url);
    const kindParam = url.searchParams.get("kind");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const kind = kindParam && isArtifactKind(kindParam) ? (kindParam as ArtifactKind) : undefined;

    const [rows, deal, uw] = await Promise.all([
      artifactQueries.listLatest(params.id, { kind, includeArchived }),
      dealQueries.getById(params.id).catch(() => null),
      underwritingQueries.getByDealId(params.id).catch(() => null),
    ]);

    // Compute staleness once with the current deal/UW state.
    const currentInputs = {
      deal: deal ? { id: deal.id, updated_at: deal.updated_at } : null,
      underwriting: uw ? { id: (uw as { id: string }).id, updated_at: (uw as { updated_at: string }).updated_at } : null,
    };

    const withStaleness = rows.map((row) => {
      const storedSnapshot = row.input_snapshot as ReturnType<typeof buildInputSnapshot> | null;
      const computedStatus = checkStaleness(row.input_hash, currentInputs);
      const reasons = computedStatus === "stale" ? staleReasons(storedSnapshot, currentInputs) : [];
      return {
        ...row,
        computed_status: computedStatus,
        stale_reasons: reasons,
        kind_meta: row.kind && isArtifactKind(row.kind) ? KIND_META[row.kind as ArtifactKind] : null,
      };
    });

    return NextResponse.json({ artifacts: withStaleness });
  } catch (err) {
    console.error("GET /api/deals/[id]/artifacts error:", err);
    return NextResponse.json({ error: "Failed to list artifacts" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const body = await req.json();
    const kind = body.kind as string | undefined;
    if (!kind || !isArtifactKind(kind)) {
      return NextResponse.json({ error: "Invalid or missing `kind`" }, { status: 400 });
    }

    const generator = await loadGenerator(kind as ArtifactKind);
    const result = await generator({
      dealId: params.id,
      userId,
      previousId: (body.previousId as string | null | undefined) ?? null,
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
      massingId: (body.massingId as string | null | undefined) ?? null,
    });

    const meta = KIND_META[kind as ArtifactKind];
    const row = await artifactQueries.saveLatest({
      id: uuidv4(),
      deal_id: params.id,
      kind,
      category: meta.category,
      name: result.title,
      original_name: result.filename,
      file_path: result.filePath,
      file_size: result.fileSize,
      mime_type: result.mimeType,
      content_text: result.contentText ?? null,
      ai_summary: result.summary ?? null,
      ai_tags: result.tags,
      input_hash: result.inputHash,
      input_snapshot: result.inputSnapshot,
      source_artifact_id: result.sourceArtifactId ?? null,
      previousId: (body.previousId as string | null | undefined) ?? null,
    });

    return NextResponse.json({ artifact: row });
  } catch (err) {
    if (err instanceof ArtifactGeneratorNotImplementedError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 501 }
      );
    }
    console.error("POST /api/deals/[id]/artifacts error:", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
