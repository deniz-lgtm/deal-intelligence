import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase, ScheduleTrack } from "@/lib/types";

export const dynamic = "force-dynamic";

type MiniScheduleTaskInput = {
  label?: unknown;
  duration_days?: unknown;
  task_owner?: unknown;
  notes?: unknown;
};

type ResolvedParent = {
  id: string;
  label: string;
  track: ScheduleTrack;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = (await req.json()) as {
      parent_phase_id?: string | null;
      parent_phase_label?: string | null;
      track?: ScheduleTrack;
      tasks?: MiniScheduleTaskInput[];
    };

    const tasks = (Array.isArray(body.tasks) ? body.tasks : [])
      .filter((task) => typeof task.label === "string" && task.label.trim())
      .slice(0, 12)
      .map((task) => ({
        label: String(task.label).trim(),
        duration_days: typeof task.duration_days === "number" ? task.duration_days : null,
        task_owner:
          typeof task.task_owner === "string" && task.task_owner.trim()
            ? task.task_owner.trim()
            : null,
        notes: typeof task.notes === "string" && task.notes.trim() ? task.notes.trim() : null,
      }));

    if (tasks.length === 0) {
      return NextResponse.json({ error: "At least one task label is required" }, { status: 400 });
    }

    const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const parent = resolveParent(phases, body.parent_phase_id ?? null, body.parent_phase_label ?? null);
    if (!parent) {
      return NextResponse.json(
        { error: "Parent phase not found in this deal" },
        { status: 400 }
      );
    }

    const existingChildren = phases.filter((phase) => phase.parent_phase_id === parent.id);
    const existingByLabel = new Map(
      existingChildren.map((phase) => [normalizeLabel(phase.label), phase])
    );
    const baseSort = existingChildren.reduce(
      (max, phase) => Math.max(max, Number(phase.sort_order ?? 0)),
      existingChildren.length
    );

    const created: DevPhase[] = [];
    const stamp = Date.now();
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const existing = existingByLabel.get(normalizeLabel(task.label));
      if (existing) {
        created.push(existing);
        continue;
      }
      const row = (await devPhaseQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        track: parent.track,
        kind: "task",
        phase_key: `mini_${stamp}_${index}`,
        label: task.label,
        duration_days: task.duration_days,
        parent_phase_id: parent.id,
        task_owner: task.task_owner,
        notes: task.notes,
        status: "not_started",
        pct_complete: 0,
        sort_order: baseSort + index + 1,
        is_milestone: false,
      })) as DevPhase;
      created.push(row);
    }

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("POST /api/deals/[id]/schedule/mini recompute error:", err);
    }

    return NextResponse.json(
      {
        data: {
          parent,
          tasks: created,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/deals/[id]/schedule/mini error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create task plan", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}

function resolveParent(
  phases: DevPhase[],
  parentId?: string | null,
  parentLabel?: string | null
): ResolvedParent | null {
  if (parentId) {
    const exact = phases.find((phase) => phase.id === parentId);
    if (exact) return { id: exact.id, label: exact.label, track: exact.track };
  }

  const normalized = normalizeLabel(parentLabel);
  if (!normalized) return null;

  const exactLabel = phases.find((phase) => normalizeLabel(phase.label) === normalized);
  const fuzzy =
    exactLabel ??
    phases.find((phase) => {
      const label = normalizeLabel(phase.label);
      return label.includes(normalized) || normalized.includes(label);
    });

  return fuzzy ? { id: fuzzy.id, label: fuzzy.label, track: fuzzy.track } : null;
}

function normalizeLabel(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
