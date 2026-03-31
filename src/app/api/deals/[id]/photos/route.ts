import { NextResponse } from "next/server";
import { photoQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const photos = await photoQueries.getByDealId(params.id);
    return NextResponse.json({ data: photos });
  } catch (err) {
    console.error("Error fetching photos:", err);
    return NextResponse.json({ error: "Failed to fetch photos" }, { status: 500 });
  }
}
