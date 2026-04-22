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

/**
 * Great-circle distance in statute miles between two (lat, lng) pairs.
 * Standard haversine formula — Earth as a sphere of radius 3958.8mi, plenty
 * accurate for comp distance in the tens-to-hundreds-of-miles range we
 * care about.
 */
export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
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

/**
 * Enrich a comp creation payload with lat/lng from the geocoder, in place.
 * No-op if the payload already has coords or if the address doesn't resolve.
 * Safe to call from any route handler before compQueries.create().
 *
 * Fails closed — geocoding errors or timeouts just leave the row without
 * coords. The user can always run "Geocode Missing" manually later.
 */
export async function enrichCompWithGeocode<
  T extends {
    lat?: number | null;
    lng?: number | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
  }
>(payload: T): Promise<T> {
  if (payload.lat != null && payload.lng != null) return payload;
  const addr = buildCompAddress(payload);
  if (!addr) return payload;
  const result = await geocodeAddress(addr);
  if (result) {
    payload.lat = result.lat;
    payload.lng = result.lng;
  }
  return payload;
}

/**
 * Re-geocode a comp when a PATCH changes any of its address fields.
 *
 * Used by `/api/deals/[id]/comps/[compId]` and `/api/workspace/comps/[id]`
 * so analysts don't have to click a "Geocode" button — the moment they
 * type a street address on a comp that came through extraction without
 * coords, the row auto-resolves to lat/lng and shows up on the map.
 *
 * Behavior:
 *   - If the patch doesn't touch address / city / state, return the patch
 *     unchanged (no geocoder call).
 *   - Otherwise build the full address from (patched ∪ existing) and
 *     geocode. Overwrite any stale lat/lng since the user changed the
 *     address and the old coords no longer match.
 *   - If the patch explicitly provides lat/lng, respect them (analyst
 *     override — no re-geocode).
 *   - Geocoder failures leave the patch untouched so the save still
 *     persists the user's address edit.
 */
export async function enrichCompPatchWithGeocode(
  patch: Record<string, unknown>,
  existing: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null
): Promise<Record<string, unknown>> {
  const touchesAddress =
    Object.prototype.hasOwnProperty.call(patch, "address") ||
    Object.prototype.hasOwnProperty.call(patch, "city") ||
    Object.prototype.hasOwnProperty.call(patch, "state");
  if (!touchesAddress) return patch;
  // Respect explicit analyst overrides — don't re-geocode if they
  // entered coordinates directly.
  if (patch.lat != null && patch.lng != null) return patch;

  const merged = {
    address: (patch.address as string | null | undefined) ?? existing?.address ?? null,
    city: (patch.city as string | null | undefined) ?? existing?.city ?? null,
    state: (patch.state as string | null | undefined) ?? existing?.state ?? null,
  };
  const addr = buildCompAddress(merged);
  if (!addr) return patch;
  const result = await geocodeAddress(addr);
  if (!result) return patch;
  return { ...patch, lat: result.lat, lng: result.lng };
}

// ─── Google Places ───────────────────────────────────────────────────────────
//
// Census only understands complete street addresses. Broker comp books
// frequently list properties by NAME only ("Linda Gardens Apartments, El
// Cajon, CA") — Census returns nothing, so the comp ends up with a
// city-only address and no coords. Google Places Text Search accepts free-
// form queries and resolves property names → full formatted address + lat/
// lng, which is exactly the gap we need filled for sale-comp extraction
// and pipeline project geocoding.
//
// Requires GOOGLE_PLACES_API_KEY. Without it, placesLookupAddress() returns
// null so callers degrade gracefully to their existing behavior (dev/
// preview envs that don't have the key configured still work).

export interface PlacesLookupResult {
  address: string | null;     // street-level portion, e.g. "1234 Main St"
  formatted_address: string;  // full "1234 Main St, City, ST 12345, USA"
  city: string | null;
  state: string | null;       // 2-letter US state code if resolvable
  lat: number;
  lng: number;
  place_id: string;
}

interface PlacesTextSearchResponse {
  status: string;
  results?: Array<{
    place_id: string;
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
}

/**
 * Resolve a free-form query ("Linda Gardens Apartments, El Cajon, CA") to a
 * full street address + coords via Google Places Text Search. Returns null
 * when no API key is set, the query returns ZERO_RESULTS, or the call fails.
 *
 * Uses Text Search (not Find Place) because broker-style queries benefit
 * from the fuller ranking signals, and we only need the top result.
 */
export async function placesLookupAddress(
  query: string
): Promise<PlacesLookupResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  if (!query || query.trim().length < 3) return null;

  // Normalize the cache key so trivially-different queries ("Linda Gardens
  // Apartments,  El Cajon, CA" vs "Linda Gardens Apartments, El Cajon, CA")
  // share a cache row.
  const cacheKey = query.toLowerCase().replace(/\s+/g, " ").trim();

  // DB cache: 90-day TTL on hits, 24h on negative results. Importing the
  // queries module lazily avoids a circular dep between geocode.ts and db.ts.
  try {
    const { placesCacheQueries } = await import("./db");
    const cached = await placesCacheQueries.get(cacheKey);
    if (cached) {
      const ageMs = Date.now() - new Date(cached.created_at).getTime();
      const TTL_HIT = 90 * 24 * 60 * 60 * 1000;
      const TTL_MISS = 24 * 60 * 60 * 1000;
      const ttl = cached.hit ? TTL_HIT : TTL_MISS;
      if (ageMs < ttl) {
        return cached.hit ? (cached.result as PlacesLookupResult) : null;
      }
    }
  } catch (err) {
    console.warn("places_cache read failed (continuing uncached):", err);
  }

  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}` +
    `&region=us` +
    `&key=${encodeURIComponent(apiKey)}`;

  try {
    assertAllowedFetchUrl(url);
  } catch (err) {
    console.error("Google Places URL rejected by allowlist:", err);
    return null;
  }

  const writeCache = async (result: PlacesLookupResult | null) => {
    try {
      const { placesCacheQueries } = await import("./db");
      await placesCacheQueries.set(cacheKey, result, result != null);
    } catch (err) {
      console.warn("places_cache write failed:", err);
    }
  };

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`Google Places HTTP ${res.status} for "${query}"`);
      return null;
    }
    const json = (await res.json()) as PlacesTextSearchResponse;
    if (json.status !== "OK" || !json.results || json.results.length === 0) {
      await writeCache(null);
      return null;
    }
    const top = json.results[0];
    const loc = top.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      await writeCache(null);
      return null;
    }

    // Text Search doesn't return address_components by default on the free
    // tier — parse the formatted_address instead. Format is reliably
    // "<street>, <city>, <STATE> <zip>, USA" for US results.
    const formatted = top.formatted_address ?? "";
    const parts = formatted.split(",").map((s) => s.trim()).filter(Boolean);
    let street: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    if (parts.length >= 3) {
      street = parts[0];
      city = parts[1];
      // "CA 92020" or "CA"
      const stateZip = parts[2];
      const m = stateZip.match(/^([A-Z]{2})\b/);
      if (m) state = m[1];
    } else if (parts.length === 2) {
      city = parts[0];
      const m = parts[1].match(/^([A-Z]{2})\b/);
      if (m) state = m[1];
    }

    // If the "street" field doesn't contain a digit, Places returned a
    // place-name-only result (e.g. "Linda Gardens Apartments") rather than
    // a street address — surface null for address so we don't overwrite
    // the user's original name with a duplicate.
    const looksLikeStreet = street != null && /\d/.test(street);

    const result: PlacesLookupResult = {
      address: looksLikeStreet ? street : null,
      formatted_address: formatted,
      city,
      state,
      lat: loc.lat,
      lng: loc.lng,
      place_id: top.place_id,
    };
    await writeCache(result);
    return result;
  } catch (err) {
    console.error(`Google Places error for "${query}":`, err);
    return null;
  }
}
