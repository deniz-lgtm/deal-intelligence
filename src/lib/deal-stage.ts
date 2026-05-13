// Stage derivation + per-stage route filtering for the deal workspace.
//
// The deal sidebar used to render ~30 routes across 6 collapsible groups.
// Each stage of a deal really only touches 4-8 extra routes at a time, so
// we derive the current stage from `status` + `execution_phase` and use it
// to recommend the next tools. Core surfaces like Assistant, Schedule,
// Documents, Decisions, and Underwriting stay visible in the layout.

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

// Recommended sidebar hrefs (relative to /deals/[id]) for each stage.
// The layout unions these with always-visible core tools and the active
// deep-linked route, then "More tools" restores the full route list.
//
// "" means the deal home (Deal Brief canvas).
export const STAGE_ALLOWED_HREFS: Record<DealStage, ReadonlyArray<string>> = {
  screen: ["", "/chat", "/tasks", "/outputs", "/comps", "/underwriting"],
  underwrite: [
    "",
    "/chat",
    "/tasks",
    "/underwriting",
    "/comps",
    "/site",
    "/documents",
  ],
  loi_dd: [
    "",
    "/chat",
    "/tasks",
    "/loi",
    "/outputs",
    "/documents",
    "/site",
  ],
  close: [
    "",
    "/chat",
    "/tasks",
    "/outputs",
    "/documents",
    "/loi",
  ],
  build: [
    "",
    "/chat",
    "/tasks",
    "/schedule",
    "/construction",
    "/construction/schedule",
    "/construction/closeout",
    "/construction/reports",
    "/pre-construction/bids",
  ],
  stabilize: [
    "",
    "/chat",
    "/tasks",
    "/outputs",
    "/construction/closeout",
    "/construction/reports",
  ],
};

export function isStageAllowed(stage: DealStage, href: string): boolean {
  return STAGE_ALLOWED_HREFS[stage].includes(href);
}
