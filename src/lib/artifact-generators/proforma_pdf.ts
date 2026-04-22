import { v4 as uuidv4 } from "uuid";
import {
  dealQueries,
  getBrandingForDeal,
} from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { resolveBranding } from "@/lib/export-markdown";
import { calc, xirr } from "@/lib/underwriting-calc";
import { buildProformaPdf } from "@/lib/proforma-pdf";
import { computeArtifactHash } from "@/lib/artifact-hash";
import type { UWData } from "@/lib/underwriting-calc";
import type { ArtifactGenerator } from "./types";

interface ProformaPayload {
  uwData?: UWData;
  mode?: "commercial" | "multifamily" | "student_housing";
}

/**
 * Generates the branded proforma PDF directly (pdf-lib based, not
 * HTML→puppeteer). Migrated verbatim from
 * /api/deals/[id]/proforma-pdf so staleness, version history, and
 * library presentation flow through the unified artifact pipeline.
 */
const proformaPdfGenerator: ArtifactGenerator = async (opts) => {
  const payload = (opts.payload ?? {}) as ProformaPayload;
  const uwData = payload.uwData;
  const mode = payload.mode;
  if (!uwData || !mode) {
    throw new Error("proforma_pdf generator requires { uwData, mode } in payload");
  }

  const [deal, rawBranding] = await Promise.all([
    dealQueries.getById(opts.dealId),
    getBrandingForDeal(opts.dealId).catch(() => null),
  ]);
  if (!deal) throw new Error("Deal not found");

  const theme = resolveBranding(rawBranding);
  const m = calc(uwData, mode);

  const irrFlows = m.yearlyDCF.map((yr, i) =>
    i === m.yearlyDCF.length - 1 ? yr.cashFlow + m.exitEquity : yr.cashFlow
  );
  const irr = m.equity > 0 ? xirr([-m.equity, ...irrFlows]) : null;

  const today = new Date();
  const asOfDate = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;

  const pdfBytes = await buildProformaPdf(
    theme,
    {
      name: deal.name || "Unnamed Deal",
      address: deal.address || "",
      city: deal.city || "",
      state: deal.state || "",
      propertyType: deal.property_type || "",
      yearBuilt: deal.year_built ?? null,
      units: deal.units ?? null,
      squareFootage: deal.square_footage ?? null,
      asOfDate,
    },
    {
      irr,
      em: m.em,
      stabilizedCoC: m.stabilizedCoC,
      stabilizedDSCR: m.stabilizedDSCR,
      yoc: m.yoc,
      proformaCapRate: m.proformaCapRate,
      exitCapRate: uwData.exit_cap_rate,
      inPlaceCapRate: m.inPlaceCapRate,
      isDevelopment: uwData.development_mode,
      purchasePrice: uwData.development_mode ? uwData.land_cost || 0 : uwData.purchase_price || 0,
      hardCosts: m.totalHardCosts,
      softCosts: m.softCostsTotal,
      closingCosts: m.closingCosts,
      capexTotal: m.capexTotal,
      totalCost: m.totalCost,
      acqLoan: m.acqLoan,
      acqLtc: uwData.acq_ltc,
      acqInterestRate: uwData.acq_interest_rate,
      acqAmortYears: uwData.acq_amort_years,
      acqIoYears: uwData.acq_io_years,
      equity: m.equity,
      hasFinancing: uwData.has_financing,
      vacancyRate: uwData.vacancy_rate,
      rentGrowthPct: uwData.rent_growth_pct,
      expenseGrowthPct: uwData.expense_growth_pct,
      holdPeriodYears: uwData.hold_period_years,
      managementFeePct: uwData.management_fee_pct,
      inPlaceGPR: m.inPlaceGPR,
      inPlaceVacancyLoss: m.inPlaceVacancyLoss,
      inPlaceEGI: m.inPlaceEGI,
      inPlaceTotalOpEx: m.inPlaceTotalOpEx,
      inPlaceNOI: m.inPlaceNOI,
      inPlaceCashFlow: m.inPlaceCashFlow,
      inPlaceDebtService: m.inPlaceDCF.debtService,
      proformaGPR: m.proformaGPR,
      proformaVacancyLoss: m.proformaVacancyLoss,
      proformaEGI: m.proformaEGI,
      proformaTotalOpEx: m.proformaTotalOpEx,
      proformaNOI: m.proformaNOI,
      stabilizedCashFlow: m.stabilizedCashFlow,
      yr1Debt: m.yr1Debt,
      yearlyDCF: m.yearlyDCF.slice(0, 5).map((yr) => ({
        year: yr.year,
        gpr: yr.gpr,
        vacancyLoss: yr.vacancyLoss,
        egi: yr.egi,
        totalOpEx: yr.totalOpEx,
        noi: yr.noi,
        debtService: yr.debtService,
        cashFlow: yr.cashFlow,
      })),
      exitValue: m.exitValue,
      exitEquity: m.exitEquity,
      totalCashFlows: m.totalCashFlows,
      unitGroups: (uwData.unit_groups || []).map((g) => ({
        label: g.label,
        unit_count: g.unit_count,
        sf_per_unit: g.sf_per_unit,
        bedrooms: g.bedrooms,
        current_rent_per_unit: g.current_rent_per_unit,
        market_rent_per_unit: g.market_rent_per_unit,
        current_rent_per_sf: g.current_rent_per_sf,
        market_rent_per_sf: g.market_rent_per_sf,
        is_commercial: mode === "commercial",
      })),
    }
  );

  // pdfBytes is a Uint8Array; Buffer.from wraps it for uploadBlob's
  // Buffer-typed signature without copying.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = (globalThis as any).Buffer.from(pdfBytes) as Buffer;

  const safeName = (deal.name || "Proforma").replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "-");
  const filename = `Proforma-${safeName}.pdf`;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const blobPath = `deals/${opts.dealId}/reports/${dateStamp}-${uuidv4()}-${filename}`;
  const fileUrl = await uploadBlob(blobPath, buffer, "application/pdf");

  const { snapshot, hash } = computeArtifactHash({
    deal: { id: deal.id, updated_at: deal.updated_at },
    underwriting: null, // UW data was passed in payload; the hash below captures its fingerprint
    extras: {
      mode,
      holdPeriodYears: uwData.hold_period_years,
      exitCapRate: uwData.exit_cap_rate,
      irr: irr ?? null,
      em: m.em,
    },
  });

  return {
    title: `Proforma — ${deal.name || "Deal"}`,
    filename,
    filePath: fileUrl,
    fileSize: buffer.length,
    mimeType: "application/pdf",
    summary: `Proforma PDF · ${asOfDate}`,
    tags: [
      "proforma",
      "ai-generated",
      "pdf",
      ...(opts.massingId ? [`massing:${opts.massingId}`] : []),
    ],
    inputSnapshot: snapshot,
    inputHash: hash,
    contentText: null,
  };
};

export default proformaPdfGenerator;
