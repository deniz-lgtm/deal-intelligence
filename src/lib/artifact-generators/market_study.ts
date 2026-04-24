/**
 * Market Study generator.
 *
 * Phase 0 MVP: composes four analyst-style exhibits from data we already
 * fetch in Location Intel + Comps — no new paid data sources, no polygon
 * model, no historical ACS beyond the existing 5-year comparison.
 *
 *   I-5  Demographics Summary     (single geography)
 *   I-6  Demographic Change       (2018 vs 2023 ACS deltas)
 *   I-7  Renter Income + Burden   (ACS B25118 / B25070)
 *   II-3 Rent Comp Inventory      (comps table, grouped + weighted)
 *
 * Rendered via the shared branded-PDF shell — same pipeline as zoning_report
 * and dd_abstract. Stale when the deal, location_intelligence row, or any
 * comp changes.
 */

import { renderKvTable } from "@/lib/report-html-shell";
import { renderBrandedPdf } from "./_shared/branded-pdf";
import {
  dealQueries,
  locationIntelligenceQueries,
  compQueries,
} from "@/lib/db";
import type { DemographicSnapshot } from "@/lib/types";
import type { ArtifactGenerator } from "./types";

interface MarketStudyPayload {
  /** Radius to read Location Intel from. Defaults to 3mi if not provided
   *  — this matches the default used in fetch-census's POST handler. */
  radius_miles?: number;
  /** Only show rent comps within this distance if provided. */
  max_comp_distance_mi?: number | null;
}

// ── Formatting helpers ────────────────────────────────────────────────────

const fn = (n: number | null | undefined, digits = 0): string =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
const fc = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US");
const fpct = (n: number | null | undefined, digits = 1): string =>
  n == null ? "—" : Number(n).toFixed(digits) + "%";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Exhibit I-5: Demographics Summary ────────────────────────────────────

function renderDemographicsSummary(d: DemographicSnapshot): string {
  const rows: Array<[string, string]> = [
    ["Total Population", fn(d.total_population)],
    ["Median Age", fn(d.median_age, 1)],
    ["Avg HH Size", fn(d.avg_household_size, 2)],
    ["Family Households", fpct(d.family_households_pct)],
    ["Median HH Income", fc(d.median_household_income)],
    ["Per Capita Income", fc(d.per_capita_income)],
    ["Poverty Rate", fpct(d.poverty_rate)],
    ["Bachelor's+ Degree", fpct(d.bachelors_degree_pct)],
    ["Total Housing Units", fn(d.total_housing_units)],
    ["Owner-Occupied", fpct(d.owner_occupied_pct)],
    ["Renter-Occupied", fpct(d.renter_occupied_pct)],
    ["Median Home Value", fc(d.median_home_value)],
    ["Median Gross Rent", d.median_gross_rent != null ? `${fc(d.median_gross_rent)}/mo` : "—"],
    ["Labor Force", fn(d.labor_force)],
    ["Employed", fn(d.total_employed)],
    ["Unemployment Rate", fpct(d.unemployment_rate)],
  ];
  return renderKvTable(rows);
}

function renderTopIndustries(d: DemographicSnapshot): string {
  if (!d.top_industries || d.top_industries.length === 0) return "";
  const rows = d.top_industries
    .slice(0, 8)
    .map((i) => `<tr><td>${esc(i.name)}</td><td style="text-align:right">${fpct(i.share_pct ?? null)}</td></tr>`)
    .join("");
  return `
    <h3>Employment by Industry</h3>
    <table class="kv-table"><tbody>
      <tr><th style="text-align:left">Industry</th><th style="text-align:right">Share</th></tr>
      ${rows}
    </tbody></table>
  `;
}

// ── Exhibit I-6: Demographic Change (5-year delta) ───────────────────────

function renderDemographicChange(d: DemographicSnapshot): string {
  const haveAny =
    d.population_growth_pct != null ||
    d.home_value_growth_pct != null ||
    d.rent_growth_pct != null;
  if (!haveAny) {
    return `<p class="muted">Growth rates require a second ACS vintage. Re-run the Census fetch on this deal to populate.</p>`;
  }
  const rows: Array<[string, string]> = [
    ["Population (annual Δ)", d.population_growth_pct != null ? fpct(d.population_growth_pct) : "—"],
    ["Median Home Value (annual Δ)", d.home_value_growth_pct != null ? fpct(d.home_value_growth_pct) : "—"],
    ["Median Gross Rent (annual Δ)", d.rent_growth_pct != null ? fpct(d.rent_growth_pct) : "—"],
  ];
  return `
    ${renderKvTable(rows)}
    <p class="muted" style="margin-top:8px">Source: Census ACS 5-Year, 2018→2023 delta, annualized.</p>
  `;
}

// ── Exhibit I-7: Renter Income + Burden ──────────────────────────────────

function renderRentershipExhibit(d: DemographicSnapshot): string {
  const blocks: string[] = [];

  if (d.renter_households_by_income) {
    const r = d.renter_households_by_income;
    const total = r.total ?? 0;
    const share = (n: number | null) =>
      total > 0 && n != null ? (n / total) * 100 : null;
    const rows: Array<[string, number | null]> = [
      ["Under $50,000", r.under_50k],
      ["$50,000 – $75,000", r.income_50_75k],
      ["$75,000 – $100,000", r.income_75_100k],
      ["$100,000 – $150,000", r.income_100_150k],
      ["$150,000+", r.over_150k],
    ];
    blocks.push(`
      <h3>Renter Households by Income</h3>
      <table class="kv-table"><tbody>
        <tr><th style="text-align:left">Income</th><th style="text-align:right">Renter HHs</th><th style="text-align:right">% of Renters</th></tr>
        ${rows
          .map(
            ([label, count]) =>
              `<tr><td>${esc(label)}</td><td style="text-align:right">${fn(count)}</td><td style="text-align:right">${fpct(share(count))}</td></tr>`
          )
          .join("")}
        <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${fn(total)}</strong></td><td style="text-align:right"><strong>100.0%</strong></td></tr>
      </tbody></table>
      <p class="muted">Source: Census ACS B25118 (Tenure by Household Income).</p>
    `);
  }

  if (d.renter_rent_burden) {
    const b = d.renter_rent_burden;
    const total = b.computed_total ?? 0;
    const share = (n: number | null) =>
      total > 0 && n != null ? (n / total) * 100 : null;
    const rows: Array<[string, number | null]> = [
      ["Spends < 20% on rent", b.under_20_pct],
      ["Spends 20–29%", b.pct_20_to_29],
      ["Rent-burdened (30%+)", b.pct_30_plus],
    ];
    blocks.push(`
      <h3>Rent Burden — Gross Rent as % of Household Income</h3>
      <table class="kv-table"><tbody>
        <tr><th style="text-align:left">Tranche</th><th style="text-align:right">Renter HHs</th><th style="text-align:right">% of Renters</th></tr>
        ${rows
          .map(
            ([label, count]) =>
              `<tr><td>${esc(label)}</td><td style="text-align:right">${fn(count)}</td><td style="text-align:right">${fpct(share(count))}</td></tr>`
          )
          .join("")}
      </tbody></table>
      <p class="muted">Source: Census ACS B25070 (Gross Rent as a % of Household Income). "Not computed" excluded.</p>
    `);
  }

  if (blocks.length === 0) {
    return `<p class="muted">Renter-income and rent-burden tables require an ACS fetch with B25118/B25070. Re-run the Census fetch to populate.</p>`;
  }
  return blocks.join("");
}

// ── Exhibit II-3: Rent Comp Inventory ────────────────────────────────────

interface RentCompRow {
  name: string | null;
  address: string | null;
  year_built: number | null;
  units: number | null;
  occupancy_pct: number | null;
  rent_per_unit: number | null;
  rent_per_sf: number | null;
  distance_mi: number | null;
  extra: Record<string, unknown> | null;
}

function renderRentCompInventory(
  comps: RentCompRow[],
  maxDistanceMi: number | null
): string {
  const filtered = maxDistanceMi
    ? comps.filter(
        (c) => c.distance_mi == null || Number(c.distance_mi) <= maxDistanceMi
      )
    : comps;

  if (filtered.length === 0) {
    return `<p class="muted">No rent comps on file for this deal${
      maxDistanceMi ? ` within ${maxDistanceMi} mi` : ""
    }. Add comps on the Comps & Market page to populate.</p>`;
  }

  const compRows = filtered
    .map((c) => {
      return `<tr>
        <td>${esc(c.name ?? c.address ?? "—")}</td>
        <td style="text-align:right">${c.year_built ?? "—"}</td>
        <td style="text-align:right">${fn(c.units)}</td>
        <td style="text-align:right">${fpct(c.occupancy_pct)}</td>
        <td style="text-align:right">${fc(c.rent_per_unit)}</td>
        <td style="text-align:right">${c.rent_per_sf != null ? "$" + Number(c.rent_per_sf).toFixed(2) : "—"}</td>
        <td style="text-align:right">${c.distance_mi != null ? Number(c.distance_mi).toFixed(1) + " mi" : "—"}</td>
      </tr>`;
    })
    .join("");

  // Weighted averages by units. Skip rows without units or rent.
  let unitTotal = 0;
  let rentUnitWeighted = 0;
  let rentSfWeighted = 0;
  let rentSfUnitTotal = 0;
  let occWeighted = 0;
  let occUnitTotal = 0;
  for (const c of filtered) {
    const u = Number(c.units);
    if (!Number.isFinite(u) || u <= 0) continue;
    unitTotal += u;
    if (c.rent_per_unit != null) rentUnitWeighted += Number(c.rent_per_unit) * u;
    if (c.rent_per_sf != null) {
      rentSfWeighted += Number(c.rent_per_sf) * u;
      rentSfUnitTotal += u;
    }
    if (c.occupancy_pct != null) {
      occWeighted += Number(c.occupancy_pct) * u;
      occUnitTotal += u;
    }
  }
  const avgRentUnit = unitTotal > 0 ? rentUnitWeighted / unitTotal : null;
  const avgRentSf = rentSfUnitTotal > 0 ? rentSfWeighted / rentSfUnitTotal : null;
  const avgOcc = occUnitTotal > 0 ? occWeighted / occUnitTotal : null;

  return `
    <table class="kv-table"><tbody>
      <tr>
        <th style="text-align:left">Project</th>
        <th style="text-align:right">Year Built</th>
        <th style="text-align:right">Units</th>
        <th style="text-align:right">Occ</th>
        <th style="text-align:right">Rent/Unit</th>
        <th style="text-align:right">Rent/SF</th>
        <th style="text-align:right">Dist</th>
      </tr>
      ${compRows}
      <tr>
        <td><strong>Weighted Avg (${fn(filtered.length)} comps / ${fn(unitTotal)} units)</strong></td>
        <td></td>
        <td></td>
        <td style="text-align:right"><strong>${fpct(avgOcc)}</strong></td>
        <td style="text-align:right"><strong>${fc(avgRentUnit)}</strong></td>
        <td style="text-align:right"><strong>${avgRentSf != null ? "$" + avgRentSf.toFixed(2) : "—"}</strong></td>
        <td></td>
      </tr>
    </tbody></table>
  `;
}

// ── Generator ────────────────────────────────────────────────────────────

const marketStudyGenerator: ArtifactGenerator = async (opts) => {
  const payload = (opts.payload ?? {}) as MarketStudyPayload;
  const radius = payload.radius_miles ?? 3;
  const maxDistanceMi = payload.max_comp_distance_mi ?? null;

  const deal = await dealQueries.getById(opts.dealId);
  if (!deal) throw new Error(`Deal ${opts.dealId} not found`);

  // Prefer the requested radius, then any radius on file. Fall back to
  // empty snapshot so the PDF still renders headers + source notes.
  let loc = await locationIntelligenceQueries.getByDealAndRadius(
    opts.dealId,
    radius
  );
  if (!loc) {
    const allLoc = await locationIntelligenceQueries.getByDealId(opts.dealId);
    loc = allLoc[0] ?? null;
  }
  const snapshot = (loc?.data ?? null) as DemographicSnapshot | null;

  const rentComps = (await compQueries.getByDealId(
    opts.dealId,
    "rent"
  )) as RentCompRow[];

  const dealName = (deal.name as string | null) ?? "Subject Property";

  const emptyMsg = `<p class="muted">Location Intel hasn't been fetched for this deal yet. Run Census fetch on the Location Intel page to populate the demographic exhibits.</p>`;

  const bodyHtml = `
    <div class="section">
      <h2>Exhibit I-5 · Demographics Summary</h2>
      <p class="muted">Geography: ${loc ? `${esc(loc.radius_miles)}-mile radius around subject (${esc(loc.source_notes ?? "Census ACS 5-Year")})` : "—"}</p>
      ${snapshot ? renderDemographicsSummary(snapshot) : emptyMsg}
      ${snapshot ? renderTopIndustries(snapshot) : ""}
    </div>

    <div class="section">
      <h2>Exhibit I-6 · Demographic Change</h2>
      ${snapshot ? renderDemographicChange(snapshot) : emptyMsg}
    </div>

    <div class="section">
      <h2>Exhibit I-7 · Changing Nature of Rentership</h2>
      ${snapshot ? renderRentershipExhibit(snapshot) : emptyMsg}
    </div>

    <div class="section">
      <h2>Exhibit II-3 · Select Rental Inventory</h2>
      ${renderRentCompInventory(rentComps, maxDistanceMi)}
    </div>
  `;

  // Fold the comp count and updated-at into the hash so editing a comp or
  // re-fetching Census flips staleness without needing to hook every table.
  const compFingerprint = rentComps
    .map((c) => `${c.name ?? ""}|${c.units ?? ""}|${c.rent_per_unit ?? ""}`)
    .join(";");

  return renderBrandedPdf(opts, {
    kind: "market_study",
    artifactTitle: "Market Study",
    headline: dealName,
    eyebrow: "MARKET STUDY",
    subtitle: `Demographics · Rentership · Rent Comps · ${new Date().toLocaleDateString()}`,
    bodyHtml,
    summary: `Market Study · ${rentComps.length} rent comps · ${new Date().toLocaleDateString()}`,
    hashExtras: {
      radius_miles: loc?.radius_miles ?? radius,
      locUpdatedAt: loc?.updated_at ?? null,
      compCount: rentComps.length,
      compFingerprintLen: compFingerprint.length,
    },
    deal: { id: deal.id as string, updated_at: (deal.updated_at ?? null) as string | Date | null },
  });
};

export default marketStudyGenerator;
