// Phase classification — turns a Deal into the set of role-based
// "departments" (Acquisition / Development / Construction) it belongs to for
// the triptych home page. A nullable `current_phase` override on the deal
// wins over the auto-classification; `"multi"` recomputes the auto set and
// lets the deal surface in every matching department.

import type {
  Deal,
  DealPhase,
  InvestmentThesis,
  DealScope,
} from "@/lib/types";

export interface PhaseSignals {
  has_ceqa?: boolean;
  has_programming?: boolean;
  has_predev_costs?: boolean;
  has_hardcost_items?: boolean;
  has_draws?: boolean;
  has_permits?: boolean;
  has_vendors?: boolean;
  has_progress_reports?: boolean;
}

export interface PhaseResult {
  phases: DealPhase[];   // the departments this deal surfaces in
  primary: DealPhase;    // for stacked-mobile ordering and nav default
  isOverride: boolean;   // true when current_phase was explicitly set
}

const ACQ_STAGES = new Set([
  "sourcing",
  "screening",
  "loi",
  "under_contract",
  "diligence",
  "closing",
]);

const DEV_THESIS = new Set<InvestmentThesis>(["value_add", "ground_up"]);
const DEV_SCOPE = new Set<DealScope>(["value_add_expansion", "ground_up"]);

function autoPhases(deal: Deal, s: PhaseSignals): DealPhase[] {
  const out: DealPhase[] = [];

  if (ACQ_STAGES.has(deal.status)) out.push("acquisition");

  if (deal.status === "closed") {
    const dev =
      (deal.investment_strategy !== null && DEV_THESIS.has(deal.investment_strategy)) ||
      (deal.deal_scope !== null && DEV_SCOPE.has(deal.deal_scope)) ||
      !!s.has_ceqa ||
      !!s.has_programming ||
      !!s.has_predev_costs;
    if (dev) out.push("development");

    const con =
      !!s.has_hardcost_items ||
      !!s.has_draws ||
      !!s.has_permits ||
      !!s.has_vendors ||
      !!s.has_progress_reports;
    if (con) out.push("construction");

    // Fallback: a closed deal with no dev/construction signals still needs
    // a home — park it in Development where portfolio work typically begins.
    if (out.length === 0) out.push("development");
  }

  return out;
}

export function classifyDealPhase(
  deal: Deal,
  signals: PhaseSignals = {}
): PhaseResult {
  const override = deal.current_phase;

  if (override && override !== "multi") {
    return { phases: [override], primary: override, isOverride: true };
  }

  const auto = autoPhases(deal, signals);
  const primary = auto[0] ?? "acquisition";

  if (override === "multi") {
    return { phases: auto, primary, isOverride: true };
  }

  return { phases: auto, primary, isOverride: false };
}

export function dealBelongsTo(result: PhaseResult, phase: DealPhase): boolean {
  return result.phases.includes(phase);
}

export const DEAL_PHASE_VALUES: ReadonlyArray<DealPhase> = [
  "acquisition",
  "development",
  "construction",
];
