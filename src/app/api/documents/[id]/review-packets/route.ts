import { NextRequest, NextResponse } from "next/server";
import { documentQueries, documentReviewPacketQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const doc = await documentQueries.getById(params.id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const { errorResponse: accessError } = await requireDealAccess(String(doc.deal_id), userId);
    if (accessError) return accessError;

    const packets = await documentReviewPacketQueries.listByDocumentId(params.id);
    return NextResponse.json({ data: packets });
  } catch (error) {
    console.error("GET /api/documents/[id]/review-packets error:", error);
    return NextResponse.json({ error: "Failed to fetch review packets" }, { status: 500 });
  }
}
