/**
 * Notion Integration
 * Exports Deal Intelligence deals + OM analyses to a Notion database.
 *
 * Required environment variables:
 *   NOTION_API_KEY            — Integration token (secret_...)
 *   NOTION_DEALS_DATABASE_ID  — Target database ID
 *
 * The Notion database should have these properties:
 *   Name (title), Address (text), Property Type (select),
 *   Asking Price (number), Cap Rate (number), NOI (number),
 *   Deal Score (number), Status (select), Summary (rich_text),
 *   Red Flags Count (number), Analysis Date (date), Deal URL (url)
 */

import { Client } from "@notionhq/client";
import type { OmAnalysisRow } from "./db";

function getClient() {
  return new Client({ auth: process.env.NOTION_API_KEY });
}

function getDatabaseId() {
  return process.env.NOTION_DEALS_DATABASE_ID!;
}

// Status mapping from Deal Intelligence to Notion select options
const STATUS_MAP: Record<string, string> = {
  prospecting: "Prospecting",
  diligence: "Under Analysis",
  loi: "LOI",
  under_contract: "Due Diligence",
  closed: "Closed",
  dead: "Dead",
};

type NotionHandoffInput = {
  deal: Record<string, unknown>;
  documents: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
};

function truncateText(value: unknown, max = 1800): string {
  return String(value ?? "").trim().slice(0, max);
}

function richText(value: unknown, max = 1800) {
  const content = truncateText(value, max);
  return [{ text: { content: content || "—" } }];
}

function fullAddress(deal: Record<string, unknown>) {
  return [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
}

function dealUrl(dealId: unknown, path = "") {
  if (!process.env.NEXT_PUBLIC_APP_URL || !dealId) return null;
  return `${process.env.NEXT_PUBLIC_APP_URL}/deals/${dealId}${path}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function heading(content: string): any {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: richText(content, 200) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paragraph(content: unknown, color: "default" | "gray" = "default"): any {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(content), color },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bullet(content: unknown): any {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(content) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function todo(content: unknown): any {
  return {
    object: "block",
    type: "to_do",
    to_do: { rich_text: richText(content), checked: false },
  };
}

function formatDate(value: unknown) {
  if (!value) return "";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function taskLine(task: Record<string, unknown>) {
  const label = truncateText(task.label ?? task.title ?? "Untitled task", 220);
  const due = task.end_date || task.start_date ? ` due ${formatDate(task.end_date || task.start_date)}` : "";
  const priority = task.priority ? ` [${String(task.priority)}]` : "";
  const category = task.task_category ? ` (${String(task.task_category).replaceAll("_", " ")})` : "";
  return `${label}${category}${priority}${due}`;
}

function reviewTitle(note: Record<string, unknown>) {
  const firstLine = truncateText(note.text, 240).split("\n")[0] || "Document review";
  return firstLine.replace(/^Document review:\s*/i, "");
}

function reviewBottomLine(note: Record<string, unknown>) {
  const text = truncateText(note.text, 1200);
  const match = text.match(/Bottom line:\s*([\s\S]*?)(?:\n\n|$)/i);
  return match?.[1]?.trim() || text;
}

function documentLine(doc: Record<string, unknown>) {
  const name = truncateText(doc.original_name ?? doc.name ?? "Untitled document", 180);
  const category = doc.category ? ` (${String(doc.category).replaceAll("_", " ")})` : "";
  const key = doc.is_key ? "Key: " : "";
  const summary = truncateText(doc.ai_summary, 240);
  return `${key}${name}${category}${summary ? ` - ${summary}` : ""}`;
}

export async function exportDealHandoffToNotion({
  deal,
  documents,
  notes,
  tasks,
}: NotionHandoffInput): Promise<{ pageId: string; url: string }> {
  const notion = getClient();
  const dbId = getDatabaseId();
  const status = STATUS_MAP[String(deal.status ?? "")] || "Under Analysis";
  const address = fullAddress(deal);
  const url = dealUrl(deal.id);
  const reviewNotes = notes
    .filter((note) => note.source === "document_review")
    .slice(0, 6);
  const openTasks = tasks
    .filter((task) => task.status !== "complete" && task.deleted_at == null)
    .slice(0, 30);

  const summary = [
    address ? `Address: ${address}` : null,
    deal.property_type ? `Product: ${String(deal.property_type).replaceAll("_", " ")}` : null,
    `${documents.length} document${documents.length === 1 ? "" : "s"}`,
    `${reviewNotes.length} saved review${reviewNotes.length === 1 ? "" : "s"}`,
    `${openTasks.length} open follow-up${openTasks.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" | ");

  // Keep handoff data in page body so the target Notion database does not
  // need custom review/task schema on day one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {
    Name: {
      title: [{ text: { content: truncateText(deal.name ?? "Untitled Deal", 200) } }],
    },
    Status: {
      select: { name: status },
    },
    Summary: {
      rich_text: richText(summary || "Deal handoff from Deal Intelligence.", 1800),
    },
    "Red Flags Count": {
      number: reviewNotes.filter((note) => /red flags:\s*\n(?!- Nothing material flagged)/i.test(String(note.text ?? ""))).length,
    },
    "Analysis Date": {
      date: { start: new Date().toISOString().split("T")[0] },
    },
  };

  if (address) properties.Address = { rich_text: richText(address, 1800) };
  if (deal.property_type) {
    properties["Property Type"] = {
      select: { name: truncateText(deal.property_type, 100) },
    };
  }
  if (url) properties["Deal URL"] = { url };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [
    heading("Deal Intake"),
    paragraph(summary || "Front-end deal package pushed from Deal Intelligence."),
  ];

  if (reviewNotes.length > 0) {
    children.push(heading("Latest Document Reviews"));
    reviewNotes.forEach((note) => {
      children.push(bullet(`${reviewTitle(note)} - ${reviewBottomLine(note)}`));
    });
  } else {
    children.push(heading("Latest Document Reviews"));
    children.push(paragraph("No saved document reviews yet. Run a review in the deal Documents page before relying on this handoff.", "gray"));
  }

  children.push(heading("Open Follow-Ups"));
  if (openTasks.length > 0) {
    openTasks.forEach((task) => children.push(todo(taskLine(task))));
  } else {
    children.push(paragraph("No open follow-up tasks were found in Deal Intelligence.", "gray"));
  }

  if (documents.length > 0) {
    children.push(heading("Deal Documents"));
    documents.slice(0, 20).forEach((doc) => children.push(bullet(documentLine(doc))));
  }

  if (url) {
    children.push(paragraph(`Source deal workspace: ${url}`, "gray"));
  }

  const response = await notion.pages.create({
    parent: { database_id: dbId },
    properties,
    children: children.slice(0, 100),
  });

  return {
    pageId: response.id,
    url: (response as { url?: string }).url ?? `https://notion.so/${response.id.replace(/-/g, "")}`,
  };
}

export async function exportDealToNotion(
  deal: Record<string, unknown>,
  analysis: OmAnalysisRow
): Promise<{ pageId: string; url: string }> {
  const notion = getClient();
  const dbId = getDatabaseId();

  const dealStatus = STATUS_MAP[String(deal.status ?? "")] || "Under Analysis";

  const capRatePercent =
    analysis.cap_rate != null
      ? Math.round(analysis.cap_rate * 10000) / 100
      : null;

  const addressParts = [
    deal.address,
    deal.city,
    deal.state,
    deal.zip,
  ].filter(Boolean);
  const fullAddress = addressParts.join(", ");

  const summaryText = analysis.summary
    ? analysis.summary.slice(0, 2000)
    : "No summary available.";

  const dealUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/deals/${deal.id}/om-analysis`
    : null;

  // Build properties object — only include non-null values
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {
    Name: {
      title: [{ text: { content: String(deal.name ?? "Untitled Deal") } }],
    },
    Status: {
      select: { name: dealStatus },
    },
    "Red Flags Count": {
      number: analysis.red_flags
        ? (analysis.red_flags as unknown[]).length
        : 0,
    },
    "Analysis Date": {
      date: { start: new Date().toISOString().split("T")[0] },
    },
  };

  if (fullAddress) {
    properties["Address"] = {
      rich_text: [{ text: { content: fullAddress } }],
    };
  }

  if (analysis.property_type) {
    properties["Property Type"] = {
      select: { name: analysis.property_type },
    };
  }

  if (analysis.asking_price != null) {
    properties["Asking Price"] = { number: analysis.asking_price };
  }

  if (capRatePercent != null) {
    properties["Cap Rate"] = { number: capRatePercent };
  }

  if (analysis.noi != null) {
    properties["NOI"] = { number: analysis.noi };
  }

  if (summaryText) {
    properties["Summary"] = {
      rich_text: [{ text: { content: summaryText } }],
    };
  }

  if (dealUrl) {
    properties["Deal URL"] = { url: dealUrl };
  }

  // Build page body content (children blocks). The legacy 1–10 deal-score
  // callout was removed when the deterministic quant-score engine became
  // the system of record. Notion exports now lead with the metrics + flags.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  // Key metrics heading
  children.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ text: { content: "Key Metrics" } }],
    },
  });

  const metricsLines: string[] = [];
  if (analysis.asking_price) metricsLines.push(`Asking Price: $${Number(analysis.asking_price).toLocaleString()}`);
  if (analysis.noi) metricsLines.push(`NOI: $${Number(analysis.noi).toLocaleString()}/yr`);
  if (capRatePercent) metricsLines.push(`Cap Rate: ${capRatePercent}%`);
  if (analysis.vacancy_rate != null) metricsLines.push(`Vacancy: ${(Number(analysis.vacancy_rate) * 100).toFixed(1)}%`);
  if (analysis.dscr) metricsLines.push(`DSCR: ${analysis.dscr}`);
  if (analysis.irr) metricsLines.push(`IRR: ${(Number(analysis.irr) * 100).toFixed(1)}%`);
  if (analysis.sf) metricsLines.push(`SF: ${Number(analysis.sf).toLocaleString()}`);
  if (analysis.year_built) metricsLines.push(`Year Built: ${analysis.year_built}`);

  for (const line of metricsLines) {
    children.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [{ text: { content: line } }],
      },
    });
  }

  // Red flags
  const redFlags = (analysis.red_flags as Array<{
    severity: string;
    category: string;
    description: string;
    recommendation: string;
  }> | null) ?? [];

  if (redFlags.length > 0) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ text: { content: `Red Flags (${redFlags.length})` } }],
      },
    });

    for (const flag of redFlags.slice(0, 10)) {
      children.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              text: {
                content: `[${flag.severity.toUpperCase()}] ${flag.category}: ${flag.description}`,
              },
            },
          ],
        },
      });
    }
  }

  // Recommendations
  const recommendations = (analysis.recommendations as string[] | null) ?? [];
  if (recommendations.length > 0) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ text: { content: "Next Steps" } }],
      },
    });

    for (const rec of recommendations) {
      children.push({
        object: "block",
        type: "to_do",
        to_do: {
          rich_text: [{ text: { content: rec } }],
          checked: false,
        },
      });
    }
  }

  // Meta
  children.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          text: {
            content: `Analyzed with ${analysis.model_used ?? "Claude"} · ${analysis.tokens_used?.toLocaleString() ?? "?"} tokens · ${
              analysis.cost_estimate != null
                ? `$${Number(analysis.cost_estimate).toFixed(4)}`
                : "?"
            } cost`,
          },
        },
      ],
      color: "gray",
    },
  });

  const response = await notion.pages.create({
    parent: { database_id: dbId },
    properties,
    children: children.slice(0, 100), // Notion API limit
  });

  return {
    pageId: response.id,
    url: (response as { url?: string }).url ?? `https://notion.so/${response.id.replace(/-/g, "")}`,
  };
}
