/**
 * Generator registry.
 *
 * The /artifacts API dispatches POSTs by `kind` to the matching
 * generator here. Each generator is imported lazily so an untouched
 * generator's deps (puppeteer, docx, pptxgenjs) don't balloon the
 * cold-start cost of the route.
 */

import type { ArtifactKind } from "@/lib/artifact-hash";
import type { ArtifactGenerator } from "./types";

type Loader = () => Promise<{ default: ArtifactGenerator }>;

/**
 * Every kind maps to a lazy loader. Phase 1 only wires the stubs —
 * generators light up one-by-one as we migrate each authoring surface
 * off its legacy export route in later phases.
 */
const REGISTRY: Record<ArtifactKind, Loader> = {
  ic_package: () => import("./ic_package"),
  pitch_deck: () => import("./pitch_deck"),
  investment_memo: () => import("./investment_memo"),
  one_pager: () => import("./one_pager"),
  proforma_pdf: () => import("./proforma_pdf"),
  dd_abstract: () => import("./dd_abstract"),
  zoning_report: () => import("./zoning_report"),
  loi: () => import("./loi"),
};

export async function loadGenerator(kind: ArtifactKind): Promise<ArtifactGenerator> {
  const loader = REGISTRY[kind];
  if (!loader) throw new Error(`No generator registered for kind: ${kind}`);
  const mod = await loader();
  return mod.default;
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && value in REGISTRY;
}

export { KIND_META } from "./types";
export type { ArtifactGenerator, GenerateOptions, GenerateResult, KindMeta, ArtifactCategory } from "./types";
