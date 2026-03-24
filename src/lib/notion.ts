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

  if (analysis.deal_score != null) {
    properties["Deal Score"] = { number: analysis.deal_score };
  }

  if (summaryText) {
    properties["Summary"] = {
      rich_text: [{ text: { content: summaryText } }],
    };
  }

  if (dealUrl) {
    properties["Deal URL"] = { url: dealUrl };
  }

  // Build page body content (children blocks)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  // Score callout
  if (analysis.deal_score != null) {
    const scoreEmoji =
      analysis.deal_score >= 8
        ? "🟢"
        : analysis.deal_score >= 6
        ? "🟡"
        : analysis.deal_score >= 4
        ? "🟠"
        : "🔴";
    children.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [
          {
            text: {
              content: `Deal Score: ${analysis.deal_score}/10 — ${analysis.score_reasoning ?? ""}`,
            },
          },
        ],
        icon: { emoji: scoreEmoji },
        color: "default",
      },
    });
  }

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
