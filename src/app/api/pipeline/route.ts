import { NextResponse } from "next/server";
import { pipelineStageQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { DEAL_PIPELINE, DEAL_STAGE_LABELS } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline
 * Returns the effective pipeline (DB overrides on top of defaults).
 */
export async function GET() {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  let dbStages: Awaited<ReturnType<typeof pipelineStageQueries.listAll>> = [];
  try {
    dbStages = await pipelineStageQueries.listAll();
  } catch {
    /* fall through to defaults */
  }

  if (dbStages.length === 0) {
    const defaults = DEAL_PIPELINE.map((id, i) => ({
      id,
      label: DEAL_STAGE_LABELS[id] ?? id,
      sort_order: i,
      color: null,
      is_terminal: id === "closed",
    }));
    return NextResponse.json({ data: defaults });
  }
  return NextResponse.json({ data: dbStages });
}
