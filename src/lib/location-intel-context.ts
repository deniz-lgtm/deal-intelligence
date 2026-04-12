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
    `LOCATION INTELLIGENCE (${row.radius_miles}-Mile Radius — ${sourceLabel}):`
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
        .map((i: AnyRecord) => `${i.name} (${i.share_pct}%)`)
        .join(", ")}`
    );
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

  return lines.length > 1 ? lines.join("\n") : "";
}
