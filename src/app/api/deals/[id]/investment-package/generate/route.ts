import { NextRequest, NextResponse } from "next/server";
import { dealQueries, underwritingQueries, documentQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { sectionTitle, sectionDescription, notes } = await req.json();

    // Fetch deal context for richer output
    const [deal, uwRow, docs] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      documentQueries.getByDealId(params.id),
    ]);

    let dealContext = "";
    if (deal) {
      dealContext += `Deal: ${deal.name}\nProperty: ${deal.property_type} | ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}\n`;
      dealContext += `Asking: ${deal.asking_price ? `$${Number(deal.asking_price).toLocaleString()}` : "TBD"} | Units: ${deal.units ?? "N/A"} | SF: ${deal.square_footage ?? "N/A"} | Year Built: ${deal.year_built ?? "N/A"}\n`;
    }

    // Include key UW data
    if (uwRow?.data) {
      const uw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      const n = (v: unknown) => typeof v === "number" ? v : 0;
      if (uw.purchase_price) dealContext += `Purchase Price: $${n(uw.purchase_price).toLocaleString()}\n`;
      if (uw.unit_groups?.length) {
        dealContext += `Unit Types: ${uw.unit_groups.length}\n`;
        const totalUnits = uw.unit_groups.reduce((s: number, g: Record<string, unknown>) => s + n(g.unit_count), 0);
        dealContext += `Total Units: ${totalUnits}\n`;
      }
      if (uw.vacancy_rate) dealContext += `Vacancy: ${uw.vacancy_rate}%\n`;
      if (uw.exit_cap_rate) dealContext += `Exit Cap: ${uw.exit_cap_rate}%\n`;
      if (uw.hold_period_years) dealContext += `Hold: ${uw.hold_period_years} years\n`;
    }

    // Include doc summaries
    const docSummaries = (docs as Array<{ name: string; ai_summary: string | null }>)
      .filter(d => d.ai_summary)
      .map(d => `- ${d.name}: ${d.ai_summary}`)
      .join("\n");
    if (docSummaries) dealContext += `\nDocuments:\n${docSummaries}\n`;

    const prompt = `You are writing a section of a commercial real estate investment package/memo for investors or an investment committee.

DEAL CONTEXT:
${dealContext}

SECTION: ${sectionTitle}
Purpose: ${sectionDescription}

THE ANALYST HAS PROVIDED THESE KEY POINTS TO EXPAND:
${notes.map((n: string, i: number) => `${i + 1}. ${n}`).join("\n")}

Write this section as professional, investor-ready content in markdown format. Expand each key point into clear, well-written prose. Use the deal context to add specific numbers, facts, and analysis. Keep it concise but thorough — suitable for a presentation deck or investment memo.

IMPORTANT: All percentage values in the data are already in percent form (e.g., 5 means 5%, not 0.05). Do not multiply by 100.

Write 2-4 paragraphs. Use bullet points or tables where appropriate. Do not include the section title as a header — just the content.`;

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return NextResponse.json({ data: text });
  } catch (error) {
    console.error("Generate section error:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
