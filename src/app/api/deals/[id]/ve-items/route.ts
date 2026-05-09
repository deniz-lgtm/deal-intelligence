import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { veItemQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;
  const items = await veItemQueries.listByDeal(params.id);
  return NextResponse.json({ data: items });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const created = await veItemQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    title: body.title.trim(),
    description: body.description ?? null,
    proposer: body.proposer ?? null,
    hardcost_item_id: body.hardcost_item_id ?? null,
    cost_savings: body.cost_savings ?? 0,
    schedule_impact_days: body.schedule_impact_days ?? 0,
    scope_impact: body.scope_impact ?? null,
  });
  return NextResponse.json({ data: created });
}
