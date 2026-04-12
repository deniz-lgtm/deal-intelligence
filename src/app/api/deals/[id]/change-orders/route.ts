import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { changeOrderQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

async function ensureTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_change_orders (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      co_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      submitted_by TEXT,
      cost_impact NUMERIC NOT NULL DEFAULT 0,
      schedule_impact_days INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_date DATE,
      decided_date DATE,
      hardcost_category TEXT,
      notes TEXT,
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
      items = await changeOrderQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      items = await changeOrderQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/deals/[id]/change-orders error:", error);
    return NextResponse.json({ error: "Failed to fetch change orders" }, { status: 500 });
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
    const { title, description, submitted_by, cost_impact, schedule_impact_days, status, submitted_date, decided_date, hardcost_category, notes } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    // Auto-assign co_number from existing count + 1
    let existing;
    try {
      existing = await changeOrderQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      existing = await changeOrderQueries.getByDealId(params.id);
    }
    const co_number = existing.length > 0
      ? Math.max(...existing.map((co: { co_number: number }) => co.co_number)) + 1
      : 1;

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      co_number,
      title: title.trim(),
      description: description || "",
      submitted_by: submitted_by || null,
      cost_impact: cost_impact ?? 0,
      schedule_impact_days: schedule_impact_days ?? 0,
      status: status || "draft",
      submitted_date: submitted_date || null,
      decided_date: decided_date || null,
      hardcost_category: hardcost_category || null,
      notes: notes || null,
    };

    let item;
    try {
      item = await changeOrderQueries.create(payload);
    } catch {
      await ensureTable();
      item = await changeOrderQueries.create(payload);
    }

    return NextResponse.json({ data: item });
  } catch (error) {
    console.error("POST /api/deals/[id]/change-orders error:", error);
    return NextResponse.json({ error: "Failed to create change order" }, { status: 500 });
  }
}
