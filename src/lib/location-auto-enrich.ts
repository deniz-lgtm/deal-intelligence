// ─────────────────────────────────────────────────────────────────────────────
// Location auto-enrichment (client-side).
//
// After a deal gets geocoded, fire the existing location-intelligence fetch
// endpoints in the background — AMI, FMR, BLS LAUS, BLS QCEW, USPS migration,
// FEMA flood — so the analyst doesn't have to click through the Location
// page to trigger each one manually. Every deal gets a baseline of market
// enrichment the moment it has coordinates.
//
// Each individual endpoint degrades gracefully when its API key is missing
// (HUD_API_TOKEN, BLS_API_KEY) so the overall flow never blocks and never
// surfaces errors for optional feeds.
//
// This is deliberately client-side: the existing fetch-X endpoints expect
// the authenticated session cookie, and firing them from the browser is
// the same pattern the LocationIntelligence page already uses.
// ─────────────────────────────────────────────────────────────────────────────

export interface AutoEnrichOptions {
  /** Radius (miles) passed to endpoints that accept one. Default 3. */
  radiusMiles?: number;
  /** Controls which feeds fire. Defaults to the full developer-focused set. */
  include?: AutoEnrichFeed[];
  /** Fired before each feed — good for lightweight progress UI. */
  onProgress?: (step: { feed: AutoEnrichFeed; status: "start" | "ok" | "error" | "skipped"; detail?: string }) => void;
}

export type AutoEnrichFeed =
  | "census"     // ACS demographics (radius-based)
  | "ami"        // HUD Area Median Income (county)
  | "fmr"        // HUD Fair Market Rents (county)
  | "laus"       // BLS Local Area Unemployment Statistics (metro)
  | "qcew"       // BLS Quarterly Census of Employment & Wages (county)
  | "migration"  // USPS / HUD migration data
  | "flood";     // FEMA flood-risk

const DEFAULT_FEEDS: AutoEnrichFeed[] = [
  "census", "ami", "fmr", "laus", "qcew", "migration", "flood",
];

const ENDPOINTS: Record<AutoEnrichFeed, { path: string; body?: (radius: number) => unknown }> = {
  census:    { path: "fetch-census",    body: (r) => ({ radius_miles: r }) },
  ami:       { path: "fetch-ami",       body: (r) => ({ radius_miles: r }) },
  fmr:       { path: "fetch-fmr",       body: (r) => ({ radius_miles: r }) },
  laus:      { path: "fetch-laus",      body: (r) => ({ radius_miles: r }) },
  qcew:      { path: "fetch-qcew",      body: (r) => ({ radius_miles: r }) },
  migration: { path: "fetch-migration", body: (r) => ({ radius_miles: r }) },
  flood:     { path: "fetch-flood",     body: (r) => ({ radius_miles: r }) },
};

/**
 * Kick off the full auto-enrichment flow. Returns the per-feed outcome so
 * callers can render a summary toast if they want. Never throws.
 */
export async function triggerLocationAutoEnrich(
  dealId: string,
  opts: AutoEnrichOptions = {}
): Promise<Array<{ feed: AutoEnrichFeed; ok: boolean; error?: string }>> {
  const radius = opts.radiusMiles ?? 3;
  const feeds = opts.include ?? DEFAULT_FEEDS;

  const runOne = async (feed: AutoEnrichFeed) => {
    const cfg = ENDPOINTS[feed];
    if (!cfg) return { feed, ok: false, error: "unknown feed" };
    opts.onProgress?.({ feed, status: "start" });
    try {
      const res = await fetch(
        `/api/deals/${dealId}/location-intelligence/${cfg.path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg.body ? cfg.body(radius) : {}),
        }
      );
      if (!res.ok) {
        // Soft-fail on 503 (missing API key) — expected and not actionable.
        const err = await res.json().catch(() => ({}));
        const skipped = res.status === 503;
        opts.onProgress?.({ feed, status: skipped ? "skipped" : "error", detail: err.error });
        return { feed, ok: false, error: err.error || `HTTP ${res.status}` };
      }
      opts.onProgress?.({ feed, status: "ok" });
      return { feed, ok: true };
    } catch (err) {
      opts.onProgress?.({ feed, status: "error", detail: String(err) });
      return { feed, ok: false, error: String(err) };
    }
  };

  // Fire in parallel — each endpoint hits a different upstream (HUD / BLS /
  // FEMA / Census) so there's no rate-limit coupling. HUD AMI + FMR DO go
  // to the same host but HUD tolerates a few concurrent requests fine.
  return Promise.all(feeds.map(runOne));
}

/**
 * Convenience: fire auto-enrichment without awaiting. The UI can call this
 * after a geocode success and move on immediately; the network requests
 * finish in the background and the Location / Comps pages see the fresh
 * data on their next render / refresh.
 */
export function fireAndForgetAutoEnrich(
  dealId: string,
  opts: AutoEnrichOptions = {}
): void {
  void triggerLocationAutoEnrich(dealId, opts).catch(() => {
    // Intentionally swallowed — individual feed errors are already handled
    // in the onProgress hook.
  });
}
