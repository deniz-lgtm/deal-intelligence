import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const documents = await documentQueries.getByDealId(params.id);
    return NextResponse.json({ data: documents });
  } catch (error) {
    console.error("GET /api/deals/[id]/documents error:", error);
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 });
  }
}
