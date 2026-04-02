import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { taskQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const tasks = await taskQueries.getByDealId(params.id);
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

    const task = await taskQueries.create({
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

    return NextResponse.json({ data: task });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
