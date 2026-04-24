/**
 * Artifact staleness detection.
 *
 * Each generated artifact carries an `input_hash` computed from a
 * canonical snapshot of the generator's inputs (deal row, UW snapshot,
 * massing, saved prose, etc.). On library read we re-hash the current
 * input state and compare: equal → `current`, different → `stale`.
 *
 * The hash is deterministic across processes: inputs are normalized
 * (stable key order, ISO timestamps, nulls explicit) before JSON.
 */

import { createHash } from "crypto";

export type ArtifactKind =
  | "ic_package"
  | "pitch_deck"
  | "investment_memo"
  | "one_pager"
  | "proforma_pdf"
  | "dd_abstract"
  | "zoning_report"
  | "loi"
  | "market_study";

/**
 * Pieces of deal state a generator might depend on. Not every kind uses
 * every field — the per-kind builder picks only what's relevant so that
 * an unrelated UW edit doesn't mark an LOI stale.
 */
export interface InputSnapshotInputs {
  deal: { id: string; updated_at: string | Date | null } | null;
  massing?: { id: string; updated_at: string | Date | null } | null;
  underwriting?: { id: string; updated_at: string | Date | null } | null;
  /** Arbitrary kind-specific extras (saved prose hash, selected sections, etc.). */
  extras?: Record<string, unknown>;
}

/** Canonical JSON-serializable snapshot used for hashing + audit. */
export interface InputSnapshot {
  dealId: string | null;
  dealUpdatedAt: string | null;
  massingId: string | null;
  massingUpdatedAt: string | null;
  underwritingId: string | null;
  underwritingUpdatedAt: string | null;
  extras: Record<string, unknown>;
}

function iso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  // Treat strings as already-ISO timestamps; if they're not, Postgres gave
  // us a timestamptz string that new Date() parses correctly.
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** Stable-stringify for hashing — recursive key sort. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Build a canonical snapshot object. */
export function buildInputSnapshot(inputs: InputSnapshotInputs): InputSnapshot {
  return {
    dealId: inputs.deal?.id ?? null,
    dealUpdatedAt: iso(inputs.deal?.updated_at ?? null),
    massingId: inputs.massing?.id ?? null,
    massingUpdatedAt: iso(inputs.massing?.updated_at ?? null),
    underwritingId: inputs.underwriting?.id ?? null,
    underwritingUpdatedAt: iso(inputs.underwriting?.updated_at ?? null),
    extras: inputs.extras ?? {},
  };
}

/** SHA-256 of the stable-stringified snapshot. */
export function hashInputSnapshot(snapshot: InputSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

/**
 * Convenience — build + hash in one call. Returns both so callers can
 * persist `input_snapshot` (for audit / re-hash on read) alongside
 * `input_hash` (for cheap equality check).
 */
export function computeArtifactHash(inputs: InputSnapshotInputs): {
  snapshot: InputSnapshot;
  hash: string;
} {
  const snapshot = buildInputSnapshot(inputs);
  return { snapshot, hash: hashInputSnapshot(snapshot) };
}

/**
 * Check whether an artifact's stored hash still matches the current
 * input state. Returns 'current' | 'stale'. Pure; no I/O. Caller passes
 * in the now-inputs and the stored hash.
 */
export function checkStaleness(
  storedHash: string | null | undefined,
  currentInputs: InputSnapshotInputs
): "current" | "stale" {
  if (!storedHash) return "current"; // unknown baseline → trust the row
  const { hash } = computeArtifactHash(currentInputs);
  return hash === storedHash ? "current" : "stale";
}

/**
 * Describe WHY an artifact is stale — which field changed. Useful for
 * the library tooltip ("UW snapshot changed 2h ago"). Compares two
 * snapshots field-by-field and returns the names of differing fields.
 */
export function staleReasons(
  storedSnapshot: InputSnapshot | null | undefined,
  currentInputs: InputSnapshotInputs
): string[] {
  if (!storedSnapshot) return [];
  const current = buildInputSnapshot(currentInputs);
  const reasons: string[] = [];
  if (storedSnapshot.dealUpdatedAt !== current.dealUpdatedAt) reasons.push("deal");
  if (storedSnapshot.massingUpdatedAt !== current.massingUpdatedAt) reasons.push("massing");
  if (storedSnapshot.underwritingUpdatedAt !== current.underwritingUpdatedAt) reasons.push("underwriting");
  if (stableStringify(storedSnapshot.extras) !== stableStringify(current.extras)) reasons.push("saved content");
  return reasons;
}
