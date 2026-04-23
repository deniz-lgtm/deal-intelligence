import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { computeSchedule, diffComputedDates } from "@/lib/dev-schedule-compute";
import type { DevPhase } from "@/lib/types";

export const dynamic = "force-dynamic";

interface CommitPhase {
  label: string;
  phase_key: string;
  start_date: string | null;
  duration_days: number;
  predecessor_key: string | null;
}

/**
 * Step 2 of GC schedule import: persist the analyst-approved activities
 * as Construction-track phases. Supports two modes: replace the deal's
 * existing construction schedule wholesale, or append (useful when the
 * analyst has manually seeded a few phases and the PDF fills in the
 * rest).
 *
 * Predecessor references are keyed by phase_key within the uploaded
 * batch, so cross-activity chains from the PDF survive even though DB
 * ids are freshly minted here.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const phases: CommitPhase[] = Array.isArray(body?.phases) ? body.phases : [];
    const mode: "replace" | "append" = body?.mode === "append" ? "append" : "replace";
    if (phases.length === 0) {
      return NextResponse.json({ error: "No phases to import" }, { status: 400 });
    }

    const existing = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];

    // If replacing, first clear every construction-track row. Cross-track
    // dependencies pointing into construction (there shouldn't be many —
    // only a stretch case) survive because we null out their predecessor
    // first.
    if (mode === "replace") {
      const conPhases = existing.filter((p) => (p.track ?? "development") === "construction");
      const conIds = new Set(conPhases.map((p) => p.id));
      for (const p of existing) {
        if (p.predecessor_id && conIds.has(p.predecessor_id)) {
          await devPhaseQueries.update(p.id, { predecessor_id: null });
        }
      }
      for (const p of conPhases) {
        await devPhaseQueries.delete(p.id);
      }
    }

    // Allow imported activities to hang off the last pre-existing phase
    // (typically the Dev `gc_selection` milestone when using the default
    // seed) if their root predecessor_key doesn't match anything in the
    // batch. This is what makes a freshly-imported GC schedule anchor
    // to the end of the development chain automatically.
    const postClear = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const devPhases = postClear
      .filter((p) => (p.track ?? "development") === "development")
      .sort((a, b) => (a.end_date ?? "").localeCompare(b.end_date ?? ""));
    const chainAnchor = devPhases.length > 0 ? devPhases[devPhases.length - 1].id : null;

    // Insert new rows in two passes: create-then-link, like the seed
    // route, so in-batch predecessor_keys can resolve.
    const idByKey = new Map<string, string>();
    let sort = existing.length;
    for (const p of phases) {
      const id = uuidv4();
      idByKey.set(p.phase_key, id);
      await devPhaseQueries.create({
        id,
        deal_id: params.id,
        track: "construction",
        phase_key: p.phase_key,
        label: p.label,
        start_date: p.start_date ?? null,
        duration_days: p.duration_days,
        lag_days: 0,
        predecessor_id: null, // resolved in the next pass
        sort_order: sort++,
        is_milestone: p.duration_days === 0,
      });
    }

    for (const p of phases) {
      const selfId = idByKey.get(p.phase_key);
      if (!selfId) continue;
      let predId: string | null = null;
      if (p.predecessor_key) {
        predId = idByKey.get(p.predecessor_key) ?? null;
      }
      // If the first construction row has no in-batch predecessor and no
      // explicit start date, hang it off the last Dev phase so the CPM
      // pass produces a sane date.
      if (!predId && !p.predecessor_key && !p.start_date && chainAnchor) {
        predId = chainAnchor;
      }
      if (predId) {
        await devPhaseQueries.update(selfId, { predecessor_id: predId });
      }
    }

    // Recompute the whole graph so every downstream CPM field is
    // accurate.
    const all = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const computed = computeSchedule(all);
    const updates = diffComputedDates(all, computed);
    if (updates.length > 0) await devPhaseQueries.bulkUpdateSchedule(updates);

    const finalPhases = await devPhaseQueries.getByDealId(params.id);
    return NextResponse.json({
      data: {
        imported: phases.length,
        mode,
        phases: finalPhases,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/import/commit error:", error);
    return NextResponse.json({ error: "Failed to import schedule" }, { status: 500 });
  }
}
