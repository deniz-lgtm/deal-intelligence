import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealNoteQueries, documentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

type ReviewPayload = {
  document_type: string;
  executive_take: string;
  key_points: string[];
  red_flags: string[];
  missing_items: string[];
  questions_to_ask: string[];
  suggested_email: string;
  filing_suggestion: {
    category: string;
    deal_relevance: string;
  };
};

type ReviewResponse = {
  review: ReviewPayload;
  saved_note_id: string | null;
};

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

function stringList(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanString(value: unknown, fallback: string, max = 1600): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

function normalizeReview(input: unknown): ReviewPayload {
  const parsed = parseJsonObject(String(input ?? ""));
  const filing = parsed.filing_suggestion &&
    typeof parsed.filing_suggestion === "object" &&
    !Array.isArray(parsed.filing_suggestion)
    ? (parsed.filing_suggestion as Record<string, unknown>)
    : {};

  return {
    document_type: cleanString(parsed.document_type, "Document", 120),
    executive_take: cleanString(parsed.executive_take, "No clear review takeaway was generated."),
    key_points: stringList(parsed.key_points),
    red_flags: stringList(parsed.red_flags),
    missing_items: stringList(parsed.missing_items),
    questions_to_ask: stringList(parsed.questions_to_ask),
    suggested_email: cleanString(parsed.suggested_email, "", 2200),
    filing_suggestion: {
      category: cleanString(filing.category, "other", 80),
      deal_relevance: cleanString(filing.deal_relevance, "Useful deal reference.", 300),
    },
  };
}

function formatList(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- Nothing material flagged.";
}

function formatReviewNote({
  documentName,
  focus,
  review,
}: {
  documentName: string;
  focus: string;
  review: ReviewPayload;
}) {
  return [
    `Document review: ${documentName}`,
    `Type: ${review.document_type}`,
    `Focus: ${focus}`,
    "",
    `Bottom line: ${review.executive_take}`,
    "",
    "Key points:",
    formatList(review.key_points),
    "",
    "Red flags:",
    formatList(review.red_flags),
    "",
    "Missing items:",
    formatList(review.missing_items),
    "",
    "Questions to ask:",
    formatList(review.questions_to_ask),
    "",
    review.suggested_email ? `Suggested email:\n${review.suggested_email}` : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const body = await req.json().catch(() => ({}));
    const doc = (await documentQueries.getById(params.id)) as Record<string, unknown> | null;
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const dealId = String(doc.deal_id);
    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const focus = typeof body.focus === "string" && body.focus.trim()
      ? body.focus.trim().slice(0, 500)
      : "Review this as my personal real estate development associate before I respond or file it.";
    const category = String(doc.category || "other") as DocumentCategory;
    const content = typeof doc.content_text === "string" && doc.content_text.trim()
      ? doc.content_text.slice(0, 18000)
      : "No extractable document text was stored. Use filename, category, and existing summary only.";
    const summary = typeof doc.ai_summary === "string" ? doc.ai_summary : "";

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 2200,
      temperature: 0.2,
      system: `You are a concise personal real estate development associate.

Review documents before the user sends emails, files the doc, or moves a front-end deal forward. Focus on practical issues: scope gaps, economics, exclusions, dates, deliverables, risk, missing backup, and the exact questions to ask.

If the document is a preliminary site plan, focus specifically on: unit count and unit mix, parking count/ratio, access and circulation, fire access, trash/loading, open space and amenities, setbacks/easements, grading/utilities, zoning or entitlement assumptions, dimensions that are missing, constructability concerns, and the questions to ask the architect/civil engineer before relying on the plan.

Return ONLY valid JSON:
{
  "document_type": "consultant proposal | OM | report | email | preliminary site plan | plan | other",
  "executive_take": "2-3 sentence bottom line",
  "key_points": ["important point"],
  "red_flags": ["issue to watch"],
  "missing_items": ["missing backup, scope, schedule, fee detail, etc."],
  "questions_to_ask": ["question to send or ask internally"],
  "suggested_email": "short draft email response, or empty string if not useful",
  "filing_suggestion": {
    "category": "best existing document category key",
    "deal_relevance": "why this belongs in the selected deal folder"
  }
}

Keep lists short. If you do not know, say so plainly. Do not invent facts.`,
      messages: [
        {
          role: "user",
          content: `Focus: ${focus}

Document name: ${doc.original_name || doc.name || "Untitled"}
Current category: ${DOCUMENT_CATEGORIES[category]?.label || category}
Existing summary: ${summary || "None"}

Document text:
${content}`,
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const review = normalizeReview(text);
    const noteId = uuidv4();
    await dealNoteQueries.create({
      id: noteId,
      deal_id: dealId,
      text: formatReviewNote({
        documentName: String(doc.original_name || doc.name || "Untitled document"),
        focus,
        review,
      }),
      category: "review",
      source: "document_review",
    });

    const data: ReviewResponse = { review, saved_note_id: noteId };
    return NextResponse.json({ data });
  } catch (error) {
    console.error("POST /api/documents/[id]/review error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to review document", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
