import { generateSectionsPdf } from "./_shared/sections-pdf";
import type { ArtifactGenerator } from "./types";

const pitchDeckGenerator: ArtifactGenerator = async (opts) =>
  generateSectionsPdf(opts, {
    kind: "pitch_deck",
    artifactTitle: "Pitch Deck",
    eyebrow: "PITCH DECK",
    subtitle: "Investor Presentation",
    summaryPrefix: "Pitch Deck",
  });

export default pitchDeckGenerator;
