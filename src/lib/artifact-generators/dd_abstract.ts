import { markdownToHtml } from "@/lib/report-html-shell";
import { renderBrandedPdf } from "./_shared/branded-pdf";
import type { ArtifactGenerator } from "./types";

interface DdAbstractPayload {
  markdown?: string;
  dealName?: string;
  deal?: { id: string; updated_at: string | Date | null } | null;
  underwriting?: { id: string; updated_at: string | Date | null } | null;
}

/**
 * Renders the DD Abstract markdown the page authors (and Claude
 * expands) into a branded PDF, stores it in Reports & Packages, and
 * returns a GenerateResult so the artifact API can persist the row.
 */
const ddAbstractGenerator: ArtifactGenerator = async (opts) => {
  const payload = (opts.payload ?? {}) as DdAbstractPayload;
  const markdown = payload.markdown ?? "";
  const dealName = payload.dealName ?? "Deal";

  return renderBrandedPdf(opts, {
    kind: "dd_abstract",
    artifactTitle: "DD Abstract",
    headline: dealName,
    eyebrow: "IC PRE-READ",
    subtitle: "Due Diligence Abstract",
    bodyHtml: markdownToHtml(markdown),
    summary: `AI-generated DD Abstract · ${new Date().toLocaleDateString()}`,
    contentText: markdown,
    hashExtras: { markdownLength: markdown.length },
    deal: payload.deal ?? null,
    underwriting: payload.underwriting ?? null,
  });
};

export default ddAbstractGenerator;
