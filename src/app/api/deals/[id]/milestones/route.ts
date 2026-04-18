import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { milestoneQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

async function ensureProjectTables() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_milestones (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stage TEXT,
      target_date DATE,
      completed_at TIMESTAMPTZ,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_tasks (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assignee TEXT,
      due_date DATE,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'todo',
      milestone_id TEXT REFERENCES deal_milestones(id) ON DELETE SET NULL,
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

    let milestones;
    try {
      milestones = await milestoneQueries.getByDealId(params.id);
    } catch {
      await ensureProjectTables();
      milestones = await milestoneQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: milestones });
  } catch (error) {
    console.error("GET /api/deals/[id]/milestones error:", error);
    return NextResponse.json({ error: "Failed to fetch milestones" }, { status: 500 });
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
    const { title, stage, target_date, sort_order } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    let milestone;
    try {
      milestone = await milestoneQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: title.trim(),
        stage: stage || null,
        target_date: target_date || null,
        sort_order: sort_order ?? 0,
      });
    } catch {
      await ensureProjectTables();
      milestone = await milestoneQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: title.trim(),
        stage: stage || null,
        target_date: target_date || null,
        sort_order: sort_order ?? 0,
      });
    }

    return NextResponse.json({ data: milestone });
  } catch (error) {
    console.error("POST /api/deals/[id]/milestones error:", error);
    return NextResponse.json({ error: "Failed to create milestone" }, { status: 500 });
  }
}
