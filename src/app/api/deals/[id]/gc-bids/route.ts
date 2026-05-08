import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { gcBidQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET → full leveling payload (bids + canonical scope items + bid_items + questions)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const data = await gcBidQueries.getFullLeveling(params.id);
  return NextResponse.json({ data });
}

// POST → create a new bid (manual entry; AI extraction is a separate step)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const body = await req.json();
  if (!body.contractor_name?.trim()) {
    return NextResponse.json({ error: "contractor_name is required" }, { status: 400 });
  }

  const created = await gcBidQueries.createBid({
    id: uuidv4(),
    deal_id: params.id,
    contractor_name: body.contractor_name.trim(),
    contractor_company: body.contractor_company || null,
    contractor_email: body.contractor_email || null,
    bid_date: body.bid_date || null,
    total_amount: body.total_amount ?? null,
    status: body.status || "received",
    source_document_id: body.source_document_id || null,
    raw_text: body.raw_text || null,
    notes: body.notes || null,
  });
  return NextResponse.json({ data: created });
}
