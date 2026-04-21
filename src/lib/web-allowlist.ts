// Domain allowlist for any server-side web fetching Claude (or we) might do.
//
// Context: CoStar v. Crexi (June 2025) established real liability for scraping
// broker-site listings, and hiQ v. LinkedIn held that ToS-based breach claims
// against automated scrapers are enforceable. To avoid building comp-data
// features that create legal exposure, we do NOT auto-fetch listings from
// broker sites server-side. Users may paste text/URLs from those sites
// themselves (their own session, their own ToS relationship with the site),
// but our servers won't go fetch the URL on their behalf.
//
// This allowlist is the defensive guardrail. Anything that calls
// `isAllowedFetchUrl()` will only see true for permissive, mostly
// government/public-data hosts suitable for submarket stats (vacancy, rent
// growth, cap rate bands, demographics).
//
// Explicitly blocked (paste-mode only): costar, loopnet, crexi, zillow,
// apartments.com, realtor.com, redfin (except Data Center CSVs), rentberry, etc.

/** Hosts (and their subdomains) where server-side fetch is permitted. */
const ALLOWED_HOSTS = [
  // Federal data
  "fred.stlouisfed.org",
  "api.stlouisfed.org",
  "bls.gov",
  "api.bls.gov",
  "census.gov",
  "api.census.gov",
  "hud.gov",
  "huduser.gov",
  "sec.gov",
  "fdic.gov",
  "fema.gov",
  "hazards.fema.gov",
  // USFWS National Wetlands Inventory (free MapServer)
  "fws.gov",
  "fwsprimary.wim.usgs.gov",
  // USGS Elevation Point Query Service (free, used for slope/elevation checks)
  "epqs.nationalmap.gov",
  "nationalmap.gov",
  "irs.gov",
  "bea.gov",
  "walkscore.com",
  "api.walkscore.com",
  "overpass-api.de",
  "maps.googleapis.com",
  // Research / aggregated public data
  "zillow.com/research", // Zillow Research CSVs only (not listings)
  "redfin.com/news/data-center", // Redfin Data Center CSVs only
  "apartmentlist.com/research",
  // Misc public-data repositories
  "data.gov",
  "opendata.socrata.com",
] as const;

/** Hosts that are specifically broker/listing sites we must NOT auto-fetch. */
const BLOCKED_HOSTS = [
  "costar.com",
  "loopnet.com",
  "crexi.com",
  "zillow.com",        // blocked except Research (handled in allowlist match order)
  "apartments.com",
  "realtor.com",
  "redfin.com",        // blocked except Data Center (handled in allowlist match order)
  "rent.com",
  "rentberry.com",
  "hotpads.com",
  "trulia.com",
  "reonomy.com",
  "propertyshark.com",
] as const;

/**
 * Return true if a URL is safe to fetch server-side. The logic:
 *   1. Must be HTTPS (no plain HTTP, no data:, no file:).
 *   2. Must match an allowed host (or subdomain thereof).
 *   3. Must NOT match a blocked host unless the allow entry includes a path
 *      prefix that the URL also starts with (e.g. zillow.com/research).
 */
export function isAllowedFetchUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();

  // Check allow list (supports "host" or "host/path-prefix" entries)
  const allowed = ALLOWED_HOSTS.some((entry) => {
    const [entryHost, ...pathParts] = entry.split("/");
    const prefix = pathParts.length > 0 ? "/" + pathParts.join("/") : null;
    const hostMatch =
      hostname === entryHost || hostname.endsWith("." + entryHost);
    if (!hostMatch) return false;
    if (!prefix) return true;
    return url.pathname.toLowerCase().startsWith(prefix);
  });

  if (!allowed) return false;

  // Belt + suspenders: if a blocked host matches and no more-specific allow
  // path is set, refuse. (e.g. zillow.com/research is allowed, zillow.com/homes
  // stays blocked.)
  const blocked = BLOCKED_HOSTS.some(
    (bh) => hostname === bh || hostname.endsWith("." + bh)
  );
  if (blocked) {
    // Only let it through if the allow list actually matched a path-prefix
    // entry (which would only happen for e.g. zillow.com/research)
    return ALLOWED_HOSTS.some((entry) => {
      if (!entry.includes("/")) return false;
      const [entryHost, ...pathParts] = entry.split("/");
      const prefix = "/" + pathParts.join("/");
      const hostMatch =
        hostname === entryHost || hostname.endsWith("." + entryHost);
      return hostMatch && url.pathname.toLowerCase().startsWith(prefix);
    });
  }

  return true;
}

/**
 * Throws if the URL is not on the allowlist. Use at the edge of any code
 * path that wants to fetch() a user-supplied URL server-side.
 */
export function assertAllowedFetchUrl(rawUrl: string): void {
  if (!isAllowedFetchUrl(rawUrl)) {
    throw new Error(
      `Refusing to fetch ${rawUrl}: host is not on the server-side allowlist. ` +
        `Broker/listing sites must be paste-mode only.`
    );
  }
}
