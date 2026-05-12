import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import {
  checklistQueries,
  dealNoteQueries,
  decisionQueries,
  devPhaseQueries,
} from "@/lib/db";
import { getActiveModel } from "@/lib/claude";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/types";

export type DocumentActionKind = "schedule" | "decision" | "checklist";
export type DocumentActionIntent = DocumentActionKind | "all";
type DraftConfidence = "high" | "medium" | "low";

export type DraftDocumentAction = {
  client_id?: string;
  type: DocumentActionKind;
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
  source_document_ids?: string[] | null;
};

export type DocumentActionDraft = {
  summary: string;
  actions: DraftDocumentAction[];
  gaps: string[];
};

export type DocumentActionApplyResult = {
  created: Array<{ type: DocumentActionKind; data: unknown }>;
  summary: {
    total: number;
    schedule: number;
    decision: number;
    checklist: number;
  };
};

type DocumentActionSource = Record<string, unknown> & {
  id?: string;
  original_name?: string;
  category?: string;
  content_text?: string | null;
  ai_summary?: string | null;
};

const ALLOWED_TYPES = new Set<DocumentActionKind>(["schedule", "decision", "checklist"]);
const ALLOWED_TRACKS = new Set(["acquisition", "development", "construction"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "document_action"
  );
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
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function cleanSourceDocumentIds(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const ids = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
  return ids.length > 0 ? ids : fallback;
}

export function normalizeDocumentAction(
  input: unknown,
  index: number,
  fallbackDocumentIds: string[] = []
): DraftDocumentAction | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const type = cleanString(row.type, 24) as DocumentActionKind | null;
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
    track: rawTrack && ALLOWED_TRACKS.has(rawTrack)
      ? (rawTrack as DraftDocumentAction["track"])
      : null,
    confidence: rawConfidence && ALLOWED_CONFIDENCE.has(rawConfidence)
      ? (rawConfidence as DraftConfidence)
      : "medium",
    source_excerpt: cleanString(row.source_excerpt, 320),
    rationale: cleanString(row.rationale, 320),
    source_document_ids: cleanSourceDocumentIds(row.source_document_ids, fallbackDocumentIds),
  };
}

function normalizeDraftPayload(input: unknown, fallbackDocumentIds: string[]): DocumentActionDraft {
  const parsed = parseJsonObject(String(input ?? ""));
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .map((item, index) => normalizeDocumentAction(item, index, fallbackDocumentIds))
        .filter((item): item is DraftDocumentAction => Boolean(item))
        .slice(0, 16)
    : [];
  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps
        .map((item) => cleanString(item, 160))
        .filter((item): item is string => Boolean(item))
        .slice(0, 5)
    : [];
  return {
    summary: cleanString(parsed.summary, 500) || "No supported actions found in these documents.",
    actions,
    gaps,
  };
}

function documentContext(doc: DocumentActionSource) {
  const content = cleanString(doc.content_text, 9000);
  const summary = cleanString(doc.ai_summary, 1600);
  return [
    `Document ID: ${doc.id || "unknown"}`,
    `Document: ${doc.original_name || "Untitled document"}`,
    `Category: ${DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.label || doc.category || "Uncategorized"}`,
    summary ? `Existing AI summary:\n${summary}` : null,
    content ? `Document text excerpt:\n${content}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function draftDocumentActionsFromDocs(
  docs: DocumentActionSource[],
  intent: DocumentActionIntent
): Promise<DocumentActionDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const scopedDocs = docs
    .filter((doc) => doc.id && (doc.content_text || doc.ai_summary))
    .slice(0, 8);
  if (scopedDocs.length === 0) {
    return {
      summary: "No readable source text was available to draft actions.",
      gaps: ["Upload or re-extract documents with readable text."],
      actions: [],
    };
  }
  const fallbackDocumentIds = scopedDocs.map((doc) => String(doc.id));

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 2200,
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
      "source_document_ids": ["document ids that support this action"],
      "source_excerpt": "brief exact-ish source phrase",
      "rationale": "why this should become work"
    }
  ]
}

Rules:
- Be selective. Return only useful work that a real estate team would act on.
- Prefer concrete dates, obligations, unresolved questions, missing diligence, approval requirements, RFIs, and owner decisions.
- Do not invent dates. Use null if no date is supported.
- Every action must include source_document_ids using the provided Document IDs.
- If the documents do not support a useful action, return an empty actions array.
- Keep titles under 12 words and bodies under 35 words.`,
    messages: [
      {
        role: "user",
        content: `Intent filter: ${intent}. If intent is not "all", only return that type.

${scopedDocs.map(documentContext).join("\n\n---\n\n")}`,
      },
    ],
  });

  return normalizeDraftPayload(textBlock(response), fallbackDocumentIds);
}

async function applyAction(
  dealId: string,
  userId: string,
  action: DraftDocumentAction,
  index: number,
  fallbackDocumentIds: string[]
) {
  const sourceDocumentIds =
    action.source_document_ids && action.source_document_ids.length > 0
      ? action.source_document_ids
      : fallbackDocumentIds;
  const primaryDocId = sourceDocumentIds[0] || null;

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
      linked_document_ids: sourceDocumentIds,
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
      linked_document_id: primaryDocId,
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
    source_document_ids: sourceDocumentIds,
    source_context: action.rationale || action.source_excerpt || null,
    phase: "diligence",
  });
  return { type: action.type, data: await checklistQueries.getById(id) };
}

export async function applyDocumentActions(params: {
  dealId: string;
  userId: string;
  actions: DraftDocumentAction[];
  defaultDocumentIds: string[];
  sourceLabel?: string;
}): Promise<DocumentActionApplyResult> {
  const created: Array<{ type: DocumentActionKind; data: unknown }> = [];
  for (let i = 0; i < params.actions.length; i += 1) {
    created.push(
      await applyAction(params.dealId, params.userId, params.actions[i], i, params.defaultDocumentIds)
    );
  }
  if (created.some((item) => item.type === "schedule")) {
    try {
      await recomputeSchedule(params.dealId);
    } catch (err) {
      console.error("document action schedule recompute failed:", err);
    }
  }

  const summary = {
    total: created.length,
    schedule: created.filter((item) => item.type === "schedule").length,
    decision: created.filter((item) => item.type === "decision").length,
    checklist: created.filter((item) => item.type === "checklist").length,
  };

  if (summary.total > 0) {
    const parts = [
      summary.schedule ? `${summary.schedule} schedule item${summary.schedule === 1 ? "" : "s"}` : null,
      summary.decision ? `${summary.decision} decision${summary.decision === 1 ? "" : "s"}` : null,
      summary.checklist ? `${summary.checklist} checklist task${summary.checklist === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    await dealNoteQueries.create({
      id: uuidv4(),
      deal_id: params.dealId,
      text: `Document actions created: ${parts.join(", ")}${params.sourceLabel ? ` from ${params.sourceLabel}` : ""}.`,
      category: "review",
      source: "document_actions",
    });
  }

  return { created, summary };
}

export function normalizeDocumentActions(
  actions: unknown,
  fallbackDocumentIds: string[]
): DraftDocumentAction[] {
  return Array.isArray(actions)
    ? actions
        .map((item, index) => normalizeDocumentAction(item, index, fallbackDocumentIds))
        .filter((item): item is DraftDocumentAction => Boolean(item))
        .slice(0, 16)
    : [];
}

export function normalizeDocumentActionIntent(value: unknown): DocumentActionIntent {
  const raw = value === "all" ? "all" : cleanString(value, 24);
  return raw && (raw === "all" || ALLOWED_TYPES.has(raw as DocumentActionKind))
    ? (raw as DocumentActionIntent)
    : "all";
}
