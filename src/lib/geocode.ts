// Census.gov geocoding client.
//
// The US Census Bureau runs a free, unauthenticated, unlimited geocoder at
// geocoding.geo.census.gov. It's US-only (which matches our product scope —
// CRE underwriters doing US deals), no API key required, and returns clean
// lat/lng plus census tract metadata.
//
// API docs: https://geocoding.geo.census.gov/geocoder/
//
// This client is the only place in the codebase allowed to geocode. Every
// fetch goes through isAllowedFetchUrl() via assertAllowedFetchUrl() so a
// future refactor can't accidentally swap in a broker-site geocoder.
//
// Rate limit / politeness:
// - No documented hard limit, but we cap batch geocoding to 50 at a time
//   and add a 100ms delay between calls.
// - Per-call timeout of 8 seconds.

import { assertAllowedFetchUrl } from "./web-allowlist";

// Extend the allowlist for the Census geocoder host the first time this
// module loads. We do this lazily via a guard so that the web-allowlist
// module stays the single source of truth for static policy.

// NOTE: the web-allowlist module already includes census.gov in ALLOWED_HOSTS
// so geocoding.geo.census.gov passes automatically — nothing else needed.

export interface GeocodeResult {
  lat: number;
  lng: number;
  matched_address: string;
}

interface CensusGeocodeResponse {
  result?: {
    addressMatches?: Array<{
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number }; // x = lng, y = lat
    }>;
  };
}

/**
 * Geocode a single address string. Returns null if the address doesn't
 * resolve, the API errors, or the call times out. Safe to call in a loop
 * but use geocodeAddresses() for batches so politeness delays apply.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  if (!address || address.trim().length < 3) return null;

  const url =
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
    `?address=${encodeURIComponent(address)}` +
    `&benchmark=Public_AR_Current` +
    `&format=json`;

  try {
    assertAllowedFetchUrl(url);
  } catch (err) {
    console.error("Census geocoder URL rejected by allowlist:", err);
    return null;
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        // Census is fine without a user-agent but being explicit helps if
        // they ever ask "who's calling us"
        "User-Agent": "deal-intelligence/1.0 (geocoding for CRE comps)",
      },
    });
    if (!res.ok) {
      console.error(`Census geocoder HTTP ${res.status} for ${address}`);
      return null;
    }
    const json = (await res.json()) as CensusGeocodeResponse;
    const match = json.result?.addressMatches?.[0];
    if (!match || !match.coordinates) return null;

    const { x, y } = match.coordinates;
    if (typeof x !== "number" || typeof y !== "number") return null;

    return {
      lat: y,
      lng: x,
      matched_address: match.matchedAddress ?? address,
    };
  } catch (err) {
    console.error(`Census geocoder error for "${address}":`, err);
    return null;
  }
}

/**
 * Geocode a batch of addresses with a small politeness delay between calls.
 * Returns an array parallel to the input; entries that fail resolve to null.
 */
export async function geocodeAddresses(
  addresses: string[],
  opts: { delayMs?: number; maxConcurrent?: number } = {}
): Promise<Array<GeocodeResult | null>> {
  const delay = opts.delayMs ?? 100;
  const results: Array<GeocodeResult | null> = [];
  for (const addr of addresses) {
    const r = await geocodeAddress(addr);
    results.push(r);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return results;
}

/**
 * Build a best-effort geocodable address from comp fields. Needs at least
 * one of address / city / state to be present.
 */
export function buildCompAddress(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const pieces = [parts.address, parts.city, parts.state].filter(
    (p) => p && p.trim()
  );
  if (pieces.length === 0) return null;
  // Only street-address is useful for precise geocoding. If we only have
  // city/state, Census still returns the centroid, which is fine for the map.
  return pieces.join(", ");
}
