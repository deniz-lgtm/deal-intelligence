import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

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

    // Confirm the doc belongs to this deal before walking the version
    // chain — getVersionChain follows parent_document_id ancestors and
    // would happily return another deal's chain if we hand it any docId.
    const doc = await documentQueries.getById(params.docId);
    if (!doc || doc.deal_id !== params.id) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

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
