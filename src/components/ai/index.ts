// Barrel export — new callers should import from "@/components/ai" rather
// than deep paths so the module boundary stays clean if internals shift.

export { AIButton } from "./AIButton";
export type { AIButtonProps } from "./AIButton";
export { DocCoverageChip } from "./DocCoverageChip";
export type { DocCoverageChipProps } from "./DocCoverageChip";
export type { AIFillResult, AIFieldSource } from "./types";
export { summarizeAIFill } from "./types";
