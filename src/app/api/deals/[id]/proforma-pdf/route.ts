import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { dealQueries, getBrandingForDeal, documentQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";
import { resolveBranding } from "@/lib/export-markdown";
import { calc, xirr } from "@/lib/underwriting-calc";
import { buildProformaPdf } from "@/lib/proforma-pdf";
import type { UWData } from "@/lib/underwriting-calc";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const { uwData, mode, massing_id } = (await req.json()) as {
      uwData: UWData;
      mode: "commercial" | "multifamily" | "student_housing";
      massing_id?: string;
    };

    const [deal, rawBranding] = await Promise.all([
      dealQueries.getById(params.id),
      getBrandingForDeal(params.id).catch(() => null),
    ]);

    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const theme = resolveBranding(rawBranding);
    const m = calc(uwData, mode);

    // IRR cash flows: [-equity, yr1, …, yrN + exitEquity]
    const irrFlows = m.yearlyDCF.map((yr, i) =>
      i === m.yearlyDCF.length - 1 ? yr.cashFlow + m.exitEquity : yr.cashFlow,
    );
    const irr = m.equity > 0 ? xirr([-m.equity, ...irrFlows]) : null;

    const today = new Date();
    const asOfDate = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;

    const pdfBytes = await buildProformaPdf(theme, {
      name:          deal.name || "Unnamed Deal",
      address:       deal.address || "",
      city:          deal.city   || "",
      state:         deal.state  || "",
      propertyType:  deal.property_type || "",
      yearBuilt:     deal.year_built    ?? null,
      units:         deal.units         ?? null,
      squareFootage: deal.square_footage ?? null,
      asOfDate,
    }, {
      irr,
      em:             m.em,
      stabilizedCoC:  m.stabilizedCoC,
      stabilizedDSCR: m.stabilizedDSCR,
      yoc:            m.yoc,
      proformaCapRate: m.proformaCapRate,
      exitCapRate:    uwData.exit_cap_rate,
      inPlaceCapRate: m.inPlaceCapRate,

      isDevelopment:   uwData.development_mode,
      // Acquisition: purchase_price / capex. Development: land_cost / hardCosts / softCosts
      purchasePrice:   uwData.development_mode ? (uwData.land_cost || 0) : (uwData.purchase_price || 0),
      hardCosts:       m.totalHardCosts,
      softCosts:       m.softCostsTotal,
      closingCosts:    m.closingCosts,
      capexTotal:      m.capexTotal,
      totalCost:       m.totalCost,
      acqLoan:         m.acqLoan,
      acqLtc:          uwData.acq_ltc,
      acqInterestRate: uwData.acq_interest_rate,
      acqAmortYears:   uwData.acq_amort_years,
      acqIoYears:      uwData.acq_io_years,
      equity:          m.equity,
      hasFinancing:    uwData.has_financing,

      vacancyRate:      uwData.vacancy_rate,
      rentGrowthPct:    uwData.rent_growth_pct,
      expenseGrowthPct: uwData.expense_growth_pct,
      holdPeriodYears:  uwData.hold_period_years,
      managementFeePct: uwData.management_fee_pct,

      inPlaceGPR:          m.inPlaceGPR,
      inPlaceVacancyLoss:  m.inPlaceVacancyLoss,
      inPlaceEGI:          m.inPlaceEGI,
      inPlaceTotalOpEx:    m.inPlaceTotalOpEx,
      inPlaceNOI:          m.inPlaceNOI,
      inPlaceCashFlow:     m.inPlaceCashFlow,
      inPlaceDebtService:  m.inPlaceDCF.debtService,

      proformaGPR:         m.proformaGPR,
      proformaVacancyLoss: m.proformaVacancyLoss,
      proformaEGI:         m.proformaEGI,
      proformaTotalOpEx:   m.proformaTotalOpEx,
      proformaNOI:         m.proformaNOI,
      stabilizedCashFlow:  m.stabilizedCashFlow,
      yr1Debt:             m.yr1Debt,

      yearlyDCF: m.yearlyDCF.slice(0, 5).map(yr => ({
        year:        yr.year,
        gpr:         yr.gpr,
        vacancyLoss: yr.vacancyLoss,
        egi:         yr.egi,
        totalOpEx:   yr.totalOpEx,
        noi:         yr.noi,
        debtService: yr.debtService,
        cashFlow:    yr.cashFlow,
      })),

      exitValue:      m.exitValue,
      exitEquity:     m.exitEquity,
      totalCashFlows: m.totalCashFlows,

      unitGroups: (uwData.unit_groups || []).map(g => ({
        label:                 g.label,
        unit_count:            g.unit_count,
        sf_per_unit:           g.sf_per_unit,
        bedrooms:              g.bedrooms,
        current_rent_per_unit: g.current_rent_per_unit,
        market_rent_per_unit:  g.market_rent_per_unit,
        current_rent_per_sf:   g.current_rent_per_sf,
        market_rent_per_sf:    g.market_rent_per_sf,
        is_commercial:         mode === "commercial",
      })),
    });

    const safeName = (deal.name || "Proforma")
      .replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "-");
    const filename = `Proforma-${safeName}.pdf`;

    // Save to the documents library so the analyst can pull up this
    // proforma later. Non-fatal: keep the download flowing even if the
    // library write fails.
    try {
      const docId = uuidv4();
      // `pdfBytes` is already a Uint8Array; Buffer.from() wraps it
      // without copying. Global Buffer is always available in Node
      // runtimes — no explicit import needed (and `node:buffer` can
      // trip up some older Next bundlers).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buffer = (globalThis as any).Buffer.from(pdfBytes) as Buffer;
      const dateStamp = new Date().toISOString().slice(0, 10);
      const blobPath = `deals/${params.id}/reports/${dateStamp}-${docId}-${filename}`;
      const url = await uploadBlob(blobPath, buffer, "application/pdf");
      await documentQueries.create({
        id: docId,
        deal_id: params.id,
        name: `Proforma — ${deal.name || "Deal"}`,
        original_name: filename,
        category: "proforma",
        file_path: url,
        file_size: buffer.length,
        mime_type: "application/pdf",
        content_text: null,
        ai_summary: `Proforma PDF · ${asOfDate}`,
        ai_tags: ["proforma", "ai-generated", ...(massing_id ? [`massing:${massing_id}`] : [])],
      });
    } catch (saveErr) {
      console.warn("Failed to save proforma to documents:", (saveErr as Error).message?.slice(0, 200));
    }

    // Cast needed: Uint8Array<ArrayBufferLike> in newer Node typings doesn't satisfy Next.js's BodyInit.
    return new NextResponse(pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    });
  } catch (err) {
    // Surface the real error to the client so the analyst can see why
    // the export failed instead of the generic "export failed" toast.
    // Trimmed + logged server-side for deep traces.
    console.error("[proforma-pdf] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `PDF generation failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}
