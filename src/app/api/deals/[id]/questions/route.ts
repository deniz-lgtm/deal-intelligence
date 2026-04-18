import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { questionQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

async function ensureQuestionsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_questions (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      target_role TEXT NOT NULL DEFAULT 'broker',
      phase TEXT NOT NULL DEFAULT 'sourcing',
      question TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'manual',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_deal_questions_deal_id ON deal_questions(deal_id)`
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
      rows = await questionQueries.getByDealId(params.id);
    } catch {
      await ensureQuestionsTable();
      rows = await questionQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/questions error:", error);
    return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 });
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
    const { question, target_role, phase, status, source, answer, sort_order } = body;

    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      target_role: target_role || "broker",
      phase: phase || "sourcing",
      question: question.trim(),
      answer: answer ?? null,
      status: status || "open",
      source: source || "manual",
      sort_order: sort_order ?? 0,
    };

    let row;
    try {
      row = await questionQueries.create(payload);
    } catch {
      await ensureQuestionsTable();
      row = await questionQueries.create(payload);
    }

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/deals/[id]/questions error:", error);
    return NextResponse.json({ error: "Failed to create question" }, { status: 500 });
  }
}
