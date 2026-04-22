import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deprecated. Proforma PDF exports now flow through the unified
 * artifact pipeline.
 *
 * Replacement: POST /api/deals/[id]/artifacts
 *   body: { kind: "proforma_pdf", payload: { uwData, mode } }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    {
      error: "endpoint_gone",
      message:
        "This export endpoint has moved. Use POST /api/deals/[id]/artifacts with { kind: 'proforma_pdf', payload: { uwData, mode } }. The generated PDF lands in Reports & Packages.",
      replacement: `/api/deals/${params.id}/artifacts`,
    },
    { status: 410 }
  );
}
