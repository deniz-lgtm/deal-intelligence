import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { taskQueries, milestoneQueries, documentQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

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
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
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

    const existingTasks = await taskQueries.getByDealId(params.id) as Array<{ title: string }>;
    const existingMilestones = await milestoneQueries.getByDealId(params.id) as Array<{ id: string; title: string }>;

    // Build document context
    const docContext = documents.map((d) => {
      const name = d.original_name || d.name;
      const summary = d.ai_summary || "";
      const content = d.content_text ? d.content_text.slice(0, 3000) : "";
      return `[${name}] (${d.category})\n${summary}\n${content}`;
    }).join("\n---\n");

    const existingTasksList = existingTasks.map((t) => t.title).join("\n");
    const existingMilestonesList = existingMilestones.map((m) => m.title).join("\n");

    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are a commercial real estate due diligence expert. Based on the uploaded documents for this deal, suggest additional tasks and milestones that the team should track.

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
    const existingTaskTitles = new Set(existingTasks.map((t) => t.title.toLowerCase()));
    const existingMilestoneTitles = new Set(existingMilestones.map((m) => m.title.toLowerCase()));

    const newTasks = (suggestions.tasks || []).filter(
      (t) => !existingTaskTitles.has(t.title.toLowerCase())
    );
    const newMilestones = (suggestions.milestones || []).filter(
      (m) => !existingMilestoneTitles.has(m.title.toLowerCase())
    );

    // Create milestones first (tasks may reference them)
    const createdMilestones = [];
    for (const m of newMilestones) {
      const milestone = await milestoneQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: m.title,
        stage: m.stage || null,
      });
      createdMilestones.push(milestone);
    }

    // Create tasks
    const createdTasks = [];
    for (const t of newTasks) {
      const task = await taskQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        title: t.title,
        description: t.description || null,
        priority: ["low", "medium", "high", "critical"].includes(t.priority) ? t.priority : "medium",
      });
      createdTasks.push(task);
    }

    return NextResponse.json({
      data: {
        tasks_added: createdTasks.length,
        milestones_added: createdMilestones.length,
        tasks: createdTasks,
        milestones: createdMilestones,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks/ai-suggest error:", error);
    return NextResponse.json({ error: "AI suggestion failed" }, { status: 500 });
  }
}
