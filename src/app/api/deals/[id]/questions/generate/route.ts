import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import {
  dealQueries,
  omAnalysisQueries,
  questionQueries,
  documentQueries,
  getPool,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  STAKEHOLDER_LABELS,
  DEAL_STAGE_LABELS,
  DEAL_PIPELINE,
} from "@/lib/types";
import type { StakeholderType, DealStatus } from "@/lib/types";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

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
}

type Body = {
  phase: DealStatus;
  target_role: StakeholderType;
  context: string;
  count?: number;
};

/**
 * Generate a custom set of questions for a stakeholder based on a free-text
 * situation the user describes. The AI pulls deal context and any OM data
 * that's been extracted, then produces questions tailored to both the
 * situation and the role.
 *
 * Example flow: user is about to tour a property with the on-site property
 * manager. They pick role=property_manager, phase=screening, and type:
 * "Site visit tomorrow — want to ask about deferred maintenance, staffing,
 * and anything flagged in the OM".
 *
 * The generated questions are persisted with source='ai'.
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

    const body = (await req.json()) as Body;

    if (!body.phase || !body.target_role || !body.context?.trim()) {
      return NextResponse.json(
        { error: "phase, target_role, and context are required" },
        { status: 400 }
      );
    }

    if (!DEAL_PIPELINE.includes(body.phase)) {
      return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
    }

    // Load deal
    const deal = (await dealQueries.getById(params.id)) as Record<string, unknown> | null;
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Load OM analysis (if any)
    const om = await omAnalysisQueries.getByDealId(params.id);

    // Load a lightweight document index (name + category + short summary) so
    // the AI knows what's available without blowing up the context window.
    const docs = (await documentQueries.getByDealId(params.id)) as Array<{
      name: string;
      original_name: string;
      category: string;
      ai_summary: string | null;
    }>;

    // Build the context block
    const dealName = String(deal.name || "the property");
    const dealAddress = [deal.address, deal.city, deal.state].filter(Boolean).join(", ");
    const propertyType = String(deal.property_type || "unknown");

    const dealBlock = `DEAL: ${dealName}${dealAddress ? " — " + dealAddress : ""}
Property type: ${propertyType}
Current stage: ${DEAL_STAGE_LABELS[deal.status as DealStatus] || String(deal.status)}
${deal.asking_price ? `Asking price: $${Number(deal.asking_price).toLocaleString()}` : ""}
${deal.square_footage ? `SF: ${Number(deal.square_footage).toLocaleString()}` : ""}
${deal.units ? `Units: ${deal.units}` : ""}
${deal.year_built ? `Year built: ${deal.year_built}` : ""}`;

    const omBlock = om
      ? `OM EXTRACTED DATA:
${om.summary ? `Summary: ${om.summary}` : ""}
${om.noi ? `NOI: $${Number(om.noi).toLocaleString()}` : ""}
${om.cap_rate ? `Cap rate: ${om.cap_rate}%` : ""}
${om.vacancy_rate ? `Vacancy: ${om.vacancy_rate}%` : ""}
${om.expense_ratio ? `Expense ratio: ${om.expense_ratio}%` : ""}
${om.rent_growth ? `Rent growth assumption: ${om.rent_growth}` : ""}
${om.red_flags && om.red_flags.length > 0 ? `Red flags flagged in OM review:\n${om.red_flags.map((r) => `- [${r.severity}] ${r.category}: ${r.description}`).join("\n")}` : ""}
${om.recommendations && om.recommendations.length > 0 ? `Recommendations from OM review:\n${om.recommendations.map((r) => `- ${r}`).join("\n")}` : ""}`
      : "(no OM analysis available yet)";

    const docsBlock = docs.length
      ? `DOCUMENTS AVAILABLE ON THIS DEAL:
${docs
  .slice(0, 15)
  .map((d) => `- ${d.original_name || d.name} (${d.category})${d.ai_summary ? " — " + d.ai_summary.slice(0, 150) : ""}`)
  .join("\n")}`
      : "(no documents uploaded yet)";

    // Load existing questions for this phase/role to avoid duplicates
    const existingQuestions = (await questionQueries.getByDealId(params.id)) as Array<{
      question: string;
      target_role: string;
      phase: string;
    }>;
    const existingForRole = existingQuestions
      .filter((q) => q.target_role === body.target_role && q.phase === body.phase)
      .map((q) => q.question);

    const roleLabel = STAKEHOLDER_LABELS[body.target_role];
    const phaseLabel = DEAL_STAGE_LABELS[body.phase];
    const count = Math.min(Math.max(body.count || 8, 3), 15);

    const prompt = `You are helping a commercial real estate investment professional prepare questions to ask a ${roleLabel} during the ${phaseLabel} phase of a deal.

${dealBlock}

${omBlock}

${docsBlock}

USER'S SITUATION / CONTEXT:
${body.context.trim()}

EXISTING QUESTIONS ALREADY QUEUED for this role + phase (do NOT duplicate these):
${existingForRole.length > 0 ? existingForRole.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none)"}

Generate ${count} sharp, specific questions to ask the ${roleLabel} that:
- Directly address the user's situation described above
- Reference specific numbers, red flags, or documents from the deal context when relevant
- Are phrased as actual questions a principal would ask — direct, specific, and actionable
- Are appropriate for a ${roleLabel}'s knowledge and role (don't ask the property manager about lender terms)
- Avoid duplicating the existing queued questions
- Are diverse — don't ask three variants of the same question

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "questions": [
    "First question?",
    "Second question?",
    ...
  ]
}`;

    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI generate questions returned no JSON:", text.slice(0, 500));
      return NextResponse.json({ error: "AI returned invalid format" }, { status: 500 });
    }

    let parsed: { questions: string[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "AI returned malformed JSON" }, { status: 500 });
    }

    const rawQuestions = (parsed.questions || [])
      .map((q) => (typeof q === "string" ? q.trim() : ""))
      .filter(Boolean);

    if (rawQuestions.length === 0) {
      return NextResponse.json({ error: "AI returned no questions" }, { status: 500 });
    }

    // Dedup against existing
    const existingLower = new Set(existingForRole.map((q) => q.toLowerCase()));
    const newQuestions = rawQuestions.filter((q) => !existingLower.has(q.toLowerCase()));

    // Persist
    const rows = newQuestions.map((q, i) => ({
      id: uuidv4(),
      deal_id: params.id,
      target_role: body.target_role,
      phase: body.phase,
      question: q,
      status: "open",
      source: "ai",
      sort_order: i,
    }));

    let created;
    try {
      created = await questionQueries.createMany(rows);
    } catch {
      await ensureQuestionsTable();
      created = await questionQueries.createMany(rows);
    }

    return NextResponse.json({
      data: {
        questions: created,
        count: created.length,
        model: response.model,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/questions/generate error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate questions: ${message}` },
      { status: 500 }
    );
  }
}
