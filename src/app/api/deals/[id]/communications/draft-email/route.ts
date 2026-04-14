import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  dealQueries,
  contactQueries,
  questionQueries,
  communicationQueries,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { STAKEHOLDER_LABELS, DEAL_STAGE_LABELS } from "@/lib/types";
import type { StakeholderType } from "@/lib/types";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

type Body = {
  contact_id?: string | null;
  stakeholder_type?: StakeholderType;
  include_questions?: boolean;
  tone?: "formal" | "friendly" | "direct";
  custom_instructions?: string;
};

/**
 * Generate a draft email to a stakeholder. The draft is tailored to the
 * recipient's role, the deal's current phase, and optionally bundles the
 * open phase questions targeted at that role.
 *
 * Returns: { data: { subject, body, to?, to_name? } }
 *
 * This endpoint does NOT persist anything. The client is expected to let
 * the user edit the draft and then either copy it, open mailto, or log it
 * as a sent communication via the regular communications endpoint.
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

    const body = (await req.json().catch(() => ({}))) as Body;

    const deal = (await dealQueries.getById(params.id)) as Record<string, unknown> | null;
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Resolve recipient
    let contact = null;
    if (body.contact_id) {
      contact = await contactQueries.getById(body.contact_id);
    }

    const stakeholderType: StakeholderType =
      (contact?.role as StakeholderType) || body.stakeholder_type || "broker";
    const stakeholderLabel = STAKEHOLDER_LABELS[stakeholderType];

    // Load questions for current phase + role (if requested)
    let relevantQuestions: Array<{ question: string; status: string }> = [];
    if (body.include_questions) {
      const all = (await questionQueries.getByDealId(params.id)) as Array<{
        question: string;
        status: string;
        phase: string;
        target_role: string;
      }>;
      relevantQuestions = all
        .filter(
          (q) =>
            q.phase === deal.status &&
            q.target_role === stakeholderType &&
            (q.status === "open" || q.status === "asked")
        )
        .map((q) => ({ question: q.question, status: q.status }));
    }

    // Load recent communication history with this role/contact
    const allComms = (await communicationQueries.getByDealId(params.id)) as Array<{
      stakeholder_type: string;
      stakeholder_name: string;
      contact_id: string | null;
      subject: string;
      summary: string;
      occurred_at: string;
      direction: string;
    }>;
    const recentComms = allComms
      .filter((c) => {
        if (contact && c.contact_id === contact.id) return true;
        return c.stakeholder_type === stakeholderType;
      })
      .slice(0, 5);

    const tone = body.tone || "formal";
    const dealName = String(deal.name || "the property");
    const dealAddress = [deal.address, deal.city, deal.state]
      .filter(Boolean)
      .join(", ");
    const dealStageLabel = DEAL_STAGE_LABELS[deal.status as keyof typeof DEAL_STAGE_LABELS] || String(deal.status);

    // Build the prompt
    const contactLine = contact
      ? `${contact.name}${contact.title ? ", " + contact.title : ""}${contact.company ? " at " + contact.company : ""}`
      : `(generic ${stakeholderLabel})`;

    const questionsBlock = relevantQuestions.length
      ? `OPEN QUESTIONS to work into the email (phrase them naturally — you don't have to use all of them if they don't flow well):\n${relevantQuestions
          .map((q, i) => `${i + 1}. ${q.question}`)
          .join("\n")}`
      : "(no open questions queued for this phase/role — keep it concise)";

    const historyBlock = recentComms.length
      ? `RECENT COMMUNICATION HISTORY with this contact/role (for context — reference threads naturally):\n${recentComms
          .map(
            (c) =>
              `- ${new Date(c.occurred_at).toLocaleDateString()} ${c.direction}: ${c.subject || "(no subject)"}${c.summary ? " — " + c.summary.slice(0, 200) : ""}`
          )
          .join("\n")}`
      : "(no prior communications logged)";

    const toneGuidance: Record<typeof tone, string> = {
      formal: "professional, courteous, and businesslike — appropriate for institutional CRE",
      friendly: "warm and personable but still professional — you have an established relationship",
      direct: "concise, specific, and action-oriented — no pleasantries beyond a brief opener",
    };

    const customBlock = body.custom_instructions?.trim()
      ? `ADDITIONAL INSTRUCTIONS FROM THE USER:\n${body.custom_instructions.trim()}`
      : "";

    const prompt = `You are drafting an email on behalf of a commercial real estate investment professional. Generate a tailored email to the stakeholder below.

Write in natural email prose — NOT bullet points. Use short paragraphs and a professional business-email voice.

DEAL: ${dealName}${dealAddress ? " — " + dealAddress : ""}
CURRENT STAGE: ${dealStageLabel}
RECIPIENT: ${contactLine}
RECIPIENT ROLE: ${stakeholderLabel}
TONE: ${tone} (${toneGuidance[tone]})

${questionsBlock}

${historyBlock}

${customBlock}

WRITING REQUIREMENTS:
- Match the email style appropriate for the recipient's role. A BROKER email is different from a LENDER email, which is different from an ATTORNEY email.
- For BROKERS: reference the deal by name, be collegial, ask for the materials or information you need, propose next steps.
- For SELLERS: be respectful, reference the LOI/PSA if applicable, be specific about diligence asks.
- For LENDERS: be precise about financials, timeline, and what you need from them to move forward.
- For ATTORNEYS: be structured and specific about legal/documentation asks.
- For TITLE/ESCROW: be procedural and deadline-focused.
- For INSPECTORS/APPRAISERS: be clear about scope, access, and timeline.
- Keep the email under 250 words unless the context demands more.
- Use a clear, specific subject line that includes the property name.
- Open with a natural greeting using the recipient's first name if known.
- Sign off with "[Your name]" so the user can fill in their signature.
- Do NOT invent facts about the deal that aren't in the context above.

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{
  "subject": "string",
  "body": "string with \\n for line breaks"
}`;

    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI draft email returned no JSON:", text);
      return NextResponse.json({ error: "AI returned invalid format" }, { status: 500 });
    }

    let parsed: { subject: string; body: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "AI returned malformed JSON" }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        subject: parsed.subject || `Regarding ${dealName}`,
        body: parsed.body || "",
        to: contact?.email || null,
        to_name: contact?.name || null,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/communications/draft-email error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to draft email: ${message}` },
      { status: 500 }
    );
  }
}
