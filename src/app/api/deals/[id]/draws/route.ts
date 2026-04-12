import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { drawQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

async function ensureTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_draws (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      draw_number INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_date DATE,
      approved_date DATE,
      funded_date DATE,
      amount_requested NUMERIC NOT NULL DEFAULT 0,
      amount_approved NUMERIC,
      retainage_held NUMERIC NOT NULL DEFAULT 0,
      pct_complete_claimed INTEGER NOT NULL DEFAULT 0,
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

    let draws;
    try {
      draws = await drawQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      draws = await drawQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: draws });
  } catch (error) {
    console.error("GET /api/deals/[id]/draws error:", error);
    return NextResponse.json({ error: "Failed to fetch draws" }, { status: 500 });
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

    // Auto-assign draw number if not provided
    let drawNumber = body.draw_number;
    if (!drawNumber) {
      let existing;
      try {
        existing = await drawQueries.getByDealId(params.id);
      } catch {
        await ensureTable();
        existing = await drawQueries.getByDealId(params.id);
      }
      drawNumber = existing.length + 1;
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      draw_number: drawNumber,
      title: body.title || `Draw #${drawNumber}`,
      status: body.status || "draft",
      submitted_date: body.submitted_date || null,
      approved_date: body.approved_date || null,
      funded_date: body.funded_date || null,
      amount_requested: body.amount_requested ?? 0,
      amount_approved: body.amount_approved ?? null,
      retainage_held: body.retainage_held ?? 0,
      pct_complete_claimed: body.pct_complete_claimed ?? 0,
      notes: body.notes || null,
    };

    let draw;
    try {
      draw = await drawQueries.create(payload);
    } catch {
      await ensureTable();
      draw = await drawQueries.create(payload);
    }

    return NextResponse.json({ data: draw });
  } catch (error) {
    console.error("POST /api/deals/[id]/draws error:", error);
    return NextResponse.json({ error: "Failed to create draw" }, { status: 500 });
  }
}
