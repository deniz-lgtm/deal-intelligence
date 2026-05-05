import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  chatQueries,
  documentQueries,
  dealQueries,
  dealNoteQueries,
  devPhaseQueries,
  businessPlanQueries,
  loiQueries,
  omAnalysisQueries,
  playbookQueries,
  underwritingQueries,
} from "@/lib/db";
import { chatUniversal } from "@/lib/claude";
import type { UniversalChatContext } from "@/lib/claude";
import { formatPlaybookContext } from "@/lib/playbook";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import {
  requireAuth,
  requireDealAccess,
  requireDealEditAccess,
  requirePermission,
  syncCurrentUser,
} from "@/lib/auth";
import { rateLimit, CHAT_LIMIT } from "@/lib/rate-limit";
import type { Document } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * Universal chatbot API. The floating widget on every page posts here.
 *
 *   POST   — send a message. Body: { message, deal_id?, page_context? }
 *   GET    — load conversation for the current user. Query: deal_id?
 *   DELETE — clear conversation for the current user. Query: deal_id?
 *
 * When deal_id is present the widget behaves as the per-deal assistant and
 * can save context, update deal fields, and patch underwriting. Without a
 * deal_id it's a workspace-level helper that answers questions and points
 * the user at relevant pages.
 */

type PageContextBody = {
  route?: string;
  screen_summary?: string;
};

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("ai.chat");
  if (errorResponse) return errorResponse;

  // Per-user rate limit (shared scope with /api/chat — both surfaces
  // call into Claude with expensive context, and a single user
  // hammering either route deserves the same backoff).
  const limited = rateLimit("chat", userId, CHAT_LIMIT);
  if (limited) return limited;

  try {
    const body = (await req.json()) as {
      message?: string;
      deal_id?: string | null;
      page_context?: PageContextBody | null;
    };
    const { message } = body;
    const dealId = body.deal_id || null;
    const pageCtx: PageContextBody = body.page_context || {};

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    // If a deal is in scope, check access. Otherwise it's a workspace chat.
    let deal: UniversalChatContext["deal"] = null;
    let canEditDeal = false;
    let documents: Document[] = [];
    if (dealId) {
      const { deal: accessDeal, errorResponse: accessError } =
        await requireDealAccess(dealId, userId);
      if (accessError) return accessError;
      const { errorResponse: editError } = await requireDealEditAccess(dealId, userId);
      canEditDeal = !editError;

      const d = accessDeal as {
        id: string;
        name: string;
        context_notes?: string | null;
        business_plan_id?: string | null;
        property_type?: string | null;
        status?: string | null;
        city?: string | null;
        state?: string | null;
      };
      const memoryText = await dealNoteQueries.getMemoryText(dealId);
      const dealFacts = await buildDealFacts(dealId, d.business_plan_id ?? null).catch((error) => {
        console.warn("universal-chat deal facts failed:", error);
        return null;
      });
      deal = {
        id: d.id,
        name: d.name,
        context_notes: memoryText || d.context_notes || null,
        deal_facts: dealFacts,
        property_type: d.property_type ?? null,
        status: d.status ?? null,
        city: d.city ?? null,
        state: d.state ?? null,
      };
      documents = (await documentQueries.getByDealId(dealId)) as Document[];
    }

    const rawHistory = (await chatQueries.getForUser(
      userId,
      dealId,
      20
    )) as Array<{ role: "user" | "assistant"; content: string }>;
    const history = rawHistory.map((m) => ({ role: m.role, content: m.content }));
    const playbookHits = await playbookQueries.search(message, 4).catch((error) => {
      console.warn("universal-chat playbook search failed:", error);
      return [];
    });

    // Persist the user message with page context for later review
    await chatQueries.create({
      id: uuidv4(),
      deal_id: dealId,
      user_id: userId,
      role: "user",
      content: message,
      page_context: pageCtx,
    });

    const { response, actions } = await chatUniversal(
      {
        deal,
        screen: pageCtx.screen_summary || null,
        route: pageCtx.route || null,
        can_edit_deal: canEditDeal,
        playbook_context: playbookHits.length > 0 ? formatPlaybookContext(playbookHits) : null,
      },
      documents,
      history,
      message
    );

    // Execute side-effecting actions. Only valid when a deal is active —
    // the tool schema already gates these on an active deal, but we
    // double-check server-side for safety.
    if (dealId) {
      for (const action of actions) {
        if (action.type === "context_saved" && action.note && canEditDeal) {
          await dealNoteQueries.create({
            id: uuidv4(),
            deal_id: dealId,
            text: action.note,
            category: action.category || "context",
            source: "chat",
          });
        } else if (action.type === "deal_updated" && action.fields && canEditDeal) {
          await dealQueries.update(dealId, action.fields);
        } else if (action.type === "underwriting_updated" && action.fields && canEditDeal) {
          const existing = (await underwritingQueries.getByDealId(dealId)) as
            | { id: string; data: unknown }
            | null;
          if (existing) {
            const current =
              typeof existing.data === "string"
                ? JSON.parse(existing.data)
                : existing.data ?? {};
            const merged = { ...current, ...action.fields };
            await underwritingQueries.upsert(
              dealId,
              existing.id,
              JSON.stringify(merged)
            );
          } else {
            await underwritingQueries.upsert(
              dealId,
              uuidv4(),
              JSON.stringify(action.fields)
            );
          }
        } else if (
          action.type === "schedule_item_created" &&
          action.schedule_item &&
          canEditDeal
        ) {
          const item = action.schedule_item;
          let resolvedTrack = item.track || "development";
          if (item.parent_phase_id) {
            const phases = await devPhaseQueries.getByDealId(dealId);
            const parent = phases.find((phase) => phase.id === item.parent_phase_id);
            if (parent) {
              resolvedTrack = parent.track || resolvedTrack;
            } else {
              item.parent_phase_id = null;
            }
          }
          await devPhaseQueries.create({
            id: uuidv4(),
            deal_id: dealId,
            track: resolvedTrack,
            kind: item.kind || "task",
            phase_key: `chat_${Date.now()}`,
            label: item.label,
            duration_days:
              item.kind === "milestone"
                ? 0
                : typeof item.duration_days === "number"
                  ? item.duration_days
                  : null,
            parent_phase_id: item.parent_phase_id ?? null,
            task_owner: item.task_owner ?? null,
            notes: item.notes ?? null,
            status: "not_started",
            pct_complete: 0,
            sort_order: 0,
            is_milestone: item.kind === "milestone",
          });
          try {
            await recomputeSchedule(dealId);
          } catch (err) {
            console.error("universal-chat schedule recompute error:", err);
          }
        }
      }
    }

    await chatQueries.create({
      id: uuidv4(),
      deal_id: dealId,
      user_id: userId,
      role: "assistant",
      content: response,
      metadata: actions.length > 0 ? actions : null,
      page_context: pageCtx,
    });

    return NextResponse.json({ data: { message: response, actions } });
  } catch (error) {
    console.error("POST /api/universal-chat error:", error);
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

    if (dealId) {
      const { errorResponse: accessError } = await requireDealAccess(
        dealId,
        userId
      );
      if (accessError) return accessError;
    }

    const messages = await chatQueries.getForUser(userId, dealId, 50);
    return NextResponse.json({ data: messages });
  } catch (error) {
    console.error("GET /api/universal-chat error:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

async function buildDealFacts(dealId: string, businessPlanId: string | null): Promise<string | null> {
  const [uwRow, omAnalysis, loiRow, businessPlan] = await Promise.all([
    underwritingQueries.getByDealId(dealId).catch(() => null),
    omAnalysisQueries.getByDealId(dealId).catch(() => null),
    loiQueries.getByDealId(dealId).catch(() => null),
    businessPlanId ? businessPlanQueries.getById(businessPlanId).catch(() => null) : Promise.resolve(null),
  ]);

  const sections: string[] = [];
  const uw = parseObject((uwRow as { data?: unknown } | null)?.data);
  const uwLines: string[] = [];
  const push = (lines: string[], label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  push(uwLines, "Purchase Price", formatCurrency(uw.purchase_price));
  push(uwLines, "Vacancy", formatPercent(uw.vacancy_rate));
  push(uwLines, "Exit Cap", formatPercent(uw.exit_cap_rate));
  push(uwLines, "Hold Period", formatNumber(uw.hold_period_years, " years"));
  push(uwLines, "Acquisition LTC", formatPercent(uw.acq_ltc));
  push(uwLines, "Acquisition Rate", formatPercent(uw.acq_interest_rate));
  if (uwLines.length > 0) sections.push(`UNDERWRITING\n${uwLines.join("\n")}`);

  const om = omAnalysis as Record<string, unknown> | null;
  if (om && om.status === "complete") {
    const omLines: string[] = [];
    push(omLines, "Asking Price", formatCurrency(om.asking_price));
    push(omLines, "Reported NOI", formatCurrency(om.noi));
    push(omLines, "Reported Cap Rate", formatPercent(om.cap_rate));
    push(omLines, "Reported Vacancy", formatPercent(om.vacancy_rate));
    push(omLines, "OM Score", formatNumber(om.deal_score, "/10"));
    if (typeof om.summary === "string" && om.summary.trim()) {
      push(omLines, "Summary", om.summary.trim().slice(0, 500));
    }
    if (Array.isArray(om.red_flags) && om.red_flags.length > 0) {
      const flags = om.red_flags
        .slice(0, 5)
        .map((flag) => {
          const rf = flag as Record<string, unknown>;
          return [rf.severity, rf.category, rf.description].filter(Boolean).join(" - ");
        })
        .filter(Boolean)
        .join("; ");
      push(omLines, "Red Flags", flags || null);
    }
    if (omLines.length > 0) sections.push(`OM ANALYSIS\n${omLines.join("\n")}`);
  }

  const loi = loiRow as { data?: unknown; executed?: boolean } | null;
  if (loi) {
    const loiData = parseObject(loi.data);
    const loiLines: string[] = [`Status: ${loi.executed ? "executed" : "draft"}`];
    push(loiLines, "Purchase Price", formatCurrency(loiData.purchase_price));
    push(loiLines, "Earnest Money", formatCurrency(loiData.earnest_money));
    push(loiLines, "DD Period", formatNumber(loiData.due_diligence_days, " days"));
    push(loiLines, "Closing", formatNumber(loiData.closing_days, " days"));
    sections.push(`LOI\n${loiLines.join("\n")}`);
  }

  const bp = businessPlan as Record<string, unknown> | null;
  if (bp) {
    const bpLines: string[] = [];
    if (typeof bp.name === "string" && bp.name.trim()) push(bpLines, "Name", bp.name.trim());
    if (Array.isArray(bp.investment_theses) && bp.investment_theses.length > 0) {
      push(bpLines, "Investment Thesis", bp.investment_theses.join(", "));
    }
    if (Array.isArray(bp.target_markets) && bp.target_markets.length > 0) {
      push(bpLines, "Target Markets", bp.target_markets.join(", "));
    }
    if (typeof bp.description === "string" && bp.description.trim()) {
      push(bpLines, "Strategy", bp.description.trim().slice(0, 500));
    }
    if (bpLines.length > 0) sections.push(`BUSINESS PLAN\n${bpLines.join("\n")}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatCurrency(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : null;
}

function formatPercent(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}%` : null;
}

function formatNumber(value: unknown, suffix = ""): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString()}${suffix}` : null;
}

export async function DELETE(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");

    if (dealId) {
      const { errorResponse: accessError } = await requireDealAccess(
        dealId,
        userId
      );
      if (accessError) return accessError;
    }

    await chatQueries.clearForUser(userId, dealId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/universal-chat error:", error);
    return NextResponse.json(
      { error: "Failed to clear chat" },
      { status: 500 }
    );
  }
}
