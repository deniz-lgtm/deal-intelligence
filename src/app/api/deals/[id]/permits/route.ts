import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { permitQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

async function ensureTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_permits (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      permit_type TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      submitted_date DATE,
      expected_date DATE,
      actual_date DATE,
      fee NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_submitted',
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

    let permits;
    try {
      permits = await permitQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      permits = await permitQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: permits });
  } catch (error) {
    console.error("GET /api/deals/[id]/permits error:", error);
    return NextResponse.json({ error: "Failed to fetch permits" }, { status: 500 });
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
    if (!body.permit_type?.trim()) {
      return NextResponse.json({ error: "permit_type is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      permit_type: body.permit_type.trim(),
      jurisdiction: body.jurisdiction || "",
      description: body.description || "",
      submitted_date: body.submitted_date || null,
      expected_date: body.expected_date || null,
      actual_date: body.actual_date || null,
      fee: body.fee ?? 0,
      status: body.status || "not_submitted",
      notes: body.notes || null,
    };

    let permit;
    try {
      permit = await permitQueries.create(payload);
    } catch {
      await ensureTable();
      permit = await permitQueries.create(payload);
    }

    return NextResponse.json({ data: permit });
  } catch (error) {
    console.error("POST /api/deals/[id]/permits error:", error);
    return NextResponse.json({ error: "Failed to create permit" }, { status: 500 });
  }
}
