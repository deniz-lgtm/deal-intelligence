import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealContactQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

async function ensureDealContactsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_contacts (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      role_on_deal TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(deal_id, contact_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_deal_contacts_deal_id ON deal_contacts(deal_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_deal_contacts_contact_id ON deal_contacts(contact_id)`
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
      rows = await dealContactQueries.getByDealId(params.id);
    } catch {
      await ensureDealContactsTable();
      rows = await dealContactQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/contacts error:", error);
    return NextResponse.json({ error: "Failed to fetch deal contacts" }, { status: 500 });
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
    if (!body.contact_id) {
      return NextResponse.json({ error: "contact_id is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      contact_id: body.contact_id,
      role_on_deal: body.role_on_deal?.trim() || null,
      notes: body.notes?.trim() || null,
    };

    let row;
    try {
      row = await dealContactQueries.link(payload);
    } catch {
      await ensureDealContactsTable();
      row = await dealContactQueries.link(payload);
    }

    if (!row) {
      return NextResponse.json(
        { error: "Contact is already linked to this deal" },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error("POST /api/deals/[id]/contacts error:", error);
    return NextResponse.json({ error: "Failed to link contact" }, { status: 500 });
  }
}
