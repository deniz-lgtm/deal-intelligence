import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { taskQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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

    let tasks;
    try {
      tasks = await taskQueries.getByDealId(params.id);
    } catch {
      await ensureProjectTables();
      tasks = await taskQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: tasks });
  } catch (error) {
    console.error("GET /api/deals/[id]/tasks error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
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
    const { title, description, assignee, due_date, priority, status, milestone_id } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    let task;
    try {
      task = await taskQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: title.trim(),
        description: description || null,
        assignee: assignee || null,
        due_date: due_date || null,
        priority: priority || "medium",
        status: status || "todo",
        milestone_id: milestone_id || null,
      });
    } catch {
      await ensureProjectTables();
      task = await taskQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: title.trim(),
        description: description || null,
        assignee: assignee || null,
        due_date: due_date || null,
        priority: priority || "medium",
        status: status || "todo",
        milestone_id: milestone_id || null,
      });
    }

    return NextResponse.json({ data: task });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
