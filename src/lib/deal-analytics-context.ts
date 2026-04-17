// ─────────────────────────────────────────────────────────────────────────────
// Shared deal-analytics context builders.
//
// These helpers take raw database rows (underwriting JSONB, OM analysis,
// submarket metrics, sale comps, location intel) and format them into
// readable text blocks for the AI. Every investment-materials generator
// (DD Abstract, Investment Package memo/deck/one-pager, DealScore, Copilot)
// routes through the SAME set of helpers so the AI sees the same numbers
// regardless of which document is being produced.
//
// The underwriting builder computes stabilized NOI, going-in cap, yield on
// cost, exit value, and debt/equity split server-side so sections don't
// have to re-derive them from raw inputs (which the model does inconsistently).
// ─────────────────────────────────────────────────────────────────────────────

import { formatLocationIntelContext } from "@/lib/location-intel-context";
import type { OmAnalysisRow } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const n = (v: unknown) => typeof v === "number" ? v : 0;
const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct = (v: number) => `${v.toFixed(2)}%`;

// ─── Underwriting summary ────────────────────────────────────────────────────
//
// Turns the uw JSONB into the same structured analytics block the DD Abstract
// has always used. Computes:
//   - Gross potential revenue in-place and pro forma (with loss-to-lease)
//   - Operating expenses line-by-line plus management fee
//   - Stabilized NOI, going-in cap, yield on cost, exit value
//   - Total capitalization + debt/equity split
//   - Basis $/unit and $/SF
//   - Financing + refi terms
//   - CapEx / development line items
//
// Every number gets labeled with its source so the AI can cite it back
// ("per internal UW model"). Missing inputs are simply skipped — the block
// never invents numbers.

export function buildUnderwritingSummary(
  uw: AnyRec | null,
  deal: { property_type?: string; asking_price?: number | null; square_footage?: number | null; units?: number | null },
  dealNotes?: Array<{ text: string; category: string }>
): string {
  if (!uw) return "";

  const lines: string[] = [];
  const isSH = deal.property_type === "student_housing";
  const isMF = deal.property_type === "multifamily" || deal.property_type === "sfr" || isSH;

  // ── Basis ───────────────────────────────────────────────────────────────
  const purchasePrice = n(uw.purchase_price);
  const closingCostsPct = n(uw.closing_costs_pct);
  const closingCosts = purchasePrice * (closingCostsPct / 100);
  const units = n(deal.units);
  const sf = n(deal.square_footage) || n(uw.max_gsf);
  if (purchasePrice > 0) {
    const basisParts = [`Purchase Price: ${fc(purchasePrice)}`];
    if (units > 0) basisParts.push(`$${Math.round(purchasePrice / units).toLocaleString()}/unit`);
    if (sf > 0) basisParts.push(`$${(purchasePrice / sf).toFixed(0)}/SF`);
    lines.push(basisParts.join(" | "));
  }
  if (closingCostsPct > 0) lines.push(`Closing Costs: ${pct(closingCostsPct)} (${fc(closingCosts)})`);

  // ── Unit groups / revenue ──────────────────────────────────────────────
  const unitGroups: AnyRec[] = Array.isArray(uw.unit_groups) ? uw.unit_groups : [];
  if (unitGroups.length > 0) {
    const totalUnits = unitGroups.reduce((s, g) => s + n(g.unit_count), 0);
    lines.push(`\nREVENUE (${totalUnits} units, ${unitGroups.length} unit types):`);
    for (const g of unitGroups) {
      const label = g.label || "Unit";
      const count = n(g.unit_count);
      if (isSH) {
        const beds = n(g.beds_per_unit);
        const ipBed = n(g.current_rent_per_bed);
        const mktBed = n(g.market_rent_per_bed);
        lines.push(`  ${label}: ${count} units, ${beds}bed/unit, in-place ${fc(ipBed)}/bed/mo, market ${fc(mktBed)}/bed/mo`);
      } else if (isMF) {
        const ipRent = n(g.current_rent_per_unit);
        const mktRent = n(g.market_rent_per_unit);
        const bdba = g.bedrooms != null && g.bathrooms != null ? ` ${g.bedrooms}BD/${g.bathrooms}BA` : "";
        const sfPart = g.sf_per_unit ? `, ${n(g.sf_per_unit)} SF/unit` : "";
        lines.push(`  ${label}:${bdba} ${count} units${sfPart}, in-place ${fc(ipRent)}/mo, market ${fc(mktRent)}/mo`);
      } else {
        const psf = n(g.sf_per_unit);
        const ipRent = n(g.current_rent_per_sf);
        const mktRent = n(g.market_rent_per_sf);
        lines.push(`  ${label}: ${count} units, ${psf.toLocaleString()} SF/unit, in-place $${ipRent.toFixed(2)}/SF, market $${mktRent.toFixed(2)}/SF`);
      }
      if (g.will_renovate) lines.push(`    → Renovating ${count} units at ${fc(n(g.renovation_cost_per_unit))}/unit`);
    }

    // GPR in-place vs pro forma → implied loss-to-lease
    let inPlaceGPR = 0, proFormaGPR = 0;
    for (const g of unitGroups) {
      if (isSH) {
        inPlaceGPR += n(g.unit_count) * n(g.beds_per_unit) * n(g.current_rent_per_bed) * 12;
        proFormaGPR += n(g.unit_count) * n(g.beds_per_unit) * n(g.market_rent_per_bed) * 12;
      } else if (isMF) {
        inPlaceGPR += n(g.unit_count) * n(g.current_rent_per_unit) * 12;
        proFormaGPR += n(g.unit_count) * n(g.market_rent_per_unit) * 12;
      } else {
        inPlaceGPR += n(g.unit_count) * n(g.sf_per_unit) * n(g.current_rent_per_sf);
        proFormaGPR += n(g.unit_count) * n(g.sf_per_unit) * n(g.market_rent_per_sf);
      }
    }
    lines.push(`  Gross Potential Revenue: ${fc(inPlaceGPR)} in-place → ${fc(proFormaGPR)} pro forma`);
    if (inPlaceGPR > 0 && proFormaGPR > inPlaceGPR) {
      const ltl = ((proFormaGPR - inPlaceGPR) / proFormaGPR) * 100;
      lines.push(`  Implied Loss-to-Lease: ${ltl.toFixed(1)}% (${fc(proFormaGPR - inPlaceGPR)}/yr uplift)`);
    }
  }

  // ── Other income / commercial tenants (for mixed-use) ──────────────────
  const otherIncome: AnyRec[] = Array.isArray(uw.other_income_items) ? uw.other_income_items : [];
  if (otherIncome.length > 0) {
    const total = otherIncome.reduce((s, o) => s + (n(o.amount_annual) || n(o.amount_per_unit) * n(deal.units)), 0);
    lines.push(`\nOTHER INCOME (${otherIncome.length} sources, ${fc(total)}/yr):`);
    for (const o of otherIncome) {
      const amt = n(o.amount_annual) || n(o.amount_per_unit) * n(deal.units);
      lines.push(`  ${o.label || "Other"}: ${fc(amt)}/yr${o.note ? ` — ${o.note}` : ""}`);
    }
  }
  const commercialTenants: AnyRec[] = Array.isArray(uw.commercial_tenants) ? uw.commercial_tenants : [];
  if (commercialTenants.length > 0) {
    lines.push(`\nCOMMERCIAL TENANTS (${commercialTenants.length}):`);
    for (const t of commercialTenants) {
      const parts: string[] = [];
      parts.push(t.tenant_name || "Tenant");
      if (t.leased_sf) parts.push(`${Number(t.leased_sf).toLocaleString()} SF`);
      if (t.base_rent_per_sf) parts.push(`$${Number(t.base_rent_per_sf).toFixed(2)}/SF base`);
      if (t.lease_end) parts.push(`exp ${t.lease_end}`);
      if (t.lease_type) parts.push(t.lease_type);
      lines.push(`  ${parts.join(" | ")}`);
    }
  }

  // ── Operating assumptions + OpEx build-up ──────────────────────────────
  const vacancyRate = n(uw.vacancy_rate);
  const ipVacancyRate = n(uw.in_place_vacancy_rate) || vacancyRate;
  const mgmtFeePct = n(uw.management_fee_pct);
  lines.push(`\nOPERATING ASSUMPTIONS:`);
  lines.push(`  In-Place Vacancy: ${pct(ipVacancyRate)} | Pro Forma Vacancy: ${pct(vacancyRate)}`);
  lines.push(`  Management Fee: ${pct(mgmtFeePct)} of EGI`);

  const opexItemsRaw: Array<[string, number]> = [
    ["Taxes", n(uw.taxes_annual)],
    ["Insurance", n(uw.insurance_annual)],
    ["Repairs", n(uw.repairs_annual)],
    ["Utilities", n(uw.utilities_annual)],
    ["G&A", n(uw.ga_annual)],
    ["Marketing", n(uw.marketing_annual)],
    ["Reserves", n(uw.reserves_annual)],
    ["Other", n(uw.other_expenses_annual)],
  ];
  const opexItems: Array<[string, number]> = opexItemsRaw.filter(([, v]) => v > 0);
  if (opexItems.length > 0) {
    const totalOpex = opexItems.reduce((s, [, v]) => s + v, 0);
    const opexPerUnit = units > 0 ? totalOpex / units : 0;
    lines.push(`\nOPERATING EXPENSES (${fc(totalOpex)}/yr${opexPerUnit ? ` · $${Math.round(opexPerUnit).toLocaleString()}/unit/yr` : ""}):`);
    for (const [label, val] of opexItems) {
      lines.push(`  ${label}: ${fc(val)}/yr`);
    }
  }

  // ── CapEx ──────────────────────────────────────────────────────────────
  const capexItems: AnyRec[] = Array.isArray(uw.capex_items) ? uw.capex_items : [];
  const capexTotal = capexItems.reduce((s, c) => s + n(c.quantity) * n(c.cost_per_unit), 0);
  if (capexItems.length > 0) {
    lines.push(`\nCAPEX (${capexItems.length} items, ${fc(capexTotal)} total${units > 0 ? ` · $${Math.round(capexTotal / units).toLocaleString()}/unit` : ""}):`);
    for (const c of capexItems) {
      const qty = n(c.quantity);
      const cpu = n(c.cost_per_unit);
      lines.push(`  ${c.label || "Item"}: ${qty} × ${fc(cpu)} = ${fc(qty * cpu)}${c.linked_unit_group_id ? " (renovation)" : ""}`);
    }
  }

  // ── Financing ──────────────────────────────────────────────────────────
  if (uw.has_financing) {
    const ltc = n(uw.acq_ltc);
    const rate = n(uw.acq_interest_rate);
    const amort = n(uw.acq_amort_years);
    const io = n(uw.acq_io_years);
    lines.push(`\nFINANCING:`);
    lines.push(`  Acquisition: ${pct(ltc)} LTC, ${pct(rate)} rate, ${amort}yr amort${io > 0 ? `, ${io}yr I/O` : ""}`);
    if (uw.has_refi) {
      lines.push(`  Refi in Year ${n(uw.refi_year)}: ${pct(n(uw.refi_ltv))} LTV, ${pct(n(uw.refi_rate))} rate, ${n(uw.refi_amort_years)}yr amort`);
    }
  }

  // ── Exit ───────────────────────────────────────────────────────────────
  const exitCapRate = n(uw.exit_cap_rate);
  const holdPeriod = n(uw.hold_period_years);
  if (exitCapRate > 0) lines.push(`\nEXIT: ${pct(exitCapRate)} exit cap, ${holdPeriod}yr hold`);

  // ── Computed returns ───────────────────────────────────────────────────
  let pfGPR = 0;
  for (const g of unitGroups) {
    if (isSH) pfGPR += n(g.unit_count) * n(g.beds_per_unit) * n(g.market_rent_per_bed) * 12;
    else if (isMF) pfGPR += n(g.unit_count) * n(g.market_rent_per_unit) * 12;
    else pfGPR += n(g.unit_count) * n(g.sf_per_unit) * n(g.market_rent_per_sf);
  }
  const egi = pfGPR * (1 - vacancyRate / 100);
  const mgmtFee = egi * (mgmtFeePct / 100);
  const fixedOpex = opexItems.reduce((s, [, v]) => s + v, 0);
  const totalOpexWithMgmt = mgmtFee + fixedOpex;
  const noi = egi - totalOpexWithMgmt;
  const totalCost = purchasePrice + closingCosts + capexTotal;
  const capRate = purchasePrice > 0 ? (noi / purchasePrice) * 100 : 0;
  const yoc = totalCost > 0 ? (noi / totalCost) * 100 : 0;
  const exitValue = exitCapRate > 0 && noi > 0 ? noi / (exitCapRate / 100) : 0;

  if (noi > 0) {
    lines.push(`\nCOMPUTED RETURNS (stabilized, before debt):`);
    lines.push(`  Effective Gross Income: ${fc(egi)}`);
    lines.push(`  Operating Expenses (incl. mgmt fee): ${fc(totalOpexWithMgmt)}`);
    lines.push(`  Pro Forma NOI: ${fc(noi)}${units > 0 ? ` · $${Math.round(noi / units).toLocaleString()}/unit` : ""}`);
    lines.push(`  Going-In Cap Rate: ${pct(capRate)}`);
    lines.push(`  Yield on Cost: ${pct(yoc)}`);
    if (exitValue > 0) {
      lines.push(`  Implied Exit Value: ${fc(exitValue)}${units > 0 ? ` · $${Math.round(exitValue / units).toLocaleString()}/unit` : ""}`);
    }
    if (uw.has_financing && totalCost > 0) {
      const acqLoan = totalCost * (n(uw.acq_ltc) / 100);
      const equity = totalCost - acqLoan;
      const annualDS = acqLoan * (n(uw.acq_interest_rate) / 100);
      const dscr = annualDS > 0 ? noi / annualDS : 0;
      const debtYield = acqLoan > 0 ? (noi / acqLoan) * 100 : 0;
      lines.push(`  Total Capitalization: ${fc(totalCost)} (${fc(acqLoan)} debt + ${fc(equity)} equity)`);
      if (dscr > 0) lines.push(`  Interest-Only DSCR at stabilization: ${dscr.toFixed(2)}x`);
      if (debtYield > 0) lines.push(`  Debt Yield at stabilization: ${pct(debtYield)}`);
    }
  }

  // ── Analyst notes ──────────────────────────────────────────────────────
  if (dealNotes && dealNotes.length > 0) {
    lines.push(`\nDEAL NOTES:`);
    const categoryLabels: Record<string, string> = { context: "Context", thesis: "Thesis", risk: "Risk", review: "Review" };
    for (const note of dealNotes) {
      const cat = categoryLabels[note.category] || note.category;
      lines.push(`  [${cat}] ${note.text}`);
    }
  }
  if (typeof uw.notes === "string" && uw.notes.trim()) {
    lines.push(`  ${uw.notes}`);
  }

  return lines.join("\n");
}

// ─── OM Analysis summary ────────────────────────────────────────────────────
// Formats the OM Analysis row that sits alongside the internal UW model —
// useful for highlighting deltas between the seller's pitch and our numbers.

export function buildOmSummary(om: OmAnalysisRow | null): string {
  if (!om || om.status !== "complete") return "";
  const lines: string[] = ["OM ANALYSIS FINDINGS (seller's representations):"];

  if (om.property_name) lines.push(`  Property: ${om.property_name}`);
  if (om.address) lines.push(`  Address: ${om.address}`);
  if (om.year_built) lines.push(`  Year Built: ${om.year_built}`);
  if (om.sf) lines.push(`  Square Footage: ${om.sf.toLocaleString()}`);
  if (om.unit_count) lines.push(`  Units: ${om.unit_count}`);
  if (om.asking_price) lines.push(`  Asking Price: ${fc(om.asking_price)}`);
  if (om.noi) lines.push(`  Reported NOI: ${fc(om.noi)}`);
  if (om.cap_rate) lines.push(`  Reported Cap Rate: ${pct(om.cap_rate)}`);
  if (om.vacancy_rate) lines.push(`  Reported Vacancy: ${pct(om.vacancy_rate)}`);
  if (om.expense_ratio) lines.push(`  Expense Ratio: ${pct(om.expense_ratio)}`);
  if (om.price_per_sf) lines.push(`  $/SF: ${fc(om.price_per_sf)}`);
  if (om.price_per_unit) lines.push(`  $/Unit: ${fc(om.price_per_unit)}`);
  if (om.rent_growth) lines.push(`  Rent Growth Assumption: ${om.rent_growth}`);
  if (om.exit_cap_rate) lines.push(`  Exit Cap Assumption: ${om.exit_cap_rate}`);
  if (om.deal_score) lines.push(`  OM Score: ${om.deal_score}/10`);
  if (om.summary) lines.push(`\n  Summary: ${om.summary}`);
  if (om.red_flags && om.red_flags.length > 0) {
    lines.push(`\n  Red Flags:`);
    for (const rf of om.red_flags) {
      lines.push(`    [${rf.severity.toUpperCase()}] ${rf.category}: ${rf.description}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

// ─── Market summary ─────────────────────────────────────────────────────────
// Consolidates submarket metrics, selected sale comps, selected rent comps,
// and location-intelligence demographics into one block. The AI can then
// reason about supply/demand, cap-rate compression/expansion, and whether
// the underwritten growth assumptions track the market.

export function buildMarketSummary(
  submarketMetrics: AnyRec | null,
  compsAll: AnyRec[],
  locationIntel: AnyRec[],
  marketReports: AnyRec[] = []
): string {
  const lines: string[] = [];

  // AI-extracted broker research — this block captures the submarket's
  // CBRE / JLL / C&W / Newmark / M&M / Berkadia view so every section
  // prompt can cite the specific publication and vintage. Reports are
  // already ordered newest first (as_of_date DESC NULLS LAST).
  if (marketReports && marketReports.length > 0) {
    lines.push("BROKER RESEARCH (AI-extracted, latest first):");
    // Show the latest in detail and the trailing ones abbreviated.
    const latest = marketReports[0];
    const latestMetrics: AnyRec = typeof latest.metrics === "string"
      ? JSON.parse(latest.metrics || "{}")
      : (latest.metrics || {});
    const latestBits: string[] = [];
    if (latest.publisher) latestBits.push(latest.publisher.toUpperCase());
    if (latest.report_name) latestBits.push(`"${latest.report_name}"`);
    if (latest.as_of_date) latestBits.push(new Date(latest.as_of_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }));
    if (latest.msa || latest.submarket) latestBits.push([latest.submarket, latest.msa].filter(Boolean).join(" / "));
    lines.push(`  Latest — ${latestBits.join(" | ")}`);

    const metricLabels: Array<[string, string, string]> = [
      ["vacancy_pct", "Vacancy", "%"],
      ["occupancy_pct", "Occupancy", "%"],
      ["rent_growth_yoy_pct", "Rent Growth YoY", "%"],
      ["rent_growth_qoq_pct", "Rent Growth QoQ", "%"],
      ["effective_rent_per_unit", "Effective Rent/Unit", "$"],
      ["effective_rent_per_sf", "Effective Rent/SF", "$/SF"],
      ["concessions_weeks", "Concessions", " weeks"],
      ["concessions_pct", "Concessions", "% of rent"],
      ["absorption_units_ytd", "Absorption YTD", " units"],
      ["absorption_sf_ytd", "Absorption YTD", " SF"],
      ["deliveries_units_ytd", "Deliveries YTD", " units"],
      ["deliveries_sf_ytd", "Deliveries YTD", " SF"],
      ["under_construction_units", "Under Construction", " units"],
      ["under_construction_sf", "Under Construction", " SF"],
      ["planned_units", "Planned", " units"],
      ["cap_rate_low_pct", "Cap Rate Low", "%"],
      ["cap_rate_high_pct", "Cap Rate High", "%"],
      ["cap_rate_avg_pct", "Cap Rate Avg", "%"],
      ["sales_volume_ytd", "Sales Volume YTD", "$"],
      ["price_per_unit_avg", "Avg $/Unit", "$"],
      ["price_per_sf_avg", "Avg $/SF", "$"],
      ["job_growth_yoy_pct", "Job Growth YoY", "%"],
      ["unemployment_pct", "Unemployment", "%"],
    ];
    for (const [key, label, unit] of metricLabels) {
      const v = latestMetrics[key];
      if (v == null || v === "") continue;
      const formatted = unit === "$" && typeof v === "number"
        ? `$${Math.round(v).toLocaleString()}`
        : unit === "%" || unit.startsWith("%")
          ? `${v}${unit}`
          : `${typeof v === "number" ? v.toLocaleString() : v}${unit}`;
      lines.push(`    ${label}: ${formatted}`);
    }
    if (latest.narrative) lines.push(`    Publisher read: ${latest.narrative}`);

    const pipeline = typeof latest.pipeline === "string"
      ? JSON.parse(latest.pipeline || "[]")
      : (latest.pipeline || []);
    if (Array.isArray(pipeline) && pipeline.length > 0) {
      lines.push(`    Supply Pipeline (${pipeline.length} project${pipeline.length > 1 ? "s" : ""}):`);
      for (const p of pipeline.slice(0, 8) as AnyRec[]) {
        const bits: string[] = [];
        if (p.project_name) bits.push(p.project_name);
        if (p.developer) bits.push(`by ${p.developer}`);
        if (p.units) bits.push(`${p.units} units`);
        else if (p.sf) bits.push(`${Number(p.sf).toLocaleString()} SF`);
        if (p.expected_delivery) bits.push(`→ ${p.expected_delivery}`);
        if (p.status) bits.push(`(${String(p.status).replace("_", " ")})`);
        lines.push(`      - ${bits.join(" · ")}`);
      }
    }

    // QoQ deltas across vintages on the key metrics — only shown when at
    // least two reports exist so the developer can see the trend.
    if (marketReports.length > 1) {
      const keyMetrics = ["vacancy_pct", "rent_growth_yoy_pct", "cap_rate_avg_pct", "under_construction_units", "deliveries_units_ytd"];
      const deltaLines: string[] = [];
      for (const key of keyMetrics) {
        const series = marketReports
          .map((r) => {
            const m: AnyRec = typeof r.metrics === "string" ? JSON.parse(r.metrics || "{}") : (r.metrics || {});
            return { as_of: r.as_of_date, publisher: r.publisher, value: m[key] };
          })
          .filter((x) => x.value != null && x.value !== "")
          .slice(0, 4); // latest 4 vintages
        if (series.length >= 2) {
          const pretty = series
            .map((s) => `${s.publisher?.toUpperCase() || "?"} ${s.as_of ? new Date(s.as_of).toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : "?"}: ${s.value}`)
            .join(" → ");
          deltaLines.push(`    ${key.replace(/_/g, " ")}: ${pretty}`);
        }
      }
      if (deltaLines.length) {
        lines.push(`  Trend across vintages:`);
        for (const l of deltaLines) lines.push(l);
      }
    }
  }

  if (submarketMetrics) {
    const sm = submarketMetrics;
    const smLines: string[] = [];
    if (sm.submarket_name) smLines.push(`Submarket: ${sm.submarket_name}`);
    if (sm.msa) smLines.push(`MSA: ${sm.msa}`);
    if (sm.market_cap_rate != null) smLines.push(`Market Cap Rate: ${sm.market_cap_rate}%`);
    if (sm.market_vacancy != null) smLines.push(`Market Vacancy: ${sm.market_vacancy}%`);
    if (sm.market_rent_growth != null) smLines.push(`Market Rent Growth: ${sm.market_rent_growth}%/yr`);
    if (sm.absorption_units != null) smLines.push(`Absorption: ${sm.absorption_units} units/yr`);
    if (sm.deliveries_units != null) smLines.push(`Deliveries: ${sm.deliveries_units} units/yr`);
    if (smLines.length) lines.push(`SUBMARKET METRICS:\n  ${smLines.join("\n  ")}`);
    if (sm.narrative) lines.push(`Market Narrative: ${sm.narrative}`);
  }

  const saleComps = (compsAll || []).filter((c) => c.comp_type === "sale" && c.selected !== false);
  if (saleComps.length > 0) {
    // Trailing-12 comp-set averages — useful for benchmarking basis and
    // residual value assumptions against the actual transaction market.
    const capRates = saleComps.filter((c) => c.cap_rate != null).map((c) => Number(c.cap_rate));
    const ppUnits = saleComps.filter((c) => c.price_per_unit != null).map((c) => Number(c.price_per_unit));
    const ppSFs = saleComps.filter((c) => c.price_per_sf != null).map((c) => Number(c.price_per_sf));
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const avgCap = avg(capRates);
    const avgPPU = avg(ppUnits);
    const avgPSF = avg(ppSFs);
    const summary: string[] = [];
    if (avgCap) summary.push(`avg cap ${avgCap.toFixed(2)}%`);
    if (avgPPU) summary.push(`avg $${Math.round(avgPPU).toLocaleString()}/unit`);
    if (avgPSF) summary.push(`avg $${avgPSF.toFixed(0)}/SF`);
    lines.push(`\nSALE COMPARABLES (${saleComps.length} selected${summary.length ? ` · ${summary.join(" · ")}` : ""}):`);
    for (const c of saleComps.slice(0, 10)) {
      const parts: string[] = [];
      if (c.name) parts.push(c.name);
      if (c.address) parts.push(c.address);
      if (c.sale_price != null) parts.push(`Sale: ${fc(Number(c.sale_price))}`);
      if (c.cap_rate != null) parts.push(`Cap: ${c.cap_rate}%`);
      if (c.price_per_unit != null) parts.push(`$${Math.round(Number(c.price_per_unit)).toLocaleString()}/unit`);
      if (c.price_per_sf != null) parts.push(`$${Number(c.price_per_sf).toFixed(0)}/SF`);
      if (c.sale_date) parts.push(new Date(c.sale_date).toLocaleDateString());
      lines.push(`  - ${parts.join(" | ")}`);
    }
  }

  const rentComps = (compsAll || []).filter((c) => c.comp_type === "rent" && c.selected !== false);
  if (rentComps.length > 0) {
    const rpuList = rentComps.filter((c) => c.rent_per_unit != null).map((c) => Number(c.rent_per_unit));
    const rpsfList = rentComps.filter((c) => c.rent_per_sf != null).map((c) => Number(c.rent_per_sf));
    const occList = rentComps.filter((c) => c.occupancy_pct != null).map((c) => Number(c.occupancy_pct));
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const avgRPU = avg(rpuList);
    const avgRPSF = avg(rpsfList);
    const avgOcc = avg(occList);
    const summary: string[] = [];
    if (avgRPU) summary.push(`avg $${Math.round(avgRPU).toLocaleString()}/unit/mo`);
    if (avgRPSF) summary.push(`avg $${avgRPSF.toFixed(2)}/SF`);
    if (avgOcc) summary.push(`avg ${avgOcc.toFixed(1)}% occ`);
    lines.push(`\nRENT COMPARABLES (${rentComps.length} selected${summary.length ? ` · ${summary.join(" · ")}` : ""}):`);
    for (const c of rentComps.slice(0, 10)) {
      const parts: string[] = [];
      if (c.name) parts.push(c.name);
      if (c.address) parts.push(c.address);
      if (c.year_built) parts.push(`Built ${c.year_built}`);
      if (c.units) parts.push(`${c.units} units`);
      if (c.rent_per_unit != null) parts.push(`$${Math.round(Number(c.rent_per_unit)).toLocaleString()}/unit/mo`);
      if (c.rent_per_sf != null) parts.push(`$${Number(c.rent_per_sf).toFixed(2)}/SF`);
      if (c.occupancy_pct != null) parts.push(`${c.occupancy_pct}% occ`);
      lines.push(`  - ${parts.join(" | ")}`);
    }
  }

  const locationContext = formatLocationIntelContext(locationIntel || []);
  if (locationContext) lines.push(`\n${locationContext}`);

  return lines.join("\n");
}
