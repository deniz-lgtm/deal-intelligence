import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  checklistQueries,
  decisionQueries,
  devPhaseQueries,
  documentQueries,
} from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

type DraftKind = "schedule" | "decision" | "checklist";
type DraftConfidence = "high" | "medium" | "low";

type DraftAction = {
  client_id?: string;
  type: DraftKind;
  title: string;
  body?: string | null;
  category?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  track?: "acquisition" | "development" | "construction" | null;
  confidence?: DraftConfidence;
  source_excerpt?: string | null;
  rationale?: string | null;
};

const ALLOWED_TYPES = new Set<DraftKind>(["schedule", "decision", "checklist"]);
const ALLOWED_TRACKS = new Set(["acquisition", "development", "construction"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "document_action";
}

function textBlock(response: Anthropic.Message): string {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced) as Record<string, unknown>;
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]) as Record<string, unknown>;
    throw new Error("AI response was not valid JSON");
  }
}

function cleanString(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

function normalizeDraftAction(input: unknown, index: number): DraftAction | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const type = cleanString(row.type, 24) as DraftKind | null;
  const title = cleanString(row.title, 120);
  if (!type || !ALLOWED_TYPES.has(type) || !title) return null;

  const rawTrack = cleanString(row.track, 24);
  const rawConfidence = cleanString(row.confidence, 24);
  const duration = Number(row.duration_days);

  return {
    client_id: cleanString(row.client_id, 64) || `${type}-${index + 1}`,
    type,
    title,
    body: cleanString(row.body, 700),
    category: cleanString(row.category, 80),
    due_date: cleanDate(row.due_date),
    start_date: cleanDate(row.start_date),
    end_date: cleanDate(row.end_date),
    duration_days: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    track: rawTrack && ALLOWED_TRACKS.has(rawTrack) ? (rawTrack as DraftAction["track"]) : null,
    confidence: rawConfidence && ALLOWED_CONFIDENCE.has(rawConfidence)
      ? (rawConfidence as DraftConfidence)
      : "medium",
    source_excerpt: cleanString(row.source_excerpt, 320),
    rationale: cleanString(row.rationale, 320),
  };
}

function normalizeDraftPayload(input: unknown): {
  summary: string;
  actions: DraftAction[];
  gaps: string[];
} {
  const parsed = parseJsonObject(String(input ?? ""));
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .map((item, index) => normalizeDraftAction(item, index))
        .filter((item): item is DraftAction => Boolean(item))
        .slice(0, 12)
    : [];
  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps
        .map((item) => cleanString(item, 160))
        .filter((item): item is string => Boolean(item))
        .slice(0, 5)
    : [];
  return {
    summary: cleanString(parsed.summary, 500) || "No supported actions found in this document.",
    actions,
    gaps,
  };
}

function documentContext(doc: Record<string, unknown>) {
  const content = cleanString(doc.content_text, 14000);
  const summary = cleanString(doc.ai_summary, 1800);
  return [
    `Document: ${doc.original_name}`,
    `Category: ${DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.label || doc.category}`,
    summary ? `Existing AI summary:\n${summary}` : null,
    content ? `Document text excerpt:\n${content}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function draftActions(doc: Record<string, unknown>, intent: DraftKind | "all") {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 1800,
    temperature: 0.2,
    system: `You extract useful next actions from real estate development documents.

Return ONLY valid JSON with this shape:
{
  "summary": "one concise sentence",
  "gaps": ["missing information, if relevant"],
  "actions": [
    {
      "type": "schedule" | "decision" | "checklist",
      "title": "short action title",
      "body": "why this action matters, concise",
      "category": "short category",
      "due_date": "YYYY-MM-DD or null",
      "start_date": "YYYY-MM-DD or null",
      "end_date": "YYYY-MM-DD or null",
      "duration_days": 0,
      "track": "acquisition" | "development" | "construction" | null,
      "confidence": "high" | "medium" | "low",
      "source_excerpt": "brief exact-ish source phrase",
      "rationale": "why this should become work"
    }
  ]
}

Rules:
- Be selective. Return only useful work that a real estate team would act on.
- Prefer concrete dates, obligations, unresolved questions, missing diligence, approval requirements, RFIs, and owner decisions.
- Do not invent dates. Use null if no date is supported.
- If the document does not support a useful action, return an empty actions array.
- Keep titles under 12 words and bodies under 35 words.`,
    messages: [
      {
        role: "user",
        content: `Intent filter: ${intent}. If intent is not "all", only return that type.

${documentContext(doc)}`,
      },
    ],
  });

  return normalizeDraftPayload(textBlock(response));
}

async function loadScopedDocument(dealId: string, docId: string) {
  const doc = await documentQueries.getById(docId);
  if (!doc || doc.deal_id !== dealId) return null;
  return doc as Record<string, unknown>;
}

async function applyAction(
  dealId: string,
  userId: string,
  docId: string,
  action: DraftAction,
  index: number
) {
  if (action.type === "schedule") {
    const created = await devPhaseQueries.create({
      id: uuidv4(),
      deal_id: dealId,
      track: action.track || "development",
      kind: "task",
      phase_key: `doc_${slugify(action.title)}_${Date.now()}_${index}`,
      label: action.title,
      start_date: action.start_date || action.due_date || null,
      end_date: action.end_date || action.due_date || null,
      duration_days: action.duration_days ?? (action.due_date ? 0 : null),
      linked_document_ids: [docId],
      task_category: action.category || "Document follow-up",
      notes: [action.body, action.source_excerpt ? `Source: ${action.source_excerpt}` : null]
        .filter(Boolean)
        .join("\n\n"),
      status: "not_started",
      sort_order: 0,
    });
    return { type: action.type, data: created };
  }

  if (action.type === "decision") {
    const created = await decisionQueries.create({
      id: uuidv4(),
      deal_id: dealId,
      title: action.title,
      body: [action.body, action.source_excerpt ? `Source: ${action.source_excerpt}` : null]
        .filter(Boolean)
        .join("\n\n"),
      category: action.category || "document",
      status: "open",
      asked_by: userId,
      due_date: action.due_date || null,
      linked_document_id: docId,
    });
    return { type: action.type, data: created };
  }

  const id = uuidv4();
  await checklistQueries.upsert({
    id,
    deal_id: dealId,
    category: action.category || "Document follow-up",
    item: action.title,
    status: "pending",
    notes: [action.body, action.source_excerpt ? `Source: ${action.source_excerpt}` : null]
      .filter(Boolean)
      .join("\n\n"),
    ai_filled: true,
    source_document_ids: [docId],
    source_context: action.rationale || action.source_excerpt || null,
    phase: "diligence",
  });
  return { type: action.type, data: await checklistQueries.getById(id) };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "apply" ? "apply" : "draft";

    const access =
      mode === "apply"
        ? await requireDealEditAccess(params.id, userId)
        : await requireDealAccess(params.id, userId);
    if (access.errorResponse) return access.errorResponse;

    const doc = await loadScopedDocument(params.id, params.docId);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (mode === "apply") {
      const editAccess = await requireDealEditAccess(params.id, userId);
      if (editAccess.errorResponse) return editAccess.errorResponse;

      const actions = Array.isArray(body.actions)
        ? body.actions
            .map((item: unknown, index: number) => normalizeDraftAction(item, index))
            .filter((item: DraftAction | null): item is DraftAction => Boolean(item))
            .slice(0, 12)
        : [];
      if (actions.length === 0) {
        return NextResponse.json({ error: "No actions selected" }, { status: 400 });
      }
      const created = [];
      for (let i = 0; i < actions.length; i++) {
        created.push(await applyAction(params.id, userId, params.docId, actions[i], i));
      }
      if (created.some((item) => item.type === "schedule")) {
        try {
          await recomputeSchedule(params.id);
        } catch (err) {
          console.error("document action schedule recompute failed:", err);
        }
      }
      return NextResponse.json({ data: { created } });
    }

    const rawIntent = body.intent === "all" ? "all" : cleanString(body.intent, 24);
    const intent = rawIntent && (rawIntent === "all" || ALLOWED_TYPES.has(rawIntent as DraftKind))
      ? (rawIntent as DraftKind | "all")
      : "all";
    const data = await draftActions(doc, intent);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("POST /api/deals/[id]/documents/[docId]/actions error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to process document actions", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
