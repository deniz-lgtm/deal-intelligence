import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { questionQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { STAGE_QUESTION_TEMPLATES } from "@/lib/types";
import type { DealStatus } from "@/lib/types";

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

/**
 * Generate a starter set of questions for the requested phase(s).
 *
 * Body:
 *   { phase?: DealStatus, phases?: DealStatus[], persist?: boolean }
 *
 * If `persist` is true, the suggestions are inserted into deal_questions
 * with source='template'. Otherwise the suggestions are returned without
 * being saved.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const phases: DealStatus[] = Array.isArray(body.phases)
      ? body.phases
      : body.phase
      ? [body.phase as DealStatus]
      : [];
    const persist = body.persist !== false;

    if (phases.length === 0) {
      return NextResponse.json({ error: "phase or phases is required" }, { status: 400 });
    }

    const suggestions: Array<{
      target_role: string;
      question: string;
      phase: DealStatus;
    }> = [];

    for (const phase of phases) {
      const items = STAGE_QUESTION_TEMPLATES[phase] ?? [];
      for (const item of items) {
        suggestions.push({ ...item, phase });
      }
    }

    if (!persist) {
      return NextResponse.json({ data: suggestions });
    }

    const rows = suggestions.map((s, i) => ({
      id: uuidv4(),
      deal_id: params.id,
      target_role: s.target_role,
      phase: s.phase,
      question: s.question,
      status: "open",
      source: "template",
      sort_order: i,
    }));

    let created;
    try {
      created = await questionQueries.createMany(rows);
    } catch {
      await ensureQuestionsTable();
      created = await questionQueries.createMany(rows);
    }

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error("POST /api/deals/[id]/questions/suggest error:", error);
    return NextResponse.json({ error: "Failed to suggest questions" }, { status: 500 });
  }
}
