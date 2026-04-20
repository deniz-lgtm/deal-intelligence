import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// GET: Load saved package data (stored in underwriting table as a sibling key)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const pool = getPool();
    const res = await pool.query(
      "SELECT data FROM underwriting WHERE deal_id = $1",
      [params.id]
    );
    if (!res.rows[0]) {
      return NextResponse.json({ data: null });
    }
    const raw = res.rows[0].data;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json({ data: { sections: parsed?.investment_package_sections || null, meta: parsed?.investment_package_meta || null } });
  } catch (error) {
    console.error("GET investment-package error:", error);
    return NextResponse.json({ data: null });
  }
}

// POST: Save package data
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    const { sections, meta } = await req.json();
    const pool = getPool();

    // Load existing UW data, merge in the investment package
    const existing = await pool.query("SELECT data FROM underwriting WHERE deal_id = $1", [params.id]);
    if (existing.rows[0]) {
      const raw = existing.rows[0].data;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      parsed.investment_package_sections = sections;
      if (meta) parsed.investment_package_meta = meta;
      await pool.query(
        "UPDATE underwriting SET data = $1, updated_at = NOW() WHERE deal_id = $2",
        [JSON.stringify(parsed), params.id]
      );
    } else {
      const data = { investment_package_sections: sections };
      const { v4: uuidv4 } = await import("uuid");
      await pool.query(
        "INSERT INTO underwriting (id, deal_id, data) VALUES ($1, $2, $3)",
        [uuidv4(), params.id, JSON.stringify(data)]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST investment-package error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
