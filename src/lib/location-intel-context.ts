/**
 * Formats location intelligence DB rows into a readable text block for AI
 * context (copilot, deal score, DD abstract, investment package, etc.).
 *
 * Picks the best available radius (prefers 3mi, then smallest) and produces
 * a concise text section covering demographics, housing, employment, and
 * growth projections.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function formatLocationIntelContext(rows: AnyRecord[]): string {
  if (!rows || rows.length === 0) return "";

  // Prefer 3mi radius, then smallest available
  const sorted = [...rows].sort((a, b) => {
    if (Number(a.radius_miles) === 3) return -1;
    if (Number(b.radius_miles) === 3) return 1;
    return Number(a.radius_miles) - Number(b.radius_miles);
  });
  const row = sorted[0];

  const data: AnyRecord =
    typeof row.data === "string" ? JSON.parse(row.data) : row.data || {};
  const proj: AnyRecord =
    typeof row.projections === "string"
      ? JSON.parse(row.projections)
      : row.projections || {};

  const lines: string[] = [];

  const sourceLabel =
    row.data_source === "census_acs"
      ? `Census ACS ${row.source_year || ""}`
      : row.data_source === "report_upload"
      ? "User-uploaded report"
      : "User-provided data";

  lines.push(
    `LOCATION INTELLIGENCE (${row.radius_miles}-Mile Radius, ${sourceLabel}):`
  );

  // Demographics
  if (data.total_population != null)
    lines.push(`  Population: ${Number(data.total_population).toLocaleString()}`);
  if (data.population_growth_pct != null)
    lines.push(`  Population Growth: ${data.population_growth_pct}%/yr`);
  if (data.median_age != null) lines.push(`  Median Age: ${data.median_age}`);
  if (data.median_household_income != null)
    lines.push(
      `  Median HH Income: $${Number(data.median_household_income).toLocaleString()}`
    );
  if (data.per_capita_income != null)
    lines.push(
      `  Per Capita Income: $${Number(data.per_capita_income).toLocaleString()}`
    );
  if (data.bachelors_degree_pct != null)
    lines.push(`  Bachelor's Degree+: ${data.bachelors_degree_pct}%`);
  if (data.poverty_rate != null)
    lines.push(`  Poverty Rate: ${data.poverty_rate}%`);

  // Housing
  if (data.median_home_value != null)
    lines.push(
      `  Median Home Value: $${Number(data.median_home_value).toLocaleString()}`
    );
  if (data.median_gross_rent != null)
    lines.push(
      `  Median Rent: $${Number(data.median_gross_rent).toLocaleString()}/mo`
    );
  if (data.total_housing_units != null)
    lines.push(
      `  Total Housing Units: ${Number(data.total_housing_units).toLocaleString()}`
    );
  if (data.owner_occupied_pct != null)
    lines.push(
      `  Owner-Occupied: ${data.owner_occupied_pct}% | Renter: ${data.renter_occupied_pct ?? "—"}%`
    );

  // Employment
  if (data.labor_force != null)
    lines.push(
      `  Labor Force: ${Number(data.labor_force).toLocaleString()}`
    );
  if (data.unemployment_rate != null)
    lines.push(`  Unemployment Rate: ${data.unemployment_rate}%`);
  if (data.total_employed != null)
    lines.push(
      `  Total Employed: ${Number(data.total_employed).toLocaleString()}`
    );

  // Top industries
  if (data.top_industries?.length) {
    lines.push(
      `  Top Industries: ${data.top_industries
        .slice(0, 5)
        .map((i: AnyRecord) => {
          const bits = [`${i.name} (${i.share_pct}%`];
          if (i.yoy_pct != null) bits.push(`, ${i.yoy_pct > 0 ? "+" : ""}${i.yoy_pct}% YoY`);
          bits.push(")");
          return bits.join("");
        })
        .join(", ")}`
    );
  }

  // BLS QCEW detail — industry-by-industry employment + YoY growth, which
  // developers use to sanity-check rent growth / absorption assumptions.
  if (data.qcew) {
    const q = data.qcew as AnyRecord;
    const qLines: string[] = [];
    qLines.push(
      `BLS QCEW (${q.reporting_period}, private sector, county ${q.county_fips}):`
    );
    if (q.total_employment != null)
      qLines.push(
        `  Total Private Employment: ${Number(q.total_employment).toLocaleString()}${q.yoy_employment_pct != null ? ` (${q.yoy_employment_pct > 0 ? "+" : ""}${q.yoy_employment_pct}% YoY)` : ""}`
      );
    if (q.avg_weekly_wage != null)
      qLines.push(`  Average Weekly Wage: $${Number(q.avg_weekly_wage).toLocaleString()}`);
    if (Array.isArray(q.industries) && q.industries.length > 0) {
      qLines.push(`  Top Industries by Employment:`);
      for (const i of q.industries.slice(0, 8)) {
        const wage = i.avg_weekly_wage ? ` · $${Number(i.avg_weekly_wage).toLocaleString()}/wk` : "";
        const yoy = i.yoy_employment_pct != null ? ` · ${i.yoy_employment_pct > 0 ? "+" : ""}${i.yoy_employment_pct}% YoY` : "";
        qLines.push(
          `    - ${i.label}: ${Number(i.employment).toLocaleString()} (${i.employment_share_pct}% share${wage}${yoy})`
        );
      }
    }
    lines.push(qLines.join("\n"));
  }

  // BLS LAUS — monthly unemployment rate + 12-month trend if the LAUS feed
  // ran. These fields are written directly onto the data blob by the LAUS
  // fetch route, so we just surface them here.
  if (data.laus_month || data.unemployment_yoy_change != null) {
    const lausLines: string[] = [`BLS LAUS (county-level unemployment, ${data.laus_month || "latest month"}):`];
    if (data.unemployment_rate != null) {
      const yoy = data.unemployment_yoy_change != null
        ? ` (${data.unemployment_yoy_change > 0 ? "+" : ""}${data.unemployment_yoy_change} pp YoY)`
        : "";
      lausLines.push(`  Unemployment Rate: ${data.unemployment_rate}%${yoy}`);
    }
    lines.push(lausLines.join("\n"));
  }

  // Growth projections
  const projLines: string[] = [];
  if (proj.population_growth_5yr_pct != null)
    projLines.push(`Population Growth (5yr): ${proj.population_growth_5yr_pct}%`);
  if (proj.job_growth_5yr_pct != null)
    projLines.push(`Job Growth (5yr): ${proj.job_growth_5yr_pct}%`);
  if (proj.home_value_growth_5yr_pct != null)
    projLines.push(
      `Home Value Growth (5yr): ${proj.home_value_growth_5yr_pct}%`
    );
  if (proj.rent_growth_5yr_pct != null)
    projLines.push(`Rent Growth (5yr): ${proj.rent_growth_5yr_pct}%`);
  if (proj.new_units_pipeline != null)
    projLines.push(
      `New Units Pipeline: ${Number(proj.new_units_pipeline).toLocaleString()} units`
    );
  if (proj.notes) projLines.push(`Notes: ${proj.notes}`);

  if (projLines.length > 0) {
    lines.push(`  Growth Projections:`);
    for (const pl of projLines) {
      lines.push(`    ${pl}`);
    }
  }

  // AMI / Income Limits (critical for affordable housing deals)
  if (data.ami) {
    const ami = data.ami;
    const amiLines: string[] = [];
    amiLines.push(
      `Area Median Income (FY${ami.year}, ${ami.area_name}): $${Number(ami.median_family_income).toLocaleString()}`
    );
    if (ami.max_rents) {
      const r60 = ami.max_rents.ami_60;
      const r80 = ami.max_rents.ami_80;
      if (r60) amiLines.push(`  60% AMI Max Rent: Studio $${r60.studio}/mo, 1BR $${r60.one_br}/mo, 2BR $${r60.two_br}/mo, 3BR $${r60.three_br}/mo`);
      if (r80) amiLines.push(`  80% AMI Max Rent: Studio $${r80.studio}/mo, 1BR $${r80.one_br}/mo, 2BR $${r80.two_br}/mo, 3BR $${r80.three_br}/mo`);
    }
    if (ami.income_limits?.low_80) {
      amiLines.push(`  80% AMI Income Limit (4-person HH): $${Number(ami.income_limits.low_80[3] || 0).toLocaleString()}`);
    }
    lines.push(`  AMI & Affordability:`);
    for (const al of amiLines) {
      lines.push(`    ${al}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}
