import Anthropic from "@anthropic-ai/sdk";
import { DocumentCategory, DOCUMENT_CATEGORIES } from "./types";

const MODEL = "claude-sonnet-4-5";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─── Document Classification ─────────────────────────────────────────────────

export async function classifyDocument(
  fileName: string,
  contentText: string
): Promise<{
  category: DocumentCategory;
  summary: string;
  tags: string[];
}> {
  const categories = Object.entries(DOCUMENT_CATEGORIES)
    .map(([key, val]) => `- ${key}: ${val.label} — ${val.description}`)
    .join("\n");

  const contentSection = contentText.trim()
    ? `Content preview (first 3000 chars):\n${contentText.slice(0, 3000)}`
    : `No extractable text content (binary or image file). Use the filename to infer the document type.`;

  const prompt = `You are a real estate due diligence expert. Analyze this document and classify it.

Document name: ${fileName}
${contentSection}

Available categories:
${categories}

Respond with valid JSON only (no markdown):
{
  "category": "<category_key>",
  "summary": "<1-2 sentence summary of what this document contains>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"]
}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const result = JSON.parse(cleaned);
    return {
      category: (result.category || "other") as DocumentCategory,
      summary: result.summary || "",
      tags: Array.isArray(result.tags) ? result.tags : [],
    };
  } catch (err) {
    console.error("classifyDocument JSON parse failed:", err, "raw response:", response.content[0]);
    return { category: "other", summary: "", tags: [] };
  }
}

// ─── Diligence Chat ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatWithDiligence(
  dealName: string,
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .map(
      (d) =>
        `### ${d.name} (${d.category})\nSummary: ${d.ai_summary || "N/A"}\n${
          d.content_text
            ? `Content:\n${d.content_text.slice(0, 2000)}`
            : ""
        }`
    )
    .join("\n\n---\n\n");

  const systemPrompt = `You are a real estate due diligence assistant for the deal: "${dealName}".

You have access to the following uploaded documents:

${docContext || "No documents uploaded yet."}

Answer questions accurately based on the documents. If information isn't in the documents, say so clearly. Be concise but thorough. Use bullet points for lists. Flag any risks or issues you notice.`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ─── Deal Intelligence Chat (Tool Use) ───────────────────────────────────────

export interface ChatAction {
  type: "context_saved" | "deal_updated" | "underwriting_updated";
  note?: string;
  fields?: Record<string, unknown>;
  display: string;
}

const DEAL_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_context",
    description:
      "Save important deal context, intel, or notes to persistent memory. Use this whenever the user provides factual information about the deal — seller motivation, broker intel, physical issues, market conditions, negotiation context, etc. This memory flows into the checklist, DD abstract, and other analyses.",
    input_schema: {
      type: "object" as const,
      properties: {
        note: {
          type: "string",
          description:
            "The context to save. Write as clear, complete sentences. Include who said it, when if relevant, and why it matters.",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "update_underwriting",
    description:
      "Update underwriting financial assumptions when the user provides specific numbers for the pro forma model. Use for purchase price overrides, rent assumptions, operating expenses, vacancy, cap rates, hold period, financing terms.",
    input_schema: {
      type: "object" as const,
      properties: {
        fields: {
          type: "object",
          description: "Underwriting model fields to update",
          properties: {
            purchase_price: { type: "number", description: "Purchase price in dollars" },
            vacancy_rate: { type: "number", description: "Vacancy as a whole number (5 = 5%)" },
            management_fee_pct: { type: "number", description: "Management fee as whole number %" },
            taxes_annual: { type: "number", description: "Annual property taxes in dollars" },
            insurance_annual: { type: "number", description: "Annual insurance in dollars" },
            repairs_annual: { type: "number", description: "Annual repairs/maintenance in dollars" },
            utilities_annual: { type: "number", description: "Annual utilities in dollars" },
            other_expenses_annual: { type: "number", description: "Other annual expenses in dollars" },
            exit_cap_rate: { type: "number", description: "Exit cap rate as whole number (7.5 = 7.5%)" },
            hold_period_years: { type: "number", description: "Hold period in years" },
            acq_ltc: { type: "number", description: "Acquisition loan-to-cost as whole number %" },
            acq_interest_rate: { type: "number", description: "Acquisition interest rate as whole number %" },
            acq_amort_years: { type: "number", description: "Acquisition amortization in years" },
            closing_costs_pct: { type: "number", description: "Closing costs as whole number %" },
          },
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "update_deal_fields",
    description:
      "Update structured fields on the deal record when the user provides specific factual data (price, SF, units, status, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "object",
          description: "Key-value pairs of fields to update",
          properties: {
            name: { type: "string" },
            asking_price: { type: "number", description: "Price in dollars" },
            square_footage: { type: "number" },
            units: { type: "integer" },
            year_built: { type: "integer" },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string", description: "2-letter state code" },
            zip: { type: "string" },
            property_type: {
              type: "string",
              enum: ["industrial", "office", "retail", "multifamily", "student_housing", "mixed_use", "land", "hospitality", "other"],
            },
            status: {
              type: "string",
              enum: ["sourcing", "screening", "loi", "under_contract", "diligence", "closing", "closed", "dead"],
            },
          },
        },
      },
      required: ["updates"],
    },
  },
];

export async function chatWithDealIntelligence(
  deal: { id: string; name: string; context_notes?: string | null },
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string
): Promise<{ response: string; actions: ChatAction[] }> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .slice(0, 20)
    .map(
      (d) =>
        `### ${d.name} (${d.category})\n${d.ai_summary || ""}\n${
          d.content_text ? d.content_text.slice(0, 1500) : ""
        }`
    )
    .join("\n\n---\n\n");

  const memorySection = deal.context_notes?.trim()
    ? `## Deal Memory (saved context)\n${deal.context_notes}`
    : "## Deal Memory\nNo context saved yet.";

  const systemPrompt = `You are a deal intelligence assistant for "${deal.name}".

${memorySection}

## Uploaded Documents
${docContext || "No documents uploaded yet."}

## Your capabilities
1. Answer questions about the deal based on documents and saved memory
2. Save context when the user shares new intel, issues, seller info, market conditions, etc.
3. Update structured deal fields when the user provides specific data

When users share new information about the deal, always use save_context to preserve it.
When users provide structured data (price, SF, status changes), use update_deal_fields.
Always reply with a helpful text response in addition to any tool use.`;

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    tools: DEAL_CHAT_TOOLS,
    messages,
  });

  // Extract text response
  let responseText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n")
    .trim();

  if (!responseText) responseText = "Done.";

  // Extract tool calls → actions
  const actions: ChatAction[] = [];
  const toolUses = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];

  for (const tool of toolUses) {
    if (tool.name === "save_context") {
      const input = tool.input as { note: string };
      actions.push({
        type: "context_saved",
        note: input.note,
        display: `Saved to memory: "${input.note.slice(0, 80)}${input.note.length > 80 ? "…" : ""}"`,
      });
    } else if (tool.name === "update_deal_fields") {
      const input = tool.input as { updates: Record<string, unknown> };
      const fieldNames = Object.keys(input.updates).join(", ");
      actions.push({
        type: "deal_updated",
        fields: input.updates,
        display: `Updated deal: ${fieldNames}`,
      });
    } else if (tool.name === "update_underwriting") {
      const input = tool.input as { fields: Record<string, unknown> };
      const fieldNames = Object.keys(input.fields).join(", ");
      actions.push({
        type: "underwriting_updated",
        fields: input.fields,
        display: `Updated underwriting: ${fieldNames}`,
      });
    }
  }

  return { response: responseText, actions };
}

// ─── Checklist Auto-fill ─────────────────────────────────────────────────────

export interface ChecklistFillResult {
  category: string;
  item: string;
  status: "complete" | "pending" | "na" | "issue";
  notes: string;
  source_document_names: string[];
}

export async function autoFillChecklist(
  dealName: string,
  documents: Array<{
    id: string;
    name: string;
    category: string;
    content_text: string | null;
    ai_summary: string | null;
  }>,
  checklistItems: Array<{ id: string; category: string; item: string }>,
  contextNotes?: string | null
): Promise<ChecklistFillResult[]> {
  if (documents.length === 0 || checklistItems.length === 0) return [];

  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .map(
      (d) =>
        `[${d.name}] (${d.category}): ${d.ai_summary || ""}\n${
          d.content_text ? d.content_text.slice(0, 1500) : ""
        }`
    )
    .join("\n\n");

  const itemsList = checklistItems
    .map((i) => `- ${i.category} | ${i.item}`)
    .join("\n");

  const memorySection = contextNotes?.trim()
    ? `\nDEAL MEMORY (additional context):\n${contextNotes}\n`
    : "";

  const prompt = `You are a real estate due diligence expert reviewing documents for deal: "${dealName}".
${memorySection}
DOCUMENTS AVAILABLE:
${docContext}

DILIGENCE CHECKLIST ITEMS TO ASSESS:
${itemsList}

For each checklist item, determine its status based on the documents. Respond with valid JSON array only (no markdown):
[
  {
    "category": "<exact category text>",
    "item": "<exact item text>",
    "status": "complete" | "pending" | "na" | "issue",
    "notes": "<brief explanation referencing specific documents>",
    "source_document_names": ["<doc name>"]
  }
]

Status meanings:
- complete: Document(s) confirm this item is addressed
- pending: Item not yet addressed or document missing
- na: Not applicable to this property type
- issue: Document reveals a problem or red flag`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "[]";
    return JSON.parse(text.trim());
  } catch {
    return [];
  }
}

// ─── Deal Field Extraction ───────────────────────────────────────────────────

export interface ExtractedDealFields {
  asking_price?: number;
  square_footage?: number;
  units?: number;
  bedrooms?: number;
  year_built?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  property_type?: string;
}

export async function extractDealFields(
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>
): Promise<ExtractedDealFields> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .slice(0, 10)
    .map((d) => `[${d.name}]\nSummary: ${d.ai_summary || ""}\n${d.content_text ? d.content_text.slice(0, 2000) : ""}`)
    .join("\n\n---\n\n");

  if (!docContext) return {};

  const prompt = `You are a real estate data extraction expert. Extract key property facts from these documents.

DOCUMENTS:
${docContext}

Extract only values you are confident about from the documents. Return valid JSON only (no markdown):
{
  "asking_price": <number in dollars, no commas, or null>,
  "square_footage": <total building SF as number, or null>,
  "units": <number of units/apartments, or null>,
  "bedrooms": <total bedrooms if residential, or null>,
  "year_built": <4-digit year, or null>,
  "address": <street address only, or null>,
  "city": <city name, or null>,
  "state": <2-letter state code, or null>,
  "zip": <5-digit zip, or null>,
  "property_type": <one of: industrial|office|retail|multifamily|student_housing|mixed_use|land|hospitality|other, or null>
}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const result = JSON.parse(cleaned);
    // Strip null values so we only patch fields that were actually found
    return Object.fromEntries(
      Object.entries(result).filter(([, v]) => v !== null && v !== undefined)
    ) as ExtractedDealFields;
  } catch {
    return {};
  }
}

// ─── DD Abstract ─────────────────────────────────────────────────────────────

export interface UnderwritingSnapshot {
  proforma?: {
    irr?: number | null;
    yoc?: number | null;
    equity_multiple?: number | null;
    max_pp?: number | null;
    dscr?: number | null;
    noi_stabilized?: number | null;
    refi_proceeds?: number | null;
  } | null;
  uwData?: Record<string, unknown> | null;
}

export async function generateDDAbstract(
  deal: { name: string; address: string; city: string; state: string; property_type: string; status: string; asking_price: number | null; square_footage: number | null; units: number | null; year_built: number | null },
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null; ai_tags: string | null }>,
  checklist: Array<{ category: string; item: string; status: string; notes: string | null }>,
  underwritingSummary?: string,
  contextNotes?: string | null
): Promise<string> {
  const docContext = documents
    .filter((d) => d.ai_summary)
    .map((d) => `- **${d.name}** (${d.category}): ${d.ai_summary}`)
    .join("\n");

  const checklistSummary = (() => {
    const byCategory: Record<string, { complete: number; pending: number; issue: number; na: number; notes: string[] }> = {};
    for (const item of checklist) {
      if (!byCategory[item.category]) byCategory[item.category] = { complete: 0, pending: 0, issue: 0, na: 0, notes: [] };
      const cat = byCategory[item.category];
      cat[item.status as "complete" | "pending" | "issue" | "na"]++;
      if (item.notes) {
        cat.notes.push(`[${item.status}] ${item.item}: ${item.notes}`);
      }
    }
    return Object.entries(byCategory)
      .map(([cat, s]) => {
        let line = `${cat}: ${s.complete} complete, ${s.pending} pending, ${s.issue} issues`;
        if (s.notes.length > 0) line += `\n  Notes: ${s.notes.join("; ")}`;
        return line;
      })
      .join("\n");
  })();

  const uwSection = underwritingSummary?.trim()
    ? `\nINTERNAL UNDERWRITING MODEL:\n${underwritingSummary}\n`
    : "";

  const memorySection = contextNotes?.trim()
    ? `\nDEAL MEMORY (analyst notes & intel):\n${contextNotes}\n`
    : "";

  const prompt = `You are a senior real estate investment analyst. Write a comprehensive due diligence abstract memo that synthesizes ALL available deal information — the OM analysis, the underwriting model, document reviews, checklist progress, and analyst notes.
${memorySection}
DEAL: ${deal.name}
Address: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}
Type: ${deal.property_type} | Status: ${deal.status}
Asking Price: ${deal.asking_price ? `$${deal.asking_price.toLocaleString()}` : "TBD"} | SF: ${deal.square_footage ?? "Unknown"} | Units: ${deal.units ?? "N/A"} | Year Built: ${deal.year_built ?? "Unknown"}
${uwSection}
DOCUMENTS UPLOADED (${documents.length} total):
${docContext || "No documents with summaries yet."}

DILIGENCE CHECKLIST STATUS:
${checklistSummary || "Checklist not yet completed."}

Write a professional due diligence abstract in markdown format with these sections:
1. **Executive Summary** (2-3 sentences synthesizing the deal thesis)
2. **Property Overview** (key facts from all sources)
3. **Underwriting Summary** (use the COMPUTED RETURNS from the internal model — show cap rate, NOI, yield on cost, financing terms, CapEx budget, hold period, exit assumptions. Note: all percentage values are already in percent form, do NOT multiply by 100)
4. **Revenue & Expense Analysis** (unit mix, in-place vs market rents, operating expenses breakdown)
5. **Document Review Status** (what's been received, what's outstanding)
6. **Key Findings** (organized by category — title, environmental, financial, physical, legal)
7. **Red Flags & Issues** (anything requiring attention, including checklist items marked as issues)
8. **Outstanding Items** (what's still needed to complete diligence)
9. **Recommendation** (proceed / proceed with conditions / do not proceed — with brief rationale)

IMPORTANT: Use the actual underwriting data provided. All rates (vacancy, cap rate, interest rate, etc.) are already expressed as percentages — do NOT multiply them by 100. For example, a vacancy_rate of 5 means 5%, not 500%.
Be factual, concise, and investment-focused. If information is missing, note it as outstanding.`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 5000,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ─── Streaming Chat ──────────────────────────────────────────────────────────

export async function streamChatWithDiligence(
  dealName: string,
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .slice(0, 20) // limit to 20 docs to avoid token limits
    .map(
      (d) =>
        `### ${d.name} (${d.category})\n${d.ai_summary || ""}\n${
          d.content_text ? d.content_text.slice(0, 1500) : ""
        }`
    )
    .join("\n\n---\n\n");

  const systemPrompt = `You are a real estate due diligence assistant for the deal: "${dealName}".

You have access to the following uploaded documents:
${docContext || "No documents uploaded yet."}

Answer questions accurately based on the documents. If information isn't available, say so clearly. Flag risks or issues. Use markdown formatting for readability.`;

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  let fullText = "";

  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      fullText += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }

  return fullText;
}
