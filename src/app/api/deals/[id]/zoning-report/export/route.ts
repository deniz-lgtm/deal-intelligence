import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deprecated. Zoning Report exports now flow through the unified
 * artifact pipeline.
 *
 * Replacement: POST /api/deals/[id]/artifacts
 *   body: { kind: "zoning_report",
 *           payload: { dealName, siteInfo, zoningInfo, devParams, narrative } }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    {
      error: "endpoint_gone",
      message:
        "This export endpoint has moved. Use POST /api/deals/[id]/artifacts with { kind: 'zoning_report', payload: { dealName, siteInfo, zoningInfo, devParams, narrative } }. The generated PDF lands in Reports & Packages.",
      replacement: `/api/deals/${params.id}/artifacts`,
    },
    { status: 410 }
  );
}
