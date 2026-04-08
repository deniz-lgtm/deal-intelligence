import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { communicationQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

async function ensureCommunicationsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_communications (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      stakeholder_type TEXT NOT NULL DEFAULT 'broker',
      stakeholder_name TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'email',
      direction TEXT NOT NULL DEFAULT 'outbound',
      subject TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      follow_up_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_deal_communications_deal_id ON deal_communications(deal_id)`
  );
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

    let rows;
    try {
      rows = await communicationQueries.getByDealId(params.id);
    } catch {
      await ensureCommunicationsTable();
      rows = await communicationQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/communications error:", error);
    return NextResponse.json({ error: "Failed to fetch communications" }, { status: 500 });
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
    const {
      stakeholder_type,
      stakeholder_name,
      channel,
      direction,
      subject,
      summary,
      status,
      occurred_at,
      follow_up_at,
    } = body;

    if (!summary?.trim() && !subject?.trim()) {
      return NextResponse.json(
        { error: "subject or summary is required" },
        { status: 400 }
      );
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      stakeholder_type: stakeholder_type || "broker",
      stakeholder_name: (stakeholder_name || "").trim(),
      channel: channel || "email",
      direction: direction || "outbound",
      subject: (subject || "").trim(),
      summary: (summary || "").trim(),
      status: status || "open",
      occurred_at: occurred_at || new Date().toISOString(),
      follow_up_at: follow_up_at || null,
    };

    let row;
    try {
      row = await communicationQueries.create(payload);
    } catch {
      await ensureCommunicationsTable();
      row = await communicationQueries.create(payload);
    }

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/deals/[id]/communications error:", error);
    return NextResponse.json({ error: "Failed to create communication" }, { status: 500 });
  }
}
