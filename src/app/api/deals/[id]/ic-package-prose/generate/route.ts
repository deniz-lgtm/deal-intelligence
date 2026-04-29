/**
 * POST /api/deals/[id]/ic-package-prose/generate
 * Calls Claude to produce a full-document IC Package prose draft for
 * the given DealContext. Doesn't persist — the wizard is free to edit
 * the response before saving it via PUT /ic-package-prose.
 *
 * Server-side merge: even when the client doesn't pass scheduleSummary
 * on the context, we hydrate it from `deal_dev_phases` so the prose
 * generator can reference real dates and per-track budgets in the
 * business-plan section.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { generateProse } from "@/lib/ic-package-prose";
import { devPhaseQueries } from "@/lib/db";
import { summarizeSchedule } from "@/lib/schedule-summary";
import type { DealContext } from "@/components/ic-package/types";
import type { DevPhase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const body = await req.json();
    const context = body.context as DealContext | undefined;
    if (!context || !context.dealName) {
      return NextResponse.json({ error: "Missing deal context" }, { status: 400 });
    }

    // Hydrate the schedule summary server-side so the prose generator
    // always sees timeline + budget data when phases exist on the deal.
    // Failures are swallowed — schedule data is enrichment, not a hard
    // requirement for prose generation.
    let scheduleSummary = context.scheduleSummary;
    try {
      const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
      if (phases.length > 0) {
        scheduleSummary = summarizeSchedule(phases);
      }
    } catch (e) {
      console.warn("Schedule summary hydration failed; continuing without it:", e);
    }

    const prose = await generateProse({ ...context, scheduleSummary });
    return NextResponse.json({ prose });
  } catch (err) {
    console.error("POST /api/deals/[id]/ic-package-prose/generate error:", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
