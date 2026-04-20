import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { hardCostQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

async function ensureTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_hardcost_items (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'estimated',
      incurred_date DATE,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    let items;
    try {
      items = await hardCostQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      items = await hardCostQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/deals/[id]/hardcost-items error:", error);
    return NextResponse.json({ error: "Failed to fetch hard cost items" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { category, description, vendor, amount, status, incurred_date, notes } = body;

    if (!category?.trim() || !description?.trim()) {
      return NextResponse.json({ error: "category and description are required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      category: category.trim(),
      description: description.trim(),
      vendor: vendor || null,
      amount: amount ?? 0,
      status: status || "estimated",
      incurred_date: incurred_date || null,
      notes: notes || null,
    };

    let item;
    try {
      item = await hardCostQueries.create(payload);
    } catch {
      await ensureTable();
      item = await hardCostQueries.create(payload);
    }

    return NextResponse.json({ data: item });
  } catch (error) {
    console.error("POST /api/deals/[id]/hardcost-items error:", error);
    return NextResponse.json({ error: "Failed to create hard cost item" }, { status: 500 });
  }
}
