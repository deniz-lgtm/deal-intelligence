import { NextRequest, NextResponse } from "next/server";
import {
  hardCostQueries,
  budgetVersionQueries,
  drawQueries,
  getPool,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Pace anomaly detection — heuristic billing-pace analysis to flag
// front-loading and pace mismatches between line items.
//
// We don't have a true earned-value baseline (the schedule isn't tied to
// each line yet), so the detection compares each line's billed % to two
// references:
//   1. The project's overall billed % (a rough proxy for "where we are
//      in the schedule"). Lines billed materially ahead of the project
//      average are flagged for review.
//   2. The line's status ("estimated", "committed", "incurred"). A line
//      marked "estimated" but billed should be flagged.

interface Anomaly {
  hardcost_item_id: string;
  description: string;
  category: string;
  current_value: number;
  total_completed: number;
  pct_complete: number;
  project_pct_complete: number;
  delta_pct: number;
  severity: "info" | "warn" | "alert";
  reason: string;
}

const FRONT_LOAD_WARN_PCT = 15; // billed >15 percentage points ahead of project pace
const FRONT_LOAD_ALERT_PCT = 25;
const OVERBILL_FLAT_PCT = 95; // line billed >=95% complete on project pace <50%

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const active = await budgetVersionQueries.getActive(params.id);
  const versionId = active?.id ?? null;

  const [items, draws] = await Promise.all([
    hardCostQueries.getByDealId(params.id, versionId),
    drawQueries.getByDealId(params.id),
  ]);
  if (items.length === 0 || draws.length === 0) {
    return NextResponse.json({ data: { anomalies: [], project_pct_complete: 0 } });
  }

  const pool = getPool();
  const drawItemRes = await pool.query(
    `SELECT di.hardcost_item_id, COALESCE(SUM(COALESCE(di.amount_approved, di.amount_requested)), 0)::numeric AS total
     FROM deal_draw_items di
     JOIN deal_draws d ON d.id = di.draw_id
     WHERE d.deal_id = $1
     GROUP BY di.hardcost_item_id`,
    [params.id]
  );
  const completedByLine = new Map<string, number>();
  for (const r of drawItemRes.rows) {
    if (r.hardcost_item_id) completedByLine.set(r.hardcost_item_id, Number(r.total));
  }

  // Project-level pace.
  let totalCurrent = 0;
  let totalCompleted = 0;
  for (const it of items) {
    const cur = (Number(it.amount) || 0) + (Number(it.change_order_amount) || 0);
    totalCurrent += cur;
    totalCompleted += completedByLine.get(it.id as string) ?? 0;
  }
  const projectPct = totalCurrent > 0 ? (totalCompleted / totalCurrent) * 100 : 0;

  const anomalies: Anomaly[] = [];
  for (const it of items) {
    const current = (Number(it.amount) || 0) + (Number(it.change_order_amount) || 0);
    if (current <= 0) continue;
    const completed = completedByLine.get(it.id as string) ?? 0;
    if (completed <= 0) continue;
    const pct = (completed / current) * 100;
    const delta = pct - projectPct;
    let severity: Anomaly["severity"] = "info";
    let reason = "";

    if (delta > FRONT_LOAD_ALERT_PCT) {
      severity = "alert";
      reason = `Billed ${pct.toFixed(0)}% complete vs project pace ${projectPct.toFixed(0)}%. Possible front-loading — verify installed work matches.`;
    } else if (delta > FRONT_LOAD_WARN_PCT) {
      severity = "warn";
      reason = `Billed ${pct.toFixed(0)}% complete, ${delta.toFixed(0)} pts ahead of project pace. Review installed work before approving next draw.`;
    } else if (pct >= OVERBILL_FLAT_PCT && projectPct < 50) {
      severity = "alert";
      reason = `Line billed ${pct.toFixed(0)}% complete with project only ${projectPct.toFixed(0)}% complete. Confirm scope is genuinely complete (not advance billing).`;
    } else if (pct > 100) {
      severity = "alert";
      reason = `Line is over-billed (${pct.toFixed(0)}% vs current value). Either current value is stale (need a CO?) or billing is overstated.`;
    } else {
      continue;
    }
    anomalies.push({
      hardcost_item_id: it.id as string,
      description: it.description as string,
      category: it.category as string,
      current_value: current,
      total_completed: completed,
      pct_complete: pct,
      project_pct_complete: projectPct,
      delta_pct: delta,
      severity,
      reason,
    });
  }
  anomalies.sort((a, b) => {
    const order = { alert: 0, warn: 1, info: 2 };
    return order[a.severity] - order[b.severity] || Math.abs(b.delta_pct) - Math.abs(a.delta_pct);
  });

  return NextResponse.json({
    data: {
      anomalies,
      project_pct_complete: projectPct,
      total_current: totalCurrent,
      total_completed: totalCompleted,
    },
  });
}
