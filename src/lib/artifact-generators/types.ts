/**
 * Shared types for artifact generators.
 *
 * Each kind of artifact (IC Package, Investment Memo, Proforma PDF, etc.)
 * has a generator module under `src/lib/artifact-generators/<kind>.ts`
 * that exports a default function conforming to `ArtifactGenerator`.
 *
 * The generator owns: rendering the content, uploading any binary blob
 * via blob-storage, and returning the row shape artifactQueries.saveLatest
 * needs to persist. It does NOT touch the DB — the /artifacts API
 * dispatcher calls saveLatest once the generator resolves.
 */

import type { ArtifactKind, InputSnapshot } from "@/lib/artifact-hash";

/** Human-friendly grouping used by the library UI. */
export type ArtifactCategory =
  | "investor_packages"
  | "analysis_outputs"
  | "deal_documents";

export interface GenerateOptions {
  dealId: string;
  userId: string;
  /** Optional previous artifact id — if set, the new row is linked to it
   *  via parent_document_id (forming a version chain). */
  previousId?: string | null;
  /** Free-form payload passed through from the POST body — generators
   *  know how to unpack their own shape. */
  payload?: Record<string, unknown>;
  /** Massing scope, if the authoring surface ran under a specific
   *  massing (?massing=<id>). Null for unscoped generators. */
  massingId?: string | null;
}

/** What a generator returns after producing the artifact. */
export interface GenerateResult {
  /** Stable human title ("IC Package · The Crestmont · 22 Apr 2026"). */
  title: string;
  /** File name suitable for download. */
  filename: string;
  /** Blob URL where the artifact lives (S3 or local upload dir). */
  filePath: string;
  fileSize: number;
  mimeType: string;
  /** Brief human summary shown in the library row. */
  summary?: string;
  /** ai_tags convention used elsewhere in the codebase. */
  tags: string[];
  /** The snapshot we hashed, for audit + cheap re-hash on read. */
  inputSnapshot: InputSnapshot;
  /** sha256 of the snapshot. */
  inputHash: string;
  /** Optional back-reference to an editable source row (e.g.
   *  ic_packages.id for IC Package). */
  sourceArtifactId?: string | null;
  /** Optional plaintext content used by search / ai_summary surfaces. */
  contentText?: string | null;
}

/** The function signature every generator exports. */
export type ArtifactGenerator = (opts: GenerateOptions) => Promise<GenerateResult>;

/** Static metadata per kind — used by the library UI for categorization. */
export interface KindMeta {
  kind: ArtifactKind;
  label: string;
  category: ArtifactCategory;
  /** Short tagline shown under the title in the library. */
  description: string;
}

export const KIND_META: Record<ArtifactKind, KindMeta> = {
  ic_package: {
    kind: "ic_package",
    label: "IC Package",
    category: "investor_packages",
    description: "Editorial committee briefing · HTML / Print PDF",
  },
  pitch_deck: {
    kind: "pitch_deck",
    label: "Pitch Deck",
    category: "investor_packages",
    description: "Visual investor deck · PDF",
  },
  investment_memo: {
    kind: "investment_memo",
    label: "Investment Memo",
    category: "investor_packages",
    description: "Long-form investment memo · PDF",
  },
  one_pager: {
    kind: "one_pager",
    label: "One-Pager",
    category: "investor_packages",
    description: "Single-page deal summary · PDF",
  },
  proforma_pdf: {
    kind: "proforma_pdf",
    label: "Proforma",
    category: "analysis_outputs",
    description: "Underwriting proforma · PDF",
  },
  dd_abstract: {
    kind: "dd_abstract",
    label: "DD Abstract",
    category: "analysis_outputs",
    description: "Due diligence memo · PDF",
  },
  zoning_report: {
    kind: "zoning_report",
    label: "Zoning Report",
    category: "analysis_outputs",
    description: "Site & zoning analysis · PDF",
  },
  loi: {
    kind: "loi",
    label: "Letter of Intent",
    category: "deal_documents",
    description: "LOI · PDF",
  },
};
