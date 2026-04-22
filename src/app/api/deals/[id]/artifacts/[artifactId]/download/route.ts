/**
 * GET /api/deals/[id]/artifacts/[artifactId]/download
 *
 * Redirects to the existing /api/documents/[id]/view route, which
 * streams bytes through the server using the R2 signed-request SDK.
 *
 * Why not redirect straight to file_path? In production R2 rejects
 * unsigned access to the raw bucket URL with "InvalidArgumentAuthorization"
 * unless R2_PUBLIC_URL is configured to a public-bucket custom domain.
 * Streaming through the server makes the route environment-agnostic.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { artifactQueries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
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

  // Always stream through the documents view route — handles both R2
  // (signed via SDK) and local dev (filesystem read) without leaking
  // raw bucket URLs to the client.
  return NextResponse.redirect(new URL(`/api/documents/${row.id}/view`, req.url), 302);
}
