import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveModel } from "@/lib/claude";
import { dealQueries, devPhaseQueries, underwritingQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import type { DevPhase, TaskCategory } from "@/lib/types";

/**
 * POST /api/deals/[id]/dev-schedule/suggest-entitlement-tasks
 *
 * Asks Claude to propose entitlement tasks tailored to the specific
 * jurisdiction, property type, and any programs the analyst has spotted
 * (SB 35, CCHS, etc.) on Site & Zoning. The response is a preview — the
 * client lets the user pick which tasks to add as children of the
 * entitlements parent.
 *
 * We don't blindly create the tasks server-side: keeping it preview-only
 * means the analyst stays in control of what lands on the schedule, and
 * the AI doesn't silently duplicate things the user already added.
 */

interface SuggestedTask {
  label: string;
  duration_days: number;
  category: TaskCategory;
  rationale: string;
}

function parseJsonArray(text: string): unknown[] | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const VALID_CATEGORIES = new Set<TaskCategory>([
  "pre_submittal",
  "review",
  "approval",
  "permit",
  "other",
]);

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    // Pull the context the model needs to reason about this deal.
    const [deal, uwRow, phases] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      devPhaseQueries.getByDealId(params.id) as Promise<DevPhase[]>,
    ]);

    const uw = uwRow?.data
      ? typeof uwRow.data === "string"
        ? JSON.parse(uwRow.data)
        : (uwRow.data as Record<string, unknown>)
      : {};

    const jurisdiction = [
      (deal as { city?: string | null })?.city,
      (deal as { state?: string | null })?.state,
    ]
      .filter(Boolean)
      .join(", ") || "Unknown jurisdiction";

    const zoningInfo = (uw.zoning_info as Record<string, unknown>) || {};
    const zoningDesignation =
      (zoningInfo.zoning_designation as string) ||
      (uw.zoning_designation as string) ||
      "Unknown";
    const overlays: string[] = Array.isArray(zoningInfo.overlays)
      ? (zoningInfo.overlays as string[])
      : [];
    const spottedBonuses: string[] = Array.isArray(zoningInfo.density_bonuses)
      ? (zoningInfo.density_bonuses as Array<{ source?: string }>)
          .map((b) => b?.source)
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    const zoneChange = zoningInfo.zone_change_needed
      ? `Requires zone change from ${zoningInfo.zone_change_from || "?"} to ${zoningInfo.zone_change_to || "?"} (${zoningInfo.zone_change_notes || "no pathway"})`
      : null;

    // Existing child tasks so the model can avoid proposing duplicates.
    const entitlementsPhase = phases.find(
      (p) => p.phase_key === "entitlements"
    );
    const existingChildren = entitlementsPhase
      ? phases.filter((p) => p.parent_phase_id === entitlementsPhase.id)
      : [];
    const existingLabels = existingChildren.map((p) => p.label);

    const contextLines = [
      `Deal: ${(deal as { name?: string })?.name || "Unnamed"}`,
      `Address: ${(deal as { address?: string | null })?.address || "Unknown"}`,
      `Jurisdiction: ${jurisdiction}`,
      `Property type: ${(deal as { property_type?: string | null })?.property_type || "unknown"}`,
      `Investment strategy: ${(deal as { investment_strategy?: string | null })?.investment_strategy || "unknown"}`,
      `Zoning: ${zoningDesignation}${overlays.length > 0 ? ` (overlays: ${overlays.join(", ")})` : ""}`,
      zoneChange,
      spottedBonuses.length > 0
        ? `Spotted programs: ${spottedBonuses.join("; ")}`
        : null,
      existingLabels.length > 0
        ? `Already on the schedule — DO NOT duplicate:\n  • ${existingLabels.join("\n  • ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `You are a land-use / entitlements expert. Propose the specific
entitlement tasks this project will need, tailored to the jurisdiction,
zoning, and spotted programs.

${contextLines}

Return ONLY a JSON array of task objects — no markdown fences, no prose
outside the array. Each task object MUST have exactly these fields:

[
  {
    "label": "Short task name (e.g. 'SF Pre-App Meeting with Planner')",
    "duration_days": 30,
    "category": "pre_submittal" | "review" | "approval" | "permit" | "other",
    "rationale": "One sentence why this task applies to this jurisdiction / program"
  }
]

Rules:
- 6–12 tasks total. Fewer is fine if the approval path is short (e.g. by-right).
- Prefer jurisdiction-specific tasks ("SF 311 Notice", "LA Area Planning Commission", "Seattle SEPA Checklist") over generic ones.
- Incorporate the spotted programs' filings — they should be distinct, dated tasks.
- Assign category honestly: pre_submittal for work before the formal clock starts, review for staff / commission review between filing and decision, approval for decisions / hearings / appeal windows, permit for final permit issuance.
- duration_days should reflect typical calendar timelines in that jurisdiction. Use conservative estimates.
- DO NOT propose any task already listed under "Already on the schedule".
- Keep labels under 60 characters.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: await getActiveModel(),
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const rawText =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = parseJsonArray(rawText);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 502 }
      );
    }

    // Normalize + filter out dupes against existing labels (case-insensitive)
    const existingKey = new Set(existingLabels.map((l) => l.trim().toLowerCase()));
    const tasks: SuggestedTask[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object") continue;
      const t = raw as Record<string, unknown>;
      const label = typeof t.label === "string" ? t.label.trim() : "";
      if (!label) continue;
      if (existingKey.has(label.toLowerCase())) continue;
      const duration = Math.max(1, Math.round(Number(t.duration_days) || 30));
      const rawCat = typeof t.category === "string" ? t.category : "other";
      const category: TaskCategory = VALID_CATEGORIES.has(rawCat as TaskCategory)
        ? (rawCat as TaskCategory)
        : "other";
      const rationale =
        typeof t.rationale === "string" ? t.rationale.slice(0, 400) : "";
      tasks.push({ label, duration_days: duration, category, rationale });
    }

    return NextResponse.json({
      data: {
        tasks,
        jurisdiction,
        spotted_bonuses: spottedBonuses,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/suggest-entitlement-tasks error:", error);
    return NextResponse.json(
      { error: "Failed to suggest tasks" },
      { status: 500 }
    );
  }
}
