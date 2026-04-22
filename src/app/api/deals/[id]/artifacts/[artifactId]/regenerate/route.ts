/**
 * POST /api/deals/[id]/artifacts/[artifactId]/regenerate
 * Re-runs the same generator with current inputs; writes a new version
 * linked via parent_document_id (forming a version chain). Old row stays
 * readable.
 *
 * Body: { payload?: Record<string, unknown> } — generators optionally
 * accept a payload override (e.g. user edits to saved prose). Without
 * it, they read the deal's current state fresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { artifactQueries } from "@/lib/db";
import { loadGenerator, KIND_META, isArtifactKind } from "@/lib/artifact-generators";
import { ArtifactGeneratorNotImplementedError } from "@/lib/artifact-generators/_stub";
import type { ArtifactKind } from "@/lib/artifact-hash";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const existing = await artifactQueries.getById(params.artifactId);
    if (!existing || existing.deal_id !== params.id) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    if (!existing.kind || !isArtifactKind(existing.kind)) {
      return NextResponse.json(
        { error: "Artifact kind missing or unknown — cannot regenerate" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const kind = existing.kind as ArtifactKind;
    const generator = await loadGenerator(kind);

    const result = await generator({
      dealId: params.id,
      userId,
      previousId: params.artifactId,
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
      massingId: null, // future: pull from existing.ai_tags if tagged
    });

    const meta = KIND_META[kind];
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
      previousId: params.artifactId,
    });

    return NextResponse.json({ artifact: row });
  } catch (err) {
    if (err instanceof ArtifactGeneratorNotImplementedError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 501 }
      );
    }
    console.error("POST /api/deals/[id]/artifacts/[artifactId]/regenerate error:", err);
    const message = err instanceof Error ? err.message : "Regeneration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
