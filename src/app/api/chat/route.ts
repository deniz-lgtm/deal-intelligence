import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { chatQueries, documentQueries, dealQueries, dealNoteQueries, underwritingQueries, businessPlanQueries } from "@/lib/db";
import { chatWithDealIntelligence } from "@/lib/claude";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";
import type { Document } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

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
