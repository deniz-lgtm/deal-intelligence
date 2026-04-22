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
import type { DealContext } from "@/components/ic-package/types";

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

    const prose = await regenerateSection(context, section as SectionKey);
    return NextResponse.json({ prose });
  } catch (err) {
    console.error("POST /api/deals/[id]/ic-package-prose/regenerate error:", err);
    const message = err instanceof Error ? err.message : "Regeneration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
