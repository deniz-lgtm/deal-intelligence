// Shared response contract for consolidated AI fill endpoints.
//
// Every AI-autofill endpoint (budget, autofill/extract, financing/structure,
// loi-autofill, etc.) returns this shape so the client can render a
// consistent post-fill summary without each caller inventing its own
// narrative string.

export type AIFieldSource = "doc" | "ai" | "mixed";

export interface AIFillResult<T = Record<string, unknown>> {
  // The actual values to merge into form / UW state.
  fields: Partial<T>;
  // Per-field provenance: "doc" = read directly from a document, "ai" =
  // inferred by the model, "mixed" = model extrapolated from partial doc
  // signal. Missing keys are treated as "ai".
  sources?: Partial<Record<keyof T & string, AIFieldSource>>;
  // IDs of documents the endpoint actually consumed. Echoed back so the
  // UI can show "read T-12, Rent Roll, OM" without re-guessing relevance.
  doc_ids_used?: string[];
  // One-line explanation the endpoint can return for the toast / narrative
  // box. Optional — the client will synthesize a default when absent.
  narrative?: string;
  // Overall confidence — mirrors the <DocCoverageChip> tier used pre-click.
  confidence?: "high" | "medium" | "low";
}

// Helper for summarizing the result in a toast.
export function summarizeAIFill<T>(result: AIFillResult<T>): string {
  const fieldCount = Object.keys(result.fields ?? {}).length;
  if (fieldCount === 0) return "Nothing to fill — model returned no fields";

  if (result.sources) {
    const fromDocs = Object.values(result.sources).filter((s) => s === "doc" || s === "mixed").length;
    const fromAi = fieldCount - fromDocs;
    if (fromDocs === 0) return `${fieldCount} fields filled from AI`;
    if (fromAi === 0) return `${fieldCount} fields filled from docs`;
    return `${fieldCount} fields filled · ${fromDocs} from docs, ${fromAi} from AI`;
  }

  return `${fieldCount} field${fieldCount === 1 ? "" : "s"} filled`;
}
