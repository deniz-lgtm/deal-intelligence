// Shared persistence layer for broker market research extraction.
//
// Both the dedicated market-reports POST endpoint and the background
// auto-extract path in /api/documents/upload run the same extractor and
// need to write the same rows: a market_reports history row for QoQ
// deltas, plus a submarket_metrics upsert so the Comps & Market sidebar,
// Co-Pilot benchmarks, DD abstract, and investment package all pick up
// the fresh vintage.

import { v4 as uuidv4 } from "uuid";
import { marketReportsQueries, submarketMetricsQueries } from "./db";
import type { MarketReportExtraction } from "./claude";

export interface PersistOptions {
  dealId: string;
  extraction: MarketReportExtraction;
  sourceDocumentId: string | null;
  sourceUrl: string | null;
  rawText: string | null;
  pipelineEnriched: unknown[];
}

/**
 * Insert a market_reports row and upsert submarket_metrics in one shot.
 * Returns the newly-created market_reports row. Does not throw on the
 * submarket_metrics side — if that upsert fails it's logged and we still
 * return the report row so the caller can show the extraction result.
 */
export async function persistMarketReport(opts: PersistOptions) {
  const { dealId, extraction, sourceDocumentId, sourceUrl, rawText } = opts;

  const id = uuidv4();
  const row = await marketReportsQueries.create(dealId, id, {
    publisher: extraction.publisher,
    report_name: extraction.report_name,
    asset_class: extraction.asset_class,
    msa: extraction.msa,
    submarket: extraction.submarket,
    as_of_date: extraction.as_of_date,
    source_document_id: sourceDocumentId,
    source_url: sourceUrl || extraction.source_url,
    metrics: extraction.metrics as Record<string, unknown>,
    pipeline: opts.pipelineEnriched,
    top_employers: extraction.top_employers,
    top_deliveries: extraction.top_deliveries,
    narrative: extraction.narrative,
    raw_text: rawText ? rawText.slice(0, 20_000) : null,
  });

  try {
    const m = extraction.metrics || {};
    const capAvg =
      m.cap_rate_avg_pct != null
        ? Number(m.cap_rate_avg_pct)
        : m.cap_rate_low_pct != null && m.cap_rate_high_pct != null
          ? (Number(m.cap_rate_low_pct) + Number(m.cap_rate_high_pct)) / 2
          : null;
    const smFields: Record<string, unknown> = {
      submarket_name: extraction.submarket ?? null,
      msa: extraction.msa ?? null,
      market_cap_rate: capAvg,
      market_rent_growth: m.rent_growth_yoy_pct ?? null,
      market_vacancy: m.vacancy_pct ?? m.availability_pct ?? null,
      absorption_units: m.absorption_units_ytd ?? null,
      deliveries_units: m.deliveries_units_ytd ?? null,
      narrative: extraction.narrative ?? null,
      sources: [
        [extraction.publisher, extraction.report_name, extraction.as_of_date]
          .filter(Boolean)
          .join(" — "),
      ].filter(Boolean),
    };
    const hasAnyValue = [
      smFields.submarket_name,
      smFields.msa,
      smFields.market_cap_rate,
      smFields.market_rent_growth,
      smFields.market_vacancy,
      smFields.absorption_units,
      smFields.deliveries_units,
      smFields.narrative,
    ].some((v) => v != null && v !== "");
    if (hasAnyValue) {
      const existing = await submarketMetricsQueries.getByDealId(dealId);
      await submarketMetricsQueries.upsert(
        dealId,
        existing?.id ?? uuidv4(),
        smFields
      );
    }
  } catch (err) {
    console.error("persistMarketReport: submarket_metrics upsert failed:", err);
  }

  return row;
}
