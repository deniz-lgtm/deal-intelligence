import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  hardCostQueries,
  budgetVersionQueries,
  drawQueries,
  changeOrderQueries,
  constructionRfiQueries,
  getPool,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getActiveModel } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Generates a one-paragraph narrative explaining the variance between
// original budget and current EAC for a deal. Pulls in approved COs, open
// RFIs, and per-line changes so the explanation is concrete.
//
// Useful for monthly lender reports and owner updates — saves a 30-minute
// "what happened this period?" exercise per project.

function fc(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const active = await budgetVersionQueries.getActive(params.id);
  const versionId = active?.id ?? null;

  const [items, draws, cos, rfis] = await Promise.all([
    hardCostQueries.getByDealId(params.id, versionId),
    drawQueries.getByDealId(params.id),
    changeOrderQueries.getByDealId(params.id),
    constructionRfiQueries.listByDeal(params.id),
  ]);

  // Per-line aggregates needed for narrative grounding.
  const pool = getPool();
  const drawRows = await pool.query(
    `SELECT di.hardcost_item_id, COALESCE(SUM(COALESCE(di.amount_approved, di.amount_requested)), 0)::numeric AS total_completed
     FROM deal_draw_items di
     JOIN deal_draws d ON d.id = di.draw_id
     WHERE d.deal_id = $1
     GROUP BY di.hardcost_item_id`,
    [params.id]
  );
  const completedByLine: Record<string, number> = {};
  for (const r of drawRows.rows) {
    if (r.hardcost_item_id) completedByLine[r.hardcost_item_id] = Number(r.total_completed);
  }

  // Top 5 lines by absolute variance — the narrative leads with these.
  const variances = items.map((it: Record<string, unknown>) => {
    const original = Number(it.amount) || 0;
    const co = Number(it.change_order_amount) || 0;
    const current = original + co;
    const completed = completedByLine[it.id as string] ?? 0;
    const eac = current > completed ? current : completed; // simple EAC: max of plan vs spent
    return {
      id: it.id,
      description: it.description,
      category: it.category,
      cost_class: it.cost_class,
      original,
      co,
      current,
      completed,
      eac,
      variance: eac - original,
    };
  });
  variances.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  const topVariances = variances.slice(0, 8);

  const totals = variances.reduce(
    (a, v) => ({
      original: a.original + v.original,
      co: a.co + v.co,
      eac: a.eac + v.eac,
    }),
    { original: 0, co: 0, eac: 0 }
  );
  const netVariance = totals.eac - totals.original;

  const approvedCos = cos
    .filter((c: Record<string, unknown>) => c.status === "approved")
    .slice(0, 12)
    .map((c: Record<string, unknown>) => ({
      number: c.co_number,
      title: c.title,
      cost_impact: Number(c.cost_impact) || 0,
      schedule_impact: Number(c.schedule_impact_days) || 0,
      hardcost_category: c.hardcost_category,
      hardcost_item_description: c.hardcost_item_description,
    }));

  const openRfis = rfis
    .filter((r: Record<string, unknown>) => r.status !== "closed" && r.status !== "answered")
    .slice(0, 8)
    .map((r: Record<string, unknown>) => ({
      number: r.rfi_number,
      subject: r.subject,
      cost_impact: r.cost_impact === null ? null : Number(r.cost_impact),
      response_required_by: r.response_required_by,
    }));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `You are a construction project manager writing a variance narrative for an owner / lender update.

Project totals (active budget version: ${active?.label ?? "—"}):
- Original budget: ${fc(totals.original)}
- Approved COs: ${fc(totals.co)}
- Current EAC: ${fc(totals.eac)}
- Net variance vs original: ${netVariance >= 0 ? "+" : ""}${fc(netVariance)}

Top variance lines (by absolute $):
${topVariances.map((v) => `- ${v.description} [${v.category}, ${v.cost_class}]: orig ${fc(v.original)} → EAC ${fc(v.eac)} (${v.variance >= 0 ? "+" : ""}${fc(v.variance)})`).join("\n")}

Approved change orders (driving the variance):
${approvedCos.length === 0 ? "(none)" : approvedCos.map((c) => `- CO #${c.number}: ${c.title} (${c.cost_impact >= 0 ? "+" : ""}${fc(c.cost_impact)}, ${c.schedule_impact > 0 ? "+" : ""}${c.schedule_impact}d)${c.hardcost_item_description ? ` → ${c.hardcost_item_description}` : c.hardcost_category ? ` → ${c.hardcost_category}` : ""}`).join("\n")}

Open RFIs that may drive future variance:
${openRfis.length === 0 ? "(none)" : openRfis.map((r) => `- RFI ${r.number ?? "?"}: ${r.subject}${r.cost_impact !== null ? ` (claim: ${fc(r.cost_impact)})` : ""}`).join("\n")}

Write a 3–5 sentence variance narrative for an owner update. Lead with the headline number. Reference specific COs and lines that drive the variance. Avoid generic statements. Don't invent numbers; only reference what's in the data above. End with one sentence about open risk (RFIs trending into COs, or lines tracking ahead of plan).`;

  const response = await client.messages.create({
    model: await getActiveModel(),
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";

  return NextResponse.json({
    data: {
      narrative: text.trim(),
      totals: { ...totals, variance: netVariance },
      top_variances: topVariances,
      approved_co_count: cos.filter((c: Record<string, unknown>) => c.status === "approved").length,
      open_rfi_count: openRfis.length,
    },
  });
}
