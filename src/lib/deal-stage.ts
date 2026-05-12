// Stage derivation + per-stage route filtering for the deal workspace.
//
// The deal sidebar used to render ~30 routes across 6 collapsible groups.
// Each stage of a deal really only touches 4–8 of those at a time, so we
// derive the current stage from `status` + `execution_phase` and hide
// everything else by default. The "More" disclosure restores the full list.

import type { DealStatus, ExecutionPhase } from "@/lib/types";

export type DealStage =
  | "screen"
  | "underwrite"
  | "loi_dd"
  | "close"
  | "build"
  | "stabilize";

export const DEAL_STAGES: DealStage[] = [
  "screen",
  "underwrite",
  "loi_dd",
  "close",
  "build",
  "stabilize",
];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  screen: "Screen",
  underwrite: "Underwrite",
  loi_dd: "LOI / DD",
  close: "Close",
  build: "Build",
  stabilize: "Stabilize",
};

export const DEAL_STAGE_SHORT: Record<DealStage, string> = {
  screen: "Screen",
  underwrite: "UW",
  loi_dd: "LOI/DD",
  close: "Close",
  build: "Build",
  stabilize: "Stabilize",
};

export function deriveDealStage(
  status: DealStatus | null | undefined,
  executionPhase: ExecutionPhase | null | undefined
): DealStage {
  if (!status) return "screen";
  switch (status) {
    case "sourcing":
    case "screening":
      return "screen";
    case "loi":
    case "under_contract":
      return "underwrite";
    case "diligence":
      return "loi_dd";
    case "closing":
      return "close";
    case "closed":
      if (executionPhase === "lease_up" || executionPhase === "stabilization") {
        return "stabilize";
      }
      return "build";
    case "dead":
    case "archived":
      return "screen";
  }
}

// Allowed sidebar hrefs (relative to /deals/[id]) for each stage. Any
// item not in this set is hidden when the user is on this stage and
// "More" is not expanded. Deep links to hidden routes still resolve —
// the user simply has to click "More" to see them in the sidebar.
//
// "" means the deal home (Deal Brief canvas).
export const STAGE_ALLOWED_HREFS: Record<DealStage, ReadonlyArray<string>> = {
  screen: ["", "/chat", "/om-analysis", "/comps", "/underwriting"],
  underwrite: [
    "",
    "/chat",
    "/underwriting",
    "/comps",
    "/site-zoning",
    "/location",
    "/decisions",
    "/documents",
  ],
  loi_dd: [
    "",
    "/chat",
    "/loi",
    "/dd-abstract",
    "/documents",
    "/checklist",
    "/site-walk",
    "/photos",
    "/decisions",
  ],
  close: [
    "",
    "/chat",
    "/investment-package",
    "/documents",
    "/decisions",
    "/loi",
  ],
  build: [
    "",
    "/chat",
    "/schedule",
    "/construction",
    "/construction/schedule",
    "/construction/budget",
    "/construction/draws",
    "/construction/permits",
    "/construction/rfis",
    "/construction/change-orders",
    "/construction/vendors",
    "/pre-construction/bids",
    "/pre-construction/value-engineering",
    "/pre-construction/constructability",
    "/pre-construction/long-lead",
    "/pre-construction/buyout",
    "/decisions",
  ],
  stabilize: [
    "",
    "/chat",
    "/reports",
    "/construction/closeout",
    "/construction/reports",
  ],
};

export function isStageAllowed(stage: DealStage, href: string): boolean {
  return STAGE_ALLOWED_HREFS[stage].includes(href);
}
