import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { chatQueries, documentQueries, dealQueries, dealNoteQueries, underwritingQueries, businessPlanQueries, omAnalysisQueries, loiQueries } from "@/lib/db";
import { chatWithDealIntelligence } from "@/lib/claude";
import { requireAuth, requireDealAccess, requirePermission, syncCurrentUser } from "@/lib/auth";
import type { Document } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("ai.chat");
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { deal_id, message } = body;

    if (!deal_id || !message) {
      return NextResponse.json(
        { error: "deal_id and message are required" },
        { status: 400 }
      );
    }

    const { deal: accessDeal, errorResponse: accessError } = await requireDealAccess(deal_id, userId);
    if (accessError) return accessError;

    const deal = accessDeal as {
      id: string;
      name: string;
      context_notes?: string | null;
      business_plan_id?: string | null;
    };

    // Build context_notes from deal_notes table (memory-included categories)
    const memoryText = await dealNoteQueries.getMemoryText(deal_id);
    deal.context_notes = memoryText || null;

    // Enrich context with a compact snapshot of Underwriting, OM Analysis,
    // LOI, and Investment Package so Chat can answer factual questions
    // ("what's the cap rate?", "what did the OM flag?", "is there an LOI?")
    // without the user having to re-paste data.
    const [uwRow, omAnalysis, loiRow] = await Promise.all([
      underwritingQueries.getByDealId(deal_id).catch(() => null),
      omAnalysisQueries.getByDealId(deal_id).catch(() => null),
      loiQueries.getByDealId(deal_id).catch(() => null),
    ]);

    const extraContext: string[] = [];

    if (uwRow?.data) {
      const uw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      const uwLines: string[] = [];
      const fc = (v: unknown) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : null;
      };
      const pct = (v: unknown) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}%` : null;
      };
      const pushKv = (label: string, formatted: string | null) => {
        if (formatted) uwLines.push(`  ${label}: ${formatted}`);
      };
      pushKv("Purchase Price", fc(uw.purchase_price));
      pushKv("Vacancy", pct(uw.vacancy_rate));
      pushKv("Exit Cap", pct(uw.exit_cap_rate));
      pushKv("Hold Period", uw.hold_period_years ? `${uw.hold_period_years}yr` : null);
      if (uw.has_financing) {
        pushKv("Acq LTC", pct(uw.acq_ltc));
        pushKv("Acq Rate", pct(uw.acq_interest_rate));
      }
      const ipMeta = uw.investment_package_meta as { generated_at?: string } | undefined;
      if (ipMeta?.generated_at) {
        uwLines.push(`  Investment Package last generated: ${new Date(ipMeta.generated_at).toLocaleDateString()}`);
      }
      if (uwLines.length > 0) {
        extraContext.push(`UNDERWRITING:\n${uwLines.join("\n")}`);
      }
    }

    if (omAnalysis && omAnalysis.status === "complete") {
      const omLines: string[] = [];
      const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;
      const pct = (v: number) => `${v.toFixed(2)}%`;
      if (omAnalysis.asking_price) omLines.push(`  Asking Price: ${fc(omAnalysis.asking_price)}`);
      if (omAnalysis.noi) omLines.push(`  Reported NOI: ${fc(omAnalysis.noi)}`);
      if (omAnalysis.cap_rate) omLines.push(`  Reported Cap Rate: ${pct(omAnalysis.cap_rate)}`);
      if (omAnalysis.vacancy_rate) omLines.push(`  Reported Vacancy: ${pct(omAnalysis.vacancy_rate)}`);
      if (omAnalysis.deal_score) omLines.push(`  OM Score: ${omAnalysis.deal_score}/10`);
      if (omAnalysis.summary) omLines.push(`  Summary: ${omAnalysis.summary}`);
      if (omAnalysis.red_flags && omAnalysis.red_flags.length > 0) {
        const flags = omAnalysis.red_flags
          .slice(0, 5)
          .map((rf) => `[${rf.severity}] ${rf.category}: ${rf.description}`)
          .join("; ");
        omLines.push(`  Red Flags: ${flags}`);
      }
      if (omLines.length > 0) {
        extraContext.push(`OM ANALYSIS:\n${omLines.join("\n")}`);
      }
    }

    if (loiRow) {
      const loiData = (loiRow as { data?: unknown }).data;
      const parsed = typeof loiData === "string" ? JSON.parse(loiData) : (loiData ?? {});
      const executed = (loiRow as { executed?: boolean }).executed;
      const loiLines: string[] = [`  Status: ${executed ? "EXECUTED" : "draft"}`];
      if (parsed.purchase_price) loiLines.push(`  Purchase Price: $${Number(parsed.purchase_price).toLocaleString()}`);
      if (parsed.earnest_money) loiLines.push(`  Earnest Money: $${Number(parsed.earnest_money).toLocaleString()}`);
      if (parsed.due_diligence_days) loiLines.push(`  DD Period: ${parsed.due_diligence_days} days`);
      if (parsed.closing_days) loiLines.push(`  Closing: ${parsed.closing_days} days`);
      extraContext.push(`LOI:\n${loiLines.join("\n")}`);
    }

    if (extraContext.length > 0) {
      const joined = extraContext.join("\n\n");
      deal.context_notes = deal.context_notes
        ? `${joined}\n\n${deal.context_notes}`
        : joined;
    }

    // Enrich context_notes with business plan if linked
    if (deal.business_plan_id) {
      const bp = await businessPlanQueries.getById(deal.business_plan_id);
      if (bp) {
        const bpLines: string[] = [`BUSINESS PLAN — ${bp.name}:`];
        const theses = bp.investment_theses || [];
        if (theses.length > 0) bpLines.push(`Investment Thesis: ${theses.join(", ")}`);
        const markets = bp.target_markets || [];
        if (markets.length > 0) bpLines.push(`Target Markets: ${markets.join(", ")}`);
        if (bp.description?.trim()) bpLines.push(`Strategy: ${bp.description.trim()}`);
        const bpContext = bpLines.join("\n");
        deal.context_notes = bpContext + (deal.context_notes ? `\n\n${deal.context_notes}` : "");
      }
    }

    const documents = await documentQueries.getByDealId(deal_id) as Document[];
    const rawHistory = await chatQueries.getByDealId(deal_id, 20) as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    const history = rawHistory.map((m) => ({ role: m.role, content: m.content }));

    // Save user message
    await chatQueries.create({ id: uuidv4(), deal_id, role: "user", content: message });

    // Run tool-use chat
    const { response, actions } = await chatWithDealIntelligence(
      deal,
      documents,
      history,
      message
    );

    // Execute actions: save context notes, update deal fields, update underwriting
    for (const action of actions) {
      if (action.type === "context_saved" && action.note) {
        await dealNoteQueries.create({
          id: uuidv4(),
          deal_id,
          text: action.note,
          category: "context",
          source: "chat",
        });
      } else if (action.type === "deal_updated" && action.fields) {
        await dealQueries.update(deal_id, action.fields);
      } else if (action.type === "underwriting_updated" && action.fields) {
        // Merge partial fields into existing underwriting data
        const existing = await underwritingQueries.getByDealId(deal_id) as { id: string; data: unknown } | null;
        if (existing) {
          const currentData = typeof existing.data === "string"
            ? JSON.parse(existing.data)
            : (existing.data ?? {});
          const merged = { ...currentData, ...action.fields };
          await underwritingQueries.upsert(deal_id, existing.id, JSON.stringify(merged));
        } else {
          const newId = uuidv4();
          await underwritingQueries.upsert(deal_id, newId, JSON.stringify(action.fields));
        }
      }
    }

    // Save assistant message with actions metadata
    await chatQueries.create({
      id: uuidv4(),
      deal_id,
      role: "assistant",
      content: response,
      metadata: actions.length > 0 ? actions : null,
    });

    return NextResponse.json({ data: { message: response, actions } });
  } catch (error) {
    console.error("POST /api/chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    const messages = await chatQueries.getByDealId(dealId);
    return NextResponse.json({ data: messages });
  } catch (error) {
    console.error("GET /api/chat error:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    await chatQueries.clear(dealId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/chat error:", error);
    return NextResponse.json({ error: "Failed to clear chat" }, { status: 500 });
  }
}
