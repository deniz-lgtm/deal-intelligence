// Public-records assessor lookup.
//
// Once a comp has a resolved street address + lat/lng, county assessor
// records are the authoritative source for year_built, APN, last sale
// date/price, lot size, and tax assessed value. These fields are
// consistently missing from broker comp books — brokers report what
// they got from the seller, which is often stale or rounded.
//
// There is no single national assessor API (each of ~3,143 counties
// publishes on its own schedule, with its own schema, and many only
// via paid aggregators like ATTOM or Regrid). This module is a pluggable
// adapter surface so we can add providers one at a time without touching
// the call sites:
//
//   - `getAssessorAdapter()` returns whichever provider is configured via
//     env vars. With nothing configured, returns a no-op adapter so calls
//     degrade cleanly to null.
//   - Each adapter implements `lookup(address, state) -> AssessorRecord | null`.
//
// TODO(future): wire in an ATTOM or Regrid adapter when we're ready to
// pay for the license. The interface below is aligned with both.

export interface AssessorRecord {
  apn: string | null;                 // tax parcel ID
  year_built: number | null;
  lot_size_sf: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;      // ISO YYYY-MM-DD
  assessed_value_total: number | null;
  owner_name: string | null;
  source: string;                     // e.g. "attom", "regrid", "noop"
}

export interface AssessorAdapter {
  name: string;
  lookup(address: string, state: string | null): Promise<AssessorRecord | null>;
}

const NoopAdapter: AssessorAdapter = {
  name: "noop",
  async lookup() {
    return null;
  },
};

let _adapter: AssessorAdapter | null = null;

/**
 * Return the currently-configured adapter. Singleton so we don't re-check
 * env vars on every comp. Today always returns the no-op — the module
 * exists so callers can start depending on it (and tag provenance) while
 * the real provider integrations land behind env flags.
 */
export function getAssessorAdapter(): AssessorAdapter {
  if (_adapter) return _adapter;
  // Future: if (process.env.ATTOM_API_KEY) _adapter = createAttomAdapter();
  // Future: else if (process.env.REGRID_API_KEY) _adapter = createRegridAdapter();
  _adapter = NoopAdapter;
  return _adapter;
}

/**
 * Best-effort lookup. Never throws — if the adapter errors, returns null
 * so the caller continues without the assessor fields rather than
 * failing the whole extraction.
 */
export async function lookupAssessor(
  address: string | null | undefined,
  state: string | null | undefined
): Promise<AssessorRecord | null> {
  if (!address || address.trim().length < 5) return null;
  try {
    return await getAssessorAdapter().lookup(address, state || null);
  } catch (err) {
    console.error("assessor lookup failed for", address, err);
    return null;
  }
}
