import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const documents = await documentQueries.getByDealId(params.id);
    return NextResponse.json({ data: documents });
  } catch (error) {
    console.error("GET /api/deals/[id]/documents error:", error);
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 });
  }
}
