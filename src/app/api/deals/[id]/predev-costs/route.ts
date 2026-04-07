import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { preDevCostQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

async function ensurePreDevTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_predev_costs (
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

    let costs;
    try {
      costs = await preDevCostQueries.getByDealId(params.id);
    } catch {
      await ensurePreDevTable();
      costs = await preDevCostQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: costs });
  } catch (error) {
    console.error("GET /api/deals/[id]/predev-costs error:", error);
    return NextResponse.json({ error: "Failed to fetch pre-dev costs" }, { status: 500 });
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

    let cost;
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

    try {
      cost = await preDevCostQueries.create(payload);
    } catch {
      await ensurePreDevTable();
      cost = await preDevCostQueries.create(payload);
    }

    return NextResponse.json({ data: cost });
  } catch (error) {
    console.error("POST /api/deals/[id]/predev-costs error:", error);
    return NextResponse.json({ error: "Failed to create pre-dev cost" }, { status: 500 });
  }
}
