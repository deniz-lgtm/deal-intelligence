import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries, documentQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { CONCISE_STYLE } from "@/lib/ai-style";
import {
  phaseKeyForMilestone,
  phaseToMilestoneShape,
  phaseToTaskShape,
} from "@/lib/legacy-schedule-compat";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id) as Record<string, unknown> | null;
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const documents = await documentQueries.getByDealId(params.id) as Array<{
      id: string;
      name: string;
      original_name: string;
      category: string;
      content_text: string | null;
      ai_summary: string | null;
    }>;

    if (documents.length === 0) {
      return NextResponse.json({ error: "No documents uploaded yet. Upload documents first so AI can suggest tasks and milestones." }, { status: 400 });
    }

    // Read existing tasks/milestones from the unified table so the AI
    // dedupe set covers rows added through both the legacy compat
    // wrapper and the new /schedule endpoint.
    const existingTasks = (await devPhaseQueries.getFiltered({
      deal_id: params.id,
      kind: "task",
    })) as DevPhase[];
    const existingMilestones = (await devPhaseQueries.getFiltered({
      deal_id: params.id,
      kind: "milestone",
    })) as DevPhase[];

    // Build document context
    const docContext = documents.map((d) => {
      const name = d.original_name || d.name;
      const summary = d.ai_summary || "";
      const content = d.content_text ? d.content_text.slice(0, 3000) : "";
      return `[${name}] (${d.category})\n${summary}\n${content}`;
    }).join("\n---\n");

    const existingTasksList = existingTasks.map((t) => t.label).join("\n");
    const existingMilestonesList = existingMilestones.map((m) => m.label).join("\n");

    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `${CONCISE_STYLE}

You are a commercial real estate due diligence expert. Based on the uploaded documents for this deal, suggest additional tasks and milestones that the team should track.

Deal: ${deal.name}
Property type: ${deal.property_type}
Status: ${deal.status}
Address: ${deal.address}, ${deal.city}, ${deal.state}

EXISTING MILESTONES (do NOT duplicate these):
${existingMilestonesList || "(none)"}

EXISTING TASKS (do NOT duplicate these):
${existingTasksList || "(none)"}

UPLOADED DOCUMENTS:
${docContext}

Based on the documents, suggest:
1. New TASKS that are specific to this deal's documents (e.g., "Review ABC lease expiring 2025", "Follow up on Phase I REC finding", "Verify roof warranty from inspection report")
2. New MILESTONES if there are important deal-specific deadlines or checkpoints found in the documents

Respond ONLY with valid JSON in this exact format:
{
  "tasks": [
    { "title": "string", "priority": "low|medium|high|critical", "description": "string" }
  ],
  "milestones": [
    { "title": "string", "stage": "sourcing|screening|loi|under_contract|diligence|closing" }
  ]
}

Keep suggestions specific and actionable based on what you found in the documents. Do NOT suggest generic tasks that duplicate existing ones. Return 3-10 tasks and 0-5 milestones.`,
        },
      ],
    });

    // Parse response
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI returned invalid format" }, { status: 500 });
    }

    const suggestions = JSON.parse(jsonMatch[0]) as {
      tasks: Array<{ title: string; priority: string; description?: string }>;
      milestones: Array<{ title: string; stage?: string }>;
    };

    // Deduplicate against existing
    const existingTaskTitles = new Set(existingTasks.map((t) => t.label.toLowerCase()));
    const existingMilestoneTitles = new Set(existingMilestones.map((m) => m.label.toLowerCase()));

    const newTasks = (suggestions.tasks || []).filter(
      (t) => !existingTaskTitles.has(t.title.toLowerCase())
    );
    const newMilestones = (suggestions.milestones || []).filter(
      (m) => !existingMilestoneTitles.has(m.title.toLowerCase())
    );

    // Create milestones first as deal_dev_phases (kind='milestone') so
    // suggested tasks can reference them via parent_phase_id.
    const createdMilestones: DevPhase[] = [];
    for (const m of newMilestones) {
      const milestone = await devPhaseQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        track: "development",
        kind: "milestone",
        phase_key: phaseKeyForMilestone(m.stage),
        label: m.title,
        is_milestone: true,
        duration_days: 0,
        status: "not_started",
      });
      createdMilestones.push(milestone as DevPhase);
    }

    // Create tasks. priority isn't tracked on the unified model; the
    // AI's suggestion still surfaces the priority so we drop it on the
    // floor here (the task's sort_order + critical-path drives ordering
    // in the new model).
    const createdTasks: DevPhase[] = [];
    for (const t of newTasks) {
      const task = await devPhaseQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        track: "development",
        kind: "task",
        phase_key: "legacy_task",
        label: t.title,
        notes: t.description || null,
        is_milestone: false,
        duration_days: 1,
        status: "not_started",
      });
      createdTasks.push(task as DevPhase);
    }

    if (createdTasks.length > 0 || createdMilestones.length > 0) {
      try {
        await recomputeSchedule(params.id);
      } catch (err) {
        console.error("POST /api/deals/[id]/tasks/ai-suggest recompute error:", err);
      }
    }

    return NextResponse.json({
      data: {
        tasks_added: createdTasks.length,
        milestones_added: createdMilestones.length,
        tasks: createdTasks.map(phaseToTaskShape),
        milestones: createdMilestones.map(phaseToMilestoneShape),
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks/ai-suggest error:", error);
    return NextResponse.json({ error: "AI suggestion failed" }, { status: 500 });
  }
}
