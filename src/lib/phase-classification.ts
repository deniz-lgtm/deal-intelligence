// Phase classification — turns a Deal into the set of role-based
// "departments" (Acquisition / Development / Construction) it belongs to for
// the triptych home page.
//
// Rules (simple, explicit, no auto-signals):
//   - Acquisition:  the deal's pipeline status is one of the acq stages.
//   - Development:  deal.show_in_development === true (owner opted in).
//   - Construction: deal.show_in_construction === true (owner opted in).
//
// A deal can belong to any combination — e.g. a deal that has closed but
// has Dev and Construction toggled on appears in both. Signals (CEQA /
// programming / hardcost etc.) still inform panel KPIs but no longer drive
// membership.

import type { Deal, DealPhase } from "@/lib/types";

export interface PhaseSignals {
  has_ceqa?: boolean;
  has_programming?: boolean;
  has_predev_costs?: boolean;
  has_hardcost_items?: boolean;
  has_draws?: boolean;
  has_permits?: boolean;
  has_vendors?: boolean;
  has_progress_reports?: boolean;
  // Action signals — absent/zero means nothing pending, UI stays quiet.
  draws_pending?: number;
  next_milestone_at?: string | null;
}

export interface PhaseResult {
  phases: DealPhase[];
  primary: DealPhase;
}

const ACQ_STAGES = new Set([
  "sourcing",
  "screening",
  "loi",
  "under_contract",
  "diligence",
  "closing",
]);

export function classifyDealPhase(deal: Deal): PhaseResult {
  const phases: DealPhase[] = [];
  if (ACQ_STAGES.has(deal.status)) phases.push("acquisition");
  if (deal.show_in_development) phases.push("development");
  if (deal.show_in_construction) phases.push("construction");
  const primary = phases[0] ?? "acquisition";
  return { phases, primary };
}

export function dealBelongsTo(result: PhaseResult, phase: DealPhase): boolean {
  return result.phases.includes(phase);
}

export const DEAL_PHASE_VALUES: ReadonlyArray<DealPhase> = [
  "acquisition",
  "development",
  "construction",
];
