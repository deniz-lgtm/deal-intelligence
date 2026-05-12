import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  chatQueries,
  documentQueries,
  dealQueries,
  dealNoteQueries,
  devPhaseQueries,
  businessPlanQueries,
  checklistQueries,
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

type ScheduleTrack = "acquisition" | "development" | "construction";

type ResolvedScheduleParent = {
  id: string;
  label: string;
  track: ScheduleTrack;
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
    const playbookHits = await playbookQueries.search(message, 8).catch((error) => {
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
          const noteId = uuidv4();
          await dealNoteQueries.create({
            id: noteId,
            deal_id: dealId,
            text: action.note,
            category: action.category || "context",
            source: "chat",
          });
          action.note_id = noteId;
        } else if (action.type === "note_created" && action.note && canEditDeal) {
          const noteId = uuidv4();
          await dealNoteQueries.create({
            id: noteId,
            deal_id: dealId,
            text: action.note,
            category: action.category || "context",
            source: "chat",
          });
          action.note_id = noteId;
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
          const phases = await devPhaseQueries.getByDealId(dealId);
          let resolvedTrack = item.track || "development";
          let resolvedParentId = item.parent_phase_id ?? null;
          let parentRequestedButMissing = false;
          if (item.parent_phase_id) {
            const parent = resolveScheduleParent(phases, item.parent_phase_id, item.parent_phase_label);
            if (parent) {
              resolvedTrack = parent.track || resolvedTrack;
              resolvedParentId = parent.id;
            } else {
              resolvedParentId = null;
              parentRequestedButMissing = true;
            }
          } else if (item.parent_phase_label) {
            const parent = resolveScheduleParent(phases, null, item.parent_phase_label);
            if (parent) {
              resolvedTrack = parent.track || resolvedTrack;
              resolvedParentId = parent.id;
            } else {
              parentRequestedButMissing = true;
            }
          }
          if (parentRequestedButMissing) {
            action.display = item.parent_phase_label
              ? `I couldn't find "${item.parent_phase_label}" in this deal's schedule, so I did not create the item. Open the schedule, pick the parent row, and I can try again.`
              : "I couldn't find that parent row in this deal's schedule, so I did not create the item.";
            action.type = "schedule_action_failed";
            action.schedule_item.id = undefined;
            continue;
          }
          const siblings = phases.filter((phase) =>
            resolvedParentId ? phase.parent_phase_id === resolvedParentId : !phase.parent_phase_id
          );
          const baseSort = siblings.reduce(
            (max, phase) => Math.max(max, Number(phase.sort_order ?? 0)),
            siblings.length
          );
          const duplicate = siblings.find(
            (phase) => normalizeScheduleLabel(phase.label) === normalizeScheduleLabel(item.label)
          );
          if (duplicate) {
            action.schedule_item.id = duplicate.id;
            action.schedule_item.parent_phase_id = resolvedParentId;
            action.display = `That schedule item already exists: ${duplicate.label}`;
            continue;
          }
          const itemId = uuidv4();
          await devPhaseQueries.create({
            id: itemId,
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
            parent_phase_id: resolvedParentId,
            task_owner: item.task_owner ?? null,
            notes: item.notes ?? null,
            status: "not_started",
            pct_complete: 0,
            sort_order: baseSort + 1,
            is_milestone: item.kind === "milestone",
          });
          action.schedule_item.id = itemId;
          action.schedule_item.parent_phase_id = resolvedParentId;
          try {
            await recomputeSchedule(dealId);
          } catch (err) {
            console.error("universal-chat schedule recompute error:", err);
          }
        } else if (
          action.type === "mini_schedule_draft" &&
          action.mini_schedule &&
          canEditDeal
        ) {
          const phases = await devPhaseQueries.getByDealId(dealId);
          const parent = resolveScheduleParent(
            phases,
            action.mini_schedule.parent_phase_id ?? null,
            action.mini_schedule.parent_phase_label ?? null
          );
          if (!parent) {
            action.display = action.mini_schedule.parent_phase_label
              ? `I couldn't find "${action.mini_schedule.parent_phase_label}" in this deal's schedule. Pick the parent phase and I can try again.`
              : "I couldn't identify the parent phase for this task plan.";
            action.mini_schedule.tasks = [];
          } else {
            action.mini_schedule.parent_phase_id = parent.id;
            action.mini_schedule.parent_phase_label = parent.label;
            action.mini_schedule.track = parent.track || action.mini_schedule.track || "development";
            action.display = `Ready to create task plan for ${parent.label}: ${action.mini_schedule.tasks.length} task${action.mini_schedule.tasks.length === 1 ? "" : "s"}`;
          }
        } else if (
          action.type === "mini_schedule_created" &&
          action.mini_schedule &&
          canEditDeal
        ) {
          const phases = await devPhaseQueries.getByDealId(dealId);
          const parent = resolveScheduleParent(
            phases,
            action.mini_schedule.parent_phase_id ?? null,
            action.mini_schedule.parent_phase_label ?? null
          );
          if (!parent) {
            action.display = action.mini_schedule.parent_phase_label
              ? `I couldn't find "${action.mini_schedule.parent_phase_label}" in this deal's schedule, so I did not create the task plan.`
              : "I couldn't identify the parent phase, so I did not create the task plan.";
            action.mini_schedule.tasks = [];
          } else {
            const existingChildren = phases.filter((phase) => phase.parent_phase_id === parent.id);
            const baseSort = existingChildren.reduce(
              (max, phase) => Math.max(max, Number(phase.sort_order ?? 0)),
              existingChildren.length
            );
            const resolvedTrack = parent.track || action.mini_schedule.track || "development";
            action.mini_schedule.parent_phase_id = parent.id;
            action.mini_schedule.parent_phase_label = parent.label;
            action.mini_schedule.track = resolvedTrack;

            for (let index = 0; index < action.mini_schedule.tasks.length; index += 1) {
              const task = action.mini_schedule.tasks[index];
              const taskId = uuidv4();
              await devPhaseQueries.create({
                id: taskId,
                deal_id: dealId,
                track: resolvedTrack,
                kind: "task",
                phase_key: `chat_mini_${Date.now()}_${index}`,
                label: task.label,
                duration_days: typeof task.duration_days === "number" ? task.duration_days : null,
                parent_phase_id: parent.id,
                task_owner: task.task_owner ?? null,
                notes: task.notes ?? null,
                status: "not_started",
                pct_complete: 0,
                sort_order: baseSort + index + 1,
                is_milestone: false,
              });
              task.id = taskId;
            }
            action.display = `Created task plan for ${parent.label}: ${action.mini_schedule.tasks.length} task${action.mini_schedule.tasks.length === 1 ? "" : "s"}`;
            try {
              await recomputeSchedule(dealId);
            } catch (err) {
              console.error("universal-chat task plan recompute error:", err);
            }
          }
        } else if (
          action.type === "checklist_item_created" &&
          action.checklist_item &&
          canEditDeal
        ) {
          const checklistId = uuidv4();
          await checklistQueries.upsert({
            id: checklistId,
            deal_id: dealId,
            category: action.checklist_item.category || "Other",
            item: action.checklist_item.item,
            status: "pending",
            notes: action.checklist_item.notes ?? null,
            ai_filled: true,
            source_document_ids: null,
          });
          action.checklist_item.id = checklistId;
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
  const [uwRow, omAnalysis, loiRow, businessPlan, scheduleRows] = await Promise.all([
    underwritingQueries.getByDealId(dealId).catch(() => null),
    omAnalysisQueries.getByDealId(dealId).catch(() => null),
    loiQueries.getByDealId(dealId).catch(() => null),
    businessPlanId ? businessPlanQueries.getById(businessPlanId).catch(() => null) : Promise.resolve(null),
    devPhaseQueries.getByDealId(dealId).catch(() => []),
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

  const schedule = Array.isArray(scheduleRows) ? scheduleRows : [];
  if (schedule.length > 0) {
    const scheduleLines = schedule
      .slice(0, 45)
      .map((phase) => {
        const p = phase as Record<string, unknown>;
        const label = typeof p.label === "string" ? p.label : "Untitled";
        const id = typeof p.id === "string" ? p.id : "";
        const track = typeof p.track === "string" ? p.track : "development";
        const kind = typeof p.kind === "string" ? p.kind : p.parent_phase_id ? "task" : "phase";
        const parent = typeof p.parent_phase_id === "string" ? p.parent_phase_id : null;
        const owner = typeof p.task_owner === "string" && p.task_owner.trim() ? ` owner=${p.task_owner}` : "";
        const status = typeof p.status === "string" ? ` status=${p.status}` : "";
        return `- ${label} [id=${id}; track=${track}; kind=${kind}${parent ? `; parent=${parent}` : ""}${owner}${status}]`;
      })
      .join("\n");
    sections.push(`SCHEDULE CONTEXT\nUse these exact ids when creating child tasks or focused task plans.\n${scheduleLines}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

function resolveScheduleParent(
  phases: Array<Record<string, unknown>>,
  parentId?: string | null,
  parentLabel?: string | null
): ResolvedScheduleParent | null {
  if (parentId) {
    const exact = phases.find((phase) => phase.id === parentId);
    if (exact) {
      return {
        id: String(exact.id),
        label: String(exact.label || "Untitled"),
        track: normalizeScheduleTrack(exact.track),
      };
    }
  }
  const normalizedLabel = normalizeScheduleLabel(parentLabel);
  if (!normalizedLabel) return null;
  const exactLabel = phases.find(
    (phase) => normalizeScheduleLabel(String(phase.label || "")) === normalizedLabel
  );
  const phase = exactLabel ?? phases.find((candidate) => {
    const candidateLabel = normalizeScheduleLabel(String(candidate.label || ""));
    return candidateLabel.includes(normalizedLabel) || normalizedLabel.includes(candidateLabel);
  });
  if (!phase) return null;
  return {
    id: String(phase.id),
    label: String(phase.label || "Untitled"),
    track: normalizeScheduleTrack(phase.track),
  };
}

function normalizeScheduleTrack(value: unknown): ScheduleTrack {
  return value === "acquisition" || value === "construction" || value === "development"
    ? value
    : "development";
}

function normalizeScheduleLabel(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
