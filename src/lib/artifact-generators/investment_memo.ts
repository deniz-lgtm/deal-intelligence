import { generateSectionsPdf } from "./_shared/sections-pdf";
import type { ArtifactGenerator } from "./types";

const investmentMemoGenerator: ArtifactGenerator = async (opts) =>
  generateSectionsPdf(opts, {
    kind: "investment_memo",
    artifactTitle: "Investment Memo",
    eyebrow: "IC MEMO",
    subtitle: "Investment Committee Materials",
    summaryPrefix: "Investment Memo",
  });

export default investmentMemoGenerator;
