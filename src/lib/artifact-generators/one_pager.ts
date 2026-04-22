import { generateSectionsPdf } from "./_shared/sections-pdf";
import type { ArtifactGenerator } from "./types";

const onePagerGenerator: ArtifactGenerator = async (opts) =>
  generateSectionsPdf(opts, {
    kind: "one_pager",
    artifactTitle: "One-Pager",
    eyebrow: "SUMMARY",
    subtitle: "Deal Summary",
    summaryPrefix: "One-Pager",
  });

export default onePagerGenerator;
