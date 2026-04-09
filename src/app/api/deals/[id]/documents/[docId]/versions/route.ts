import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * GET /api/deals/[id]/documents/[docId]/versions
 *
 * Returns the full version chain for the document (oldest → newest),
 * anchored at the root of the chain. Works whether you pass the v1, the
 * latest, or any middle version — the helper walks up to root and back
 * down.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const chain = await documentQueries.getVersionChain(params.docId);
    return NextResponse.json({ data: chain });
  } catch (error) {
    console.error(
      "GET /api/deals/[id]/documents/[docId]/versions error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch version chain" },
      { status: 500 }
    );
  }
}
