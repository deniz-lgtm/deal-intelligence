import { NextRequest, NextResponse } from "next/server";
import {
  dealQueries,
  progressReportQueries,
  hardCostQueries,
  drawQueries,
  permitQueries,
  vendorQueries,
  getPool,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { CONCISE_STYLE } from "@/lib/ai-style";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const ALL_SECTIONS = [
  "executive_summary",
  "budget_narrative",
  "schedule_narrative",
  "risk_narrative",
] as const;

type SectionName = (typeof ALL_SECTIONS)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(val: unknown): string {
  const n = Number(val);
  if (isNaN(n)) return "$0";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatPct(val: unknown): string {
  const n = Number(val);
  if (isNaN(n)) return "0%";
  return n.toFixed(1) + "%";
}

function formatDate(val: unknown): string {
  if (!val) return "N/A";
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 10);
}

// ─── Data fetchers ───────────────────────────────────────────────────────────

async function fetchDevPhases(dealId: string): Promise<Record<string, unknown>[]> {
  try {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_dev_phases WHERE deal_id = $1 ORDER BY sort_order",
      [dealId]
    );
    return res.rows;
  } catch {
    return [];
  }
}

async function fetchMilestones(dealId: string): Promise<Record<string, unknown>[]> {
  try {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_milestones WHERE deal_id = $1 ORDER BY sort_order",
      [dealId]
    );
    return res.rows;
  } catch {
    return [];
  }
}

// ─── Context builders ────────────────────────────────────────────────────────

function buildBudgetContext(hardCosts: Record<string, unknown>[]): string {
  if (hardCosts.length === 0) return "No hard cost data available.";

  let totalEstimated = 0;
  let totalCommitted = 0;
  let totalIncurred = 0;
  let totalPaid = 0;
  let contingencyTotal = 0;
  let contingencyUsed = 0;

  for (const item of hardCosts) {
    const amount = Number(item.amount) || 0;
    const status = String(item.status ?? "estimated");
    const category = String(item.category ?? "").toLowerCase();

    totalEstimated += amount;
    if (status === "committed" || status === "incurred" || status === "paid") totalCommitted += amount;
    if (status === "incurred" || status === "paid") totalIncurred += amount;
    if (status === "paid") totalPaid += amount;
    if (category.includes("contingency")) {
      contingencyTotal += amount;
      if (status === "incurred" || status === "paid") contingencyUsed += amount;
    }
  }

  const lines = [
    `Total Estimated: ${formatCurrency(totalEstimated)}`,
    `Total Committed: ${formatCurrency(totalCommitted)}`,
    `Total Incurred: ${formatCurrency(totalIncurred)}`,
    `Total Paid: ${formatCurrency(totalPaid)}`,
    `Line Items: ${hardCosts.length}`,
  ];

  if (contingencyTotal > 0) {
    lines.push(`Contingency Budget: ${formatCurrency(contingencyTotal)}`);
    lines.push(`Contingency Used: ${formatCurrency(contingencyUsed)} (${formatPct((contingencyUsed / contingencyTotal) * 100)})`);
  }

  return lines.join("\n");
}

function buildDrawContext(draws: Record<string, unknown>[]): string {
  if (draws.length === 0) return "No draw data available.";

  let totalFunded = 0;
  const pendingDraws: Record<string, unknown>[] = [];

  for (const draw of draws) {
    const status = String(draw.status ?? "");
    const amountApproved = Number(draw.amount_approved) || 0;
    if (status === "funded") totalFunded += amountApproved;
    if (status === "submitted" || status === "approved" || status === "draft") {
      pendingDraws.push(draw);
    }
  }

  const lines = [
    `Total Draws: ${draws.length}`,
    `Total Funded: ${formatCurrency(totalFunded)}`,
    `Pending Draws: ${pendingDraws.length}`,
  ];

  for (const draw of pendingDraws) {
    lines.push(
      `  - Draw #${draw.draw_number} (${draw.status}): ${formatCurrency(draw.amount_requested)} requested`
    );
  }

  return lines.join("\n");
}

function buildPermitContext(permits: Record<string, unknown>[]): string {
  if (permits.length === 0) return "No permit data available.";

  const byStatus: Record<string, number> = {};
  for (const p of permits) {
    const status = String(p.status ?? "unknown");
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  const lines = [`Total Permits: ${permits.length}`];
  for (const [status, count] of Object.entries(byStatus)) {
    lines.push(`  ${status}: ${count}`);
  }

  return lines.join("\n");
}

function buildVendorContext(vendors: Record<string, unknown>[]): string {
  if (vendors.length === 0) return "No vendor data available.";

  const lines = [`Active Vendors: ${vendors.length}`];
  for (const v of vendors) {
    const name = v.name || v.company_name || "Unnamed";
    const role = v.role || "N/A";
    lines.push(`  - ${name} (${role})`);
  }

  return lines.join("\n");
}

function buildPhaseContext(phases: Record<string, unknown>[]): string {
  if (phases.length === 0) return "No development phase data available.";

  const lines: string[] = [];
  for (const p of phases) {
    const name = p.name || p.title || "Unnamed Phase";
    const pctComplete = formatPct(p.pct_complete ?? p.percent_complete ?? 0);
    const status = p.status || "unknown";
    lines.push(`  - ${name}: ${pctComplete} complete (${status})`);
  }

  return lines.join("\n");
}

function buildMilestoneContext(milestones: Record<string, unknown>[]): string {
  if (milestones.length === 0) return "No milestone data available.";

  const lines: string[] = [];
  for (const m of milestones) {
    const title = m.title || "Unnamed";
    const dueDate = formatDate(m.due_date || m.target_date);
    const status = m.status || m.stage || "unknown";
    lines.push(`  - ${title} — due ${dueDate} (${status})`);
  }

  return lines.join("\n");
}

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    // 1. Fetch the progress report
    const report = await progressReportQueries.getById(params.reportId);
    if (!report || report.deal_id !== params.id) {
      return NextResponse.json({ error: "Progress report not found" }, { status: 404 });
    }

    // 2. Parse requested sections from body
    let sections: SectionName[] = [...ALL_SECTIONS];
    try {
      const body = await req.json();
      if (body.sections && Array.isArray(body.sections)) {
        const valid = body.sections.filter((s: string) =>
          (ALL_SECTIONS as readonly string[]).includes(s)
        ) as SectionName[];
        if (valid.length > 0) sections = valid;
      }
    } catch {
      // Body may be empty — use default sections
    }

    // 3. Fetch all deal context in parallel
    const [deal, hardCosts, draws, permits, vendors, devPhases, milestones] =
      await Promise.all([
        dealQueries.getById(params.id),
        hardCostQueries.getByDealId(params.id),
        drawQueries.getByDealId(params.id),
        permitQueries.getByDealId(params.id),
        vendorQueries.getByDealId(params.id),
        fetchDevPhases(params.id),
        fetchMilestones(params.id),
      ]);

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // 4. Build context strings
    const budgetContext = buildBudgetContext(hardCosts as Record<string, unknown>[]);
    const drawContext = buildDrawContext(draws as Record<string, unknown>[]);
    const permitContext = buildPermitContext(permits as Record<string, unknown>[]);
    const vendorContext = buildVendorContext(vendors as Record<string, unknown>[]);
    const phaseContext = buildPhaseContext(devPhases);
    const milestoneContext = buildMilestoneContext(milestones);

    const reportType = report.report_type === "monthly" ? "monthly" : "weekly";
    const periodStart = formatDate(report.period_start);
    const periodEnd = formatDate(report.period_end);

    const toneInstruction =
      reportType === "weekly"
        ? "WEEKLY: bullets only, 4-6 per section. Cite numbers. Every bullet = what happened OR a blocker."
        : "MONTHLY (LP-facing): 1 bold takeaway sentence per section + 4-6 bullets. Numbers, not adjectives. Risks get mitigants in the same bullet.";

    const sectionList = sections.map((s) => `"${s}"`).join(", ");

    // 5. Build prompt
    const prompt = `${CONCISE_STYLE}

You are a construction project reporting specialist for commercial real estate development.

Generate a ${reportType} progress report for the period ${periodStart} to ${periodEnd}.

DEAL: ${deal.name}
ADDRESS: ${deal.address}, ${deal.city}, ${deal.state}
PROPERTY TYPE: ${deal.property_type}

${toneInstruction}

CONTRACTOR INPUT:
Summary: ${report.summary || "Not yet submitted"}
Work Completed: ${report.work_completed || "Not yet submitted"}
Work Planned: ${report.work_planned || "Not yet submitted"}
Issues: ${report.issues || "None reported"}
Weather Delays: ${report.weather_delays || "None reported"}
Percent Complete: ${report.pct_complete != null ? formatPct(report.pct_complete) : "Not reported"}

BUDGET DATA:
${budgetContext}

DRAW SCHEDULE:
${drawContext}

PERMITS:
${permitContext}

VENDORS:
${vendorContext}

SCHEDULE (Dev Phases):
${phaseContext}

MILESTONES:
${milestoneContext}

Generate the following sections as JSON: {${sectionList}}

Each value is a markdown string — bullets only, no multi-sentence paragraphs:
- executive_summary: % complete, schedule vs. plan, budget vs. plan, top risk. 4-6 bullets.
- budget_narrative: total committed vs. budget, contingency remaining, variance drivers. 4-6 bullets.
- schedule_narrative: phase completions this period, critical-path milestones ahead, slip vs. baseline. 4-6 bullets.
- risk_narrative: active issues with mitigants inline, weather impact days, permitting status. 3-5 bullets.

Only include the sections requested: ${sectionList}.
Respond ONLY with valid JSON — no markdown fences, no commentary.`;

    // 6. Call Claude
    const client = getClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    // 7. Parse AI response
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI returned invalid format" }, { status: 500 });
    }

    const generated = JSON.parse(jsonMatch[0]) as Record<string, string>;

    // 8. Save generated sections to report
    const updatePayload: Record<string, string> = {};
    for (const section of sections) {
      const aiField = `ai_${section}` as string;
      if (generated[section]) {
        updatePayload[aiField] = generated[section];
      }
    }

    const updated = await progressReportQueries.update(params.reportId, updatePayload);

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("POST /api/deals/[id]/progress-reports/[reportId]/ai-generate error:", error);
    return NextResponse.json({ error: "AI report generation failed" }, { status: 500 });
  }
}
