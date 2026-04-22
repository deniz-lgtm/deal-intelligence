/**
 * Generator stub helper.
 *
 * Phase 1 ships the registry + types + API dispatcher without wiring
 * any actual renderers — the legacy export routes (investment-package,
 * dd-abstract, zoning-report, ic-package) still handle their own
 * generation. This helper returns a NotImplementedError so callers hit
 * a clean, structured failure during the Phase 1→3 transition.
 */

import type { ArtifactGenerator, GenerateResult } from "./types";
import type { ArtifactKind } from "@/lib/artifact-hash";

export class ArtifactGeneratorNotImplementedError extends Error {
  readonly code = "generator_not_implemented";
  constructor(kind: ArtifactKind) {
    super(
      `Artifact generator for kind "${kind}" isn't wired yet. Use the legacy export route for now; this generator ships in a later phase.`
    );
  }
}

export function notImplementedGenerator(kind: ArtifactKind): ArtifactGenerator {
  return async (): Promise<GenerateResult> => {
    throw new ArtifactGeneratorNotImplementedError(kind);
  };
}
