import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deprecated. DD Abstract exports now flow through the unified
 * artifact pipeline. Returns 410 Gone with a hint pointing at the
 * replacement endpoint so any cached bookmarks or stale clients see
 * a clear migration path.
 *
 * Replacement: POST /api/deals/[id]/artifacts
 *   body: { kind: "dd_abstract", payload: { markdown, dealName } }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    {
      error: "endpoint_gone",
      message:
        "This export endpoint has moved. Use POST /api/deals/[id]/artifacts with { kind: 'dd_abstract', payload: { markdown, dealName } }. The generated PDF lands in Reports & Packages.",
      replacement: `/api/deals/${params.id}/artifacts`,
    },
    { status: 410 }
  );
}
