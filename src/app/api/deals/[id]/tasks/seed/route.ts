import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { milestoneQueries, taskQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { DEFAULT_MILESTONES, DEFAULT_TASKS } from "@/lib/types";

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

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    // Ensure tables exist before querying
    await ensureProjectTables();

    // Check if already seeded (has any milestones or tasks)
    const existingMilestones = await milestoneQueries.getByDealId(params.id);
    const existingTasks = await taskQueries.getByDealId(params.id);

    if (existingMilestones.length > 0 || existingTasks.length > 0) {
      return NextResponse.json({
        data: { milestones: existingMilestones, tasks: existingTasks, seeded: false },
      });
    }

    // Seed milestones
    const milestoneMap = new Map<string, string>(); // title -> id
    for (let i = 0; i < DEFAULT_MILESTONES.length; i++) {
      const m = DEFAULT_MILESTONES[i];
      const id = uuidv4();
      milestoneMap.set(m.title, id);
      await milestoneQueries.create({
        id,
        deal_id: params.id,
        title: m.title,
        stage: m.stage,
        sort_order: i,
      });
    }

    // Seed tasks, linking to milestones by title
    for (let i = 0; i < DEFAULT_TASKS.length; i++) {
      const t = DEFAULT_TASKS[i];
      const milestoneId = t.milestone_title ? milestoneMap.get(t.milestone_title) || null : null;
      await taskQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: t.title,
        priority: t.priority,
        milestone_id: milestoneId,
        sort_order: i,
      });
    }

    const milestones = await milestoneQueries.getByDealId(params.id);
    const tasks = await taskQueries.getByDealId(params.id);

    return NextResponse.json({
      data: { milestones, tasks, seeded: true },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks/seed error:", error);
    return NextResponse.json({ error: "Failed to seed project data" }, { status: 500 });
  }
}
