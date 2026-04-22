/**
 * GET /api/deals/[id]/artifacts/[artifactId]/download
 * Streams the artifact's blob with the correct Content-Disposition.
 * For blobs stored at external URLs (S3), returns a 302 redirect so the
 * client fetches the signed URL directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { artifactQueries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const row = await artifactQueries.getById(params.artifactId);
  if (!row || row.deal_id !== params.id) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
  if (!row.file_path) {
    return NextResponse.json({ error: "Artifact has no downloadable blob" }, { status: 404 });
  }

  // `file_path` is either an absolute URL (S3) or a path beneath
  // UPLOAD_DIR (local dev). For remote URLs we redirect — the browser
  // downloads directly. Local dev streaming is handled by the existing
  // /api/documents/[id]/download route that clients already use elsewhere;
  // point there instead of duplicating streaming logic.
  if (/^https?:\/\//.test(row.file_path)) {
    return NextResponse.redirect(row.file_path, 302);
  }
  return NextResponse.redirect(new URL(`/api/documents/${row.id}/download`, _req.url), 302);
}
