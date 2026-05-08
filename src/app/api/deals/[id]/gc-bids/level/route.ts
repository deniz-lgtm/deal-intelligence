import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import { gcBidQueries, dealQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// AI bid leveling. One Claude call ingests every bid's raw_text and emits a
// canonical scope structure (rows of the leveling table), each bid's
// included/excluded/qualified mapping into that structure, and clarifying
// questions per bid that surface gaps and contradictions.
//
// Why one call: bids are scope-overlapping but contractor-divergent — line
// item names rarely match across bids. Letting Claude see every bid at once
// keeps the canonical scope normalized and the cross-bid comparisons honest.
// Cost is bounded because we only send raw_text (typically 2–10k tokens per
// bid; a typical commercial GC pursuit has 3–6 bidders).

interface LevelingBid {
  bid_id: string;
  contractor: string;
  total_amount: number | null;
  raw_text: string | null;
  notes: string | null;
}

interface LevelingResult {
  scope_items: Array<{
    division: string | null;
    scope: string;
    notes?: string | null;
  }>;
  bid_items: Array<{
    bid_id: string;
    scope_index: number;       // Index into scope_items[]
    amount: number | null;
    status: "included" | "excluded" | "alternate" | "unclear";
    qualifier_note: string | null;
  }>;
  questions: Array<{
    bid_id: string;
    category: "exclusion_clarification" | "scope_gap" | "assumption_diff" | "pricing_outlier" | "other";
    question: string;
  }>;
}

const SYSTEM_PROMPT = `You are a senior preconstruction manager leveling general contractor bids for an owner.
Your job is to produce a clean leveling table that an owner's PM can use to compare bids side-by-side and ask clarifying questions before award.

Inputs: raw bid documents (cover letters, schedules of values, exclusions / inclusions / qualifications).
Outputs: a canonical scope structure that every bid maps into, per-bid status for each scope row, and clarifying questions per contractor.

Hard rules:
- Use CSI MasterFormat divisions when possible (e.g. "03 - Concrete", "08 - Openings", "23 - HVAC", "26 - Electrical"). Use "01 - General Conditions" for GCs/insurance/bonds/permits.
- Keep scope rows specific enough that gaps are obvious (e.g. don't merge "Roofing" with "Membrane Warranties" if one bid quotes them separately).
- If a bid clearly excludes a scope, mark it status="excluded". If a bid is silent on a scope, mark it status="unclear" and generate a clarifying question.
- If a bid lists a scope as an alternate / add-alt / VE, mark it status="alternate".
- If a bid includes a qualification that materially changes risk (different soils class, different metal stud gauge, different fire rating), include the qualifier_note.
- Generate clarifying questions ONLY when there's a real gap. Do not generate make-work. Tag each with the right category.

Output: a single JSON object matching this TypeScript shape, no prose, no fences:
{
  "scope_items": [{"division": "01 - General Conditions" | null, "scope": "<short scope name>", "notes": "<optional>"}],
  "bid_items":   [{"bid_id": "<id>", "scope_index": <number>, "amount": <number|null>, "status": "included"|"excluded"|"alternate"|"unclear", "qualifier_note": "<string|null>"}],
  "questions":   [{"bid_id": "<id>", "category": "exclusion_clarification"|"scope_gap"|"assumption_diff"|"pricing_outlier"|"other", "question": "<actionable question to send the contractor>"}]
}`;

function buildUserPrompt(dealName: string, bids: LevelingBid[]): string {
  const bidBlocks = bids.map((b, i) => {
    return `=== BID ${i + 1} ===
bid_id: ${b.bid_id}
contractor: ${b.contractor}
total_amount: ${b.total_amount ?? "not provided"}
notes: ${b.notes ?? "(none)"}
RAW BID CONTENT:
${b.raw_text?.trim() || "(no raw text supplied — leveling for this bid will be limited to the total only)"}`;
  }).join("\n\n");

  return `Project: ${dealName}

You are leveling ${bids.length} bid${bids.length === 1 ? "" : "s"}. Produce a single canonical scope structure all bids map into.

${bidBlocks}

Return only the JSON object described in the system prompt. Reference each bid by the exact bid_id value above.`;
}

function parseJson(text: string): LevelingResult | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned) as LevelingResult;
  } catch {
    // Sometimes the model wraps the JSON in extra prose despite the rule. Try to extract.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as LevelingResult; } catch { /* fall through */ }
    }
    return null;
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
  if (accessError) return accessError;

  const deal = await dealQueries.getById(params.id);
  const dealName = (deal?.name as string | undefined) ?? "Unknown project";

  const { bids } = await gcBidQueries.getFullLeveling(params.id);
  if (!bids || bids.length === 0) {
    return NextResponse.json({ error: "No bids to level. Add at least one bid first." }, { status: 400 });
  }

  const levelingInput: LevelingBid[] = bids.map((b: Record<string, unknown>) => ({
    bid_id: b.id as string,
    contractor: [b.contractor_name, b.contractor_company].filter(Boolean).join(" – ") as string,
    total_amount: b.total_amount === null ? null : Number(b.total_amount),
    raw_text: b.raw_text as string | null,
    notes: b.notes as string | null,
  }));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: await getActiveModel(),
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(dealName, levelingInput) }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = parseJson(text);
  if (!parsed) {
    console.error("gc-bids/level — failed to parse Claude output:", text.slice(0, 500));
    return NextResponse.json({ error: "AI leveling failed to return structured data. Try again." }, { status: 502 });
  }

  // Persist results: assign IDs, map scope_index → scope_item ID,
  // drop bid_items whose bid_id Claude hallucinated.
  const validBidIds = new Set(bids.map((b: Record<string, unknown>) => b.id as string));
  const scopeItems = parsed.scope_items.map((s, i) => ({
    id: uuidv4(),
    division: s.division ?? null,
    scope: s.scope,
    notes: s.notes ?? null,
    sort_order: i,
  }));
  const bidItems = parsed.bid_items
    .filter((bi) => validBidIds.has(bi.bid_id) && bi.scope_index >= 0 && bi.scope_index < scopeItems.length)
    // Dedupe (bid_id, scope_index) — UNIQUE constraint forbids dupes; if Claude
    // emits two rows for the same cell, keep the last (typically the more
    // specific qualifier).
    .reduce<Map<string, LevelingResult["bid_items"][number]>>((acc, bi) => {
      acc.set(`${bi.bid_id}::${bi.scope_index}`, bi);
      return acc;
    }, new Map())
    .values();
  const bidItemRows = Array.from(bidItems).map((bi) => ({
    id: uuidv4(),
    bid_id: bi.bid_id,
    scope_item_id: scopeItems[bi.scope_index].id,
    amount: bi.amount === null || bi.amount === undefined ? null : Number(bi.amount),
    status: ["included", "excluded", "alternate", "unclear"].includes(bi.status) ? bi.status : "unclear",
    qualifier_note: bi.qualifier_note ?? null,
    ai_generated: true,
  }));
  const questionRows = parsed.questions
    .filter((q) => validBidIds.has(q.bid_id))
    .map((q) => ({
      id: uuidv4(),
      bid_id: q.bid_id,
      question: q.question,
      category: q.category ?? "other",
      ai_generated: true,
    }));

  await gcBidQueries.replaceLeveling(params.id, scopeItems, bidItemRows, questionRows);

  // Mark every bid as analyzed so the UI knows leveling has been run.
  for (const b of bids) {
    await gcBidQueries.updateBid(b.id as string, { extraction_status: "analyzed" });
  }

  return NextResponse.json({
    data: {
      scope_count: scopeItems.length,
      bid_item_count: bidItemRows.length,
      question_count: questionRows.length,
    },
  });
}
