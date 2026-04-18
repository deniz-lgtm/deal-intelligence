import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  chatQueries,
  documentQueries,
  dealQueries,
  dealNoteQueries,
  underwritingQueries,
} from "@/lib/db";
import { chatUniversal } from "@/lib/claude";
import type { UniversalChatContext } from "@/lib/claude";
import {
  requireAuth,
  requireDealAccess,
  requirePermission,
  syncCurrentUser,
} from "@/lib/auth";
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
    let documents: Document[] = [];
    if (dealId) {
      const { deal: accessDeal, errorResponse: accessError } =
        await requireDealAccess(dealId, userId);
      if (accessError) return accessError;

      const d = accessDeal as {
        id: string;
        name: string;
        context_notes?: string | null;
        property_type?: string | null;
        status?: string | null;
        city?: string | null;
        state?: string | null;
      };
      const memoryText = await dealNoteQueries.getMemoryText(dealId);
      deal = {
        id: d.id,
        name: d.name,
        context_notes: memoryText || d.context_notes || null,
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
        if (action.type === "context_saved" && action.note) {
          await dealNoteQueries.create({
            id: uuidv4(),
            deal_id: dealId,
            text: action.note,
            category: action.category || "context",
            source: "chat",
          });
        } else if (action.type === "deal_updated" && action.fields) {
          await dealQueries.update(dealId, action.fields);
        } else if (action.type === "underwriting_updated" && action.fields) {
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
