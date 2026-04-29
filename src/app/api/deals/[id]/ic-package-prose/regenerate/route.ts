/**
 * POST /api/deals/[id]/ic-package-prose/regenerate
 * Body: { context: DealContext, section: SectionKey }
 * Returns: { prose: Partial<ProseSections> }
 *
 * Used by per-section "Regenerate" buttons in the inline editor so a
 * user can redraft just the Risk block without disturbing edits to
 * the Executive Thesis.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { regenerateSection } from "@/lib/ic-package-prose";
import { devPhaseQueries } from "@/lib/db";
import { summarizeSchedule } from "@/lib/schedule-summary";
import type { DealContext } from "@/components/ic-package/types";
import type { DevPhase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_SECTIONS = [
  "exec",
  "marketThesis",
  "thesisCards",
  "businessPlan",
  "risks",
  "callouts",
  "ask",
  "scenarios",
] as const;
type SectionKey = (typeof VALID_SECTIONS)[number];

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
    const section = body.section as string | undefined;

    if (!context || !context.dealName) {
      return NextResponse.json({ error: "Missing deal context" }, { status: 400 });
    }
    if (!section || !VALID_SECTIONS.includes(section as SectionKey)) {
      return NextResponse.json(
        { error: `Invalid section. Expected one of: ${VALID_SECTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Mirror the generate route: hydrate schedule summary server-side
    // so per-section regenerations carry the same timeline context the
    // initial generate had access to.
    let scheduleSummary = context.scheduleSummary;
    try {
      const phases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
      if (phases.length > 0) {
        scheduleSummary = summarizeSchedule(phases);
      }
    } catch (e) {
      console.warn("Schedule summary hydration failed; continuing without it:", e);
    }

    const prose = await regenerateSection(
      { ...context, scheduleSummary },
      section as SectionKey
    );
    return NextResponse.json({ prose });
  } catch (err) {
    console.error("POST /api/deals/[id]/ic-package-prose/regenerate error:", err);
    const message = err instanceof Error ? err.message : "Regeneration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
