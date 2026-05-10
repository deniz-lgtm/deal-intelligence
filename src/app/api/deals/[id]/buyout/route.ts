import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { buyoutQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;
  const items = await buyoutQueries.listByDeal(params.id);
  return NextResponse.json({ data: items });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;
  const body = await req.json();
  if (!body.trade?.trim()) {
    return NextResponse.json({ error: "trade is required" }, { status: 400 });
  }
  const created = await buyoutQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    ...body,
    trade: body.trade.trim(),
  });
  return NextResponse.json({ data: created });
}
