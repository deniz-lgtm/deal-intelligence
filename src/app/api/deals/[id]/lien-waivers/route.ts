import { NextRequest, NextResponse } from "next/server";
import { lienWaiverQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;
  const items = await lienWaiverQueries.listByDeal(params.id);
  return NextResponse.json({ data: items });
}
