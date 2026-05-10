import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { longLeadQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;
  const items = await longLeadQueries.listByDeal(params.id);
  return NextResponse.json({ data: items });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;
  const body = await req.json();
  if (!body.item?.trim()) {
    return NextResponse.json({ error: "item is required" }, { status: 400 });
  }

  // Auto-derive target_order_date if user supplied required_on_site +
  // lead_time_weeks but didn't set the order-by date themselves. Saves the
  // mental math every time.
  let target_order_date = body.target_order_date || null;
  if (!target_order_date && body.required_on_site && body.lead_time_weeks) {
    const onSite = new Date(`${body.required_on_site}T00:00:00`);
    if (!Number.isNaN(onSite.getTime())) {
      onSite.setDate(onSite.getDate() - Number(body.lead_time_weeks) * 7);
      target_order_date = onSite.toISOString().slice(0, 10);
    }
  }

  const created = await longLeadQueries.create({
    id: uuidv4(),
    deal_id: params.id,
    ...body,
    item: body.item.trim(),
    target_order_date,
  });
  return NextResponse.json({ data: created });
}
