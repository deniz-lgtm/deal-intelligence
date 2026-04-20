import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { vendorQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

async function ensureTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_vendors (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Other',
      company TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'prospective',
      engagement_date DATE,
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

    let vendors;
    try {
      vendors = await vendorQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      vendors = await vendorQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: vendors });
  } catch (error) {
    console.error("GET /api/deals/[id]/vendors error:", error);
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
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
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      name: body.name.trim(),
      role: body.role || "Other",
      company: body.company || null,
      email: body.email || null,
      phone: body.phone || null,
      status: body.status || "prospective",
      engagement_date: body.engagement_date || null,
      notes: body.notes || null,
    };

    let vendor;
    try {
      vendor = await vendorQueries.create(payload);
    } catch {
      await ensureTable();
      vendor = await vendorQueries.create(payload);
    }

    return NextResponse.json({ data: vendor });
  } catch (error) {
    console.error("POST /api/deals/[id]/vendors error:", error);
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 500 });
  }
}
