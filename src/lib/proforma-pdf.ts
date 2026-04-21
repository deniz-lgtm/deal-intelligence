import { PDFDocument, StandardFonts, rgb, type RGB } from "pdf-lib";
import type { BrandingTheme } from "@/lib/export-markdown";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProformaUnitGroup {
  label: string;
  unit_count: number;
  sf_per_unit: number;
  bedrooms: number;
  current_rent_per_unit: number;
  market_rent_per_unit: number;
  current_rent_per_sf: number;
  market_rent_per_sf: number;
  is_commercial: boolean; // SF-based pricing vs unit-based
}

export interface ProformaDealMeta {
  name: string;
  address: string;
  city: string;
  state: string;
  propertyType: string;
  yearBuilt: number | null;
  units: number | null;
  squareFootage: number | null;
  asOfDate: string;
}

export interface ProformaMetrics {
  irr: number | null;
  em: number;
  stabilizedCoC: number;
  stabilizedDSCR: number;
  yoc: number;
  proformaCapRate: number;
  exitCapRate: number;
  inPlaceCapRate: number;

  // Capitalization — ground-up vs acquisition
  isDevelopment: boolean;
  purchasePrice: number;    // acquisition: purchase price; dev: land cost
  hardCosts: number;        // dev only
  softCosts: number;        // dev only
  closingCosts: number;
  capexTotal: number;       // acquisition only
  totalCost: number;
  acqLoan: number;
  acqLtc: number;
  acqInterestRate: number;
  acqAmortYears: number;
  acqIoYears: number;
  equity: number;
  hasFinancing: boolean;

  // Assumptions
  vacancyRate: number;
  rentGrowthPct: number;
  expenseGrowthPct: number;
  holdPeriodYears: number;
  managementFeePct: number;

  // Proforma (stabilized)
  inPlaceGPR: number;
  inPlaceVacancyLoss: number;
  inPlaceEGI: number;
  inPlaceTotalOpEx: number;
  inPlaceNOI: number;
  inPlaceCashFlow: number;
  inPlaceDebtService: number;

  proformaGPR: number;
  proformaVacancyLoss: number;
  proformaEGI: number;
  proformaTotalOpEx: number;
  proformaNOI: number;
  stabilizedCashFlow: number;
  yr1Debt: number;

  yearlyDCF: Array<{
    year: number;
    gpr: number;
    vacancyLoss: number;
    egi: number;
    totalOpEx: number;
    noi: number;
    debtService: number;
    cashFlow: number;
  }>;

  exitValue: number;
  exitEquity: number;
  totalCashFlows: number;

  // Unit mix
  unitGroups: ProformaUnitGroup[];
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return rgb(
    isFinite(r) ? r : 0,
    isFinite(g) ? g : 0,
    isFinite(b) ? b : 0,
  );
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const fc = (n: number, opts: { paren?: boolean } = {}) => {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(Math.round(n));
  const s = "$" + abs.toLocaleString("en-US");
  if (n < 0 && opts.paren) return `(${s})`;
  if (n < 0) return `-${s}`;
  return s;
};
const fp = (n: number, dec = 1) =>
  n == null || isNaN(n) || n === 0 ? "—" : n.toFixed(dec) + "%";
const fx = (n: number) =>
  n == null || isNaN(n) || n === 0 ? "—" : n.toFixed(2) + "x";
// Format thousands for DCF table
const fk = (n: number) => {
  if (n == null || isNaN(n)) return "—";
  const k = Math.round(n / 1000);
  if (k === 0 && n !== 0) return "<1";
  if (k < 0) return `(${Math.abs(k).toLocaleString()})`;
  return k.toLocaleString();
};

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildProformaPdf(
  theme: BrandingTheme,
  deal: ProformaDealMeta,
  m: ProformaMetrics,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);

  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── Palette ──────────────────────────────────────────────────────────────
  const primary   = hexToRgb(theme.primaryColor);
  const darkPanel = rgb(0.13, 0.16, 0.22);
  const white     = rgb(1, 1, 1);
  const ink       = rgb(0.10, 0.10, 0.12);
  const muted     = rgb(0.45, 0.45, 0.50);
  const rowAlt    = rgb(0.96, 0.96, 0.97);
  const rowBase   = rgb(1, 1, 1);
  const noiBg     = rgb(0.91, 0.94, 0.99);
  const cfBg      = rgb(0.91, 0.97, 0.93);
  const stripe    = rgb(0.97, 0.97, 0.98);

  // ── Layout constants ─────────────────────────────────────────────────────
  const ML = 36;          // margin left
  const MR = 576;         // margin right  (612 - 36)
  const W  = MR - ML;    // content width = 540
  let   y  = 758;        // current y (decrements as we add content)

  // ── Drawing helpers ──────────────────────────────────────────────────────

  const text = (
    t: string, x: number, yy: number,
    { sz = 8, f = reg, c = ink, mw }: { sz?: number; f?: typeof reg; c?: RGB; mw?: number } = {},
  ) => {
    let s = String(t);
    if (mw) {
      while (s.length > 1 && f.widthOfTextAtSize(s + "…", sz) > mw) s = s.slice(0, -1);
      if (s.length < String(t).length) s += "…";
    }
    page.drawText(s, { x, y: yy, size: sz, font: f, color: c });
    return f.widthOfTextAtSize(s, sz);
  };

  const textR = (t: string, rx: number, yy: number, opts: { sz?: number; f?: typeof reg; c?: RGB } = {}) => {
    const { sz = 8, f = reg, c = ink } = opts;
    const w = f.widthOfTextAtSize(String(t), sz);
    page.drawText(String(t), { x: rx - w, y: yy, size: sz, font: f, color: c });
  };

  const textC = (t: string, cx: number, yy: number, opts: { sz?: number; f?: typeof reg; c?: RGB } = {}) => {
    const { sz = 8, f = reg, c = ink } = opts;
    const w = f.widthOfTextAtSize(String(t), sz);
    page.drawText(String(t), { x: cx - w / 2, y: yy, size: sz, font: f, color: c });
  };

  const hline = (yy: number, c: RGB = stripe, th = 0.4) =>
    page.drawLine({ start: { x: ML, y: yy }, end: { x: MR, y: yy }, thickness: th, color: c });

  const vline = (x: number, y1: number, y2: number, c: RGB = stripe) =>
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.4, color: c });

  const rect = (x: number, yy: number, w: number, h: number, c: RGB) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color: c });

  // Section header: dark panel + white caps label
  const sectionHeader = (label: string, x: number, yy: number, w: number, h = 13) => {
    rect(x, yy - h, w, h, darkPanel);
    text(label.toUpperCase(), x + 5, yy - h + 3.5, { sz: 6.5, f: bold, c: white });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TOP STRIPE + HEADER BAR
  // ═══════════════════════════════════════════════════════════════════════════
  rect(ML, y, W, 6, primary);
  y -= 6;

  rect(ML, y - 16, W, 16, darkPanel);
  const confStr = (theme.footerText || "CONFIDENTIAL") + "  ·  " + deal.asOfDate;
  text(confStr, ML + 6, y - 12, { sz: 6.5, f: bold, c: rgb(0.75, 0.78, 0.85) });
  if (theme.companyName) {
    textR(theme.companyName, MR - 6, y - 12, { sz: 6.5, f: bold, c: white });
  }
  y -= 16;

  // Deal name
  y -= 10;
  text(deal.name || "Unnamed Deal", ML, y, { sz: 20, f: bold });
  y -= 22;

  // Address
  const addrParts = [deal.address, deal.city, deal.state].filter(Boolean);
  if (addrParts.length) {
    text(addrParts.join(", "), ML, y, { sz: 8, c: muted });
    y -= 11;
  }

  // Sub-line: type · units/SF · year built
  const subParts: string[] = [];
  if (deal.propertyType) subParts.push(deal.propertyType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
  if (deal.units) subParts.push(`${deal.units.toLocaleString()} units`);
  else if (deal.squareFootage) subParts.push(`${deal.squareFootage.toLocaleString()} SF`);
  if (deal.yearBuilt) subParts.push(`Built ${deal.yearBuilt}`);
  if (subParts.length) {
    text(subParts.join("  ·  "), ML, y, { sz: 7.5, c: muted });
    y -= 10;
  }

  y -= 4;
  hline(y, rgb(0.85, 0.85, 0.88), 0.6);
  y -= 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. KPI BAND  (6 tiles)
  // ═══════════════════════════════════════════════════════════════════════════
  const kpiH = 40;
  const kpis = [
    { label: "IRR",             val: m.irr != null ? fp(m.irr, 1) : "—" },
    { label: "Equity Multiple", val: fx(m.em) },
    { label: "Stab. CoC",      val: fp(m.stabilizedCoC, 1) },
    { label: "Stab. DSCR",     val: m.stabilizedDSCR > 0 ? `${m.stabilizedDSCR.toFixed(2)}x` : "—" },
    { label: "Yield on Cost",  val: fp(m.yoc, 2) },
    { label: "Exit Cap",       val: m.exitCapRate > 0 ? fp(m.exitCapRate, 2) : "—" },
  ];
  const kpiW = W / kpis.length;
  rect(ML, y - kpiH, W, kpiH, stripe);
  kpis.forEach((kpi, i) => {
    const kx = ML + i * kpiW;
    // subtle alternating tint
    if (i % 2 === 0) rect(kx, y - kpiH, kpiW, kpiH, rgb(0.94, 0.94, 0.96));
    textC(kpi.label, kx + kpiW / 2, y - 11, { sz: 6.5, c: muted });
    textC(kpi.val, kx + kpiW / 2, y - 28, { sz: 13, f: bold, c: primary });
    if (i > 0) vline(kx, y - kpiH, y, rgb(0.88, 0.88, 0.90));
  });
  y -= kpiH + 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. UNIT MIX  (skipped when no unit groups)
  // ═══════════════════════════════════════════════════════════════════════════
  const validGroups = m.unitGroups.filter(g => g.unit_count > 0);
  if (validGroups.length > 0) {
    sectionHeader("Unit / Space Mix", ML, y, W);
    y -= 13;

    // Column layout: Type | Units | SF/Unit | Mkt Rent | Mkt Rent/SF
    const umCols = [
      { label: "Type",         w: 140, align: "L" },
      { label: "Units / SF",   w: 65,  align: "R" },
      { label: "SF / Unit",    w: 60,  align: "R" },
      { label: "Curr Rent/mo", w: 80,  align: "R" },
      { label: "Mkt Rent/mo",  w: 80,  align: "R" },
      { label: "Mkt Rent/SF",  w: 75,  align: "R" },
    ] as const;

    // Header row
    const umHeaderH = 12;
    rect(ML, y - umHeaderH, W, umHeaderH, rgb(0.90, 0.90, 0.93));
    let cx = ML;
    umCols.forEach(col => {
      if (col.align === "R") textR(col.label, cx + col.w - 4, y - umHeaderH + 3, { sz: 6.5, f: bold, c: muted });
      else text(col.label, cx + 4, y - umHeaderH + 3, { sz: 6.5, f: bold, c: muted });
      cx += col.w;
    });
    y -= umHeaderH;

    // Data rows
    const umRowH = 11;
    const totals = { units: 0, sf: 0 };
    validGroups.forEach((g, i) => {
      const bg = i % 2 === 0 ? rowBase : rowAlt;
      rect(ML, y - umRowH, W, umRowH, bg);
      let dx = ML;

      const isComm = g.is_commercial;
      const mrRent  = isComm ? g.market_rent_per_sf  : g.market_rent_per_unit;
      const curRent = isComm ? g.current_rent_per_sf : g.current_rent_per_unit;
      const unitSF  = isComm ? g.sf_per_unit         : g.sf_per_unit;
      const totalUnitsOrSF = isComm ? g.unit_count * g.sf_per_unit : g.unit_count;
      const rentPerSF = isComm
        ? (g.market_rent_per_sf > 0 ? `$${g.market_rent_per_sf.toFixed(2)}/SF` : "—")
        : (unitSF > 0 && mrRent > 0 ? `$${(mrRent / unitSF).toFixed(2)}` : "—");

      totals.units += g.unit_count;
      totals.sf    += g.unit_count * g.sf_per_unit;

      const cols2 = [
        { v: g.label || "Unit", align: "L" },
        { v: isComm ? `${totalUnitsOrSF.toLocaleString()} SF` : g.unit_count.toLocaleString(), align: "R" },
        { v: unitSF > 0 ? `${unitSF.toLocaleString()} SF` : "—", align: "R" },
        { v: curRent > 0 ? (isComm ? `$${curRent.toFixed(2)}/SF` : `$${Math.round(curRent).toLocaleString()}`) : "—", align: "R" },
        { v: mrRent  > 0 ? (isComm ? `$${mrRent.toFixed(2)}/SF`  : `$${Math.round(mrRent).toLocaleString()}`)  : "—", align: "R" },
        { v: rentPerSF, align: "R" },
      ] as const;

      umCols.forEach((col, ci) => {
        const cv = cols2[ci];
        if (cv.align === "R") textR(cv.v, dx + col.w - 4, y - umRowH + 3, { sz: 7 });
        else text(cv.v, dx + 4, y - umRowH + 3, { sz: 7, f: i === 0 ? reg : reg });
        dx += col.w;
      });
      y -= umRowH;
    });

    // Totals row
    if (validGroups.length > 1) {
      rect(ML, y - umRowH, W, umRowH, rgb(0.88, 0.88, 0.92));
      text("Total", ML + 4, y - umRowH + 3, { sz: 7, f: bold });
      const col1end = ML + umCols[0].w + umCols[1].w;
      textR(`${totals.units.toLocaleString()} units  ·  ${Math.round(totals.sf / 1000)}K SF`, col1end - 4, y - umRowH + 3, { sz: 7, f: bold });
      y -= umRowH;
    }
    y -= 6;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CAPITALIZATION + ASSUMPTIONS (two columns)
  // ═══════════════════════════════════════════════════════════════════════════
  const colGap = 10;
  const halfW  = (W - colGap) / 2;
  const colLx  = ML;
  const colRx  = ML + halfW + colGap;
  const rowH   = 12;

  // Build cap rows based on deal type
  const capRows: Array<[string, string, boolean?]> = m.isDevelopment
    ? [
        ["Land Cost",         fc(m.purchasePrice)],
        ["Hard Costs",        fc(m.hardCosts)],
        ["Soft Costs",        fc(m.softCosts)],
        ["Closing / Other",   fc(m.closingCosts)],
        ["Total Cost",        fc(m.totalCost), true],
        ...(m.hasFinancing ? [
          ["Construction Loan", fc(m.acqLoan)],
          ["LTC / Rate",        `${m.acqLtc}% / ${m.acqInterestRate}%`],
          ["Structure",         m.acqIoYears > 0 ? `${m.acqIoYears}yr IO then amort` : `${m.acqAmortYears}yr amort`],
        ] as Array<[string, string]> : [["Financing", "None"]]),
        ["Equity",            fc(m.equity), true],
      ]
    : [
        ["Purchase Price",   fc(m.purchasePrice)],
        ["Closing Costs",    fc(m.closingCosts)],
        ["CapEx / Reno",     fc(m.capexTotal)],
        ["Total Cost",       fc(m.totalCost), true],
        ...(m.hasFinancing ? [
          ["Loan Amount",    fc(m.acqLoan)],
          ["LTC / Rate",     `${m.acqLtc}% / ${m.acqInterestRate}%`],
          ["Amortization",   m.acqAmortYears > 0 ? `${m.acqAmortYears}yr` : "Interest-Only"],
        ] as Array<[string, string]> : [["Financing", "None"]]),
        ["Equity",           fc(m.equity), true],
      ];

  const assRows: Array<[string, string]> = [
    ["Hold Period",    `${m.holdPeriodYears} years`],
    ["Vacancy",        fp(m.vacancyRate)],
    ["Rent Growth",    fp(m.rentGrowthPct) + " / yr"],
    ["Expense Growth", fp(m.expenseGrowthPct) + " / yr"],
    ["Mgmt Fee",       fp(m.managementFeePct)],
    ["Going-in Cap",   m.inPlaceCapRate > 0 ? fp(m.inPlaceCapRate, 2) : "—"],
    ["Pro Forma Cap",  fp(m.proformaCapRate, 2)],
    ["Exit Cap",       m.exitCapRate > 0 ? fp(m.exitCapRate, 2) : "—"],
  ];

  const capStart = y;

  // Left: Cap
  sectionHeader("Capitalization", colLx, y, halfW);
  y -= 13;
  let capY = y;
  capRows.forEach(([label, val, highlight], i) => {
    const bg = highlight ? rgb(0.93, 0.93, 0.97) : i % 2 === 0 ? rowBase : rowAlt;
    rect(colLx, capY - rowH, halfW, rowH, bg);
    const f  = highlight ? bold : reg;
    const vc = highlight ? primary : ink;
    text(label, colLx + 4, capY - rowH + 3.5, { sz: 7.5, f });
    textR(val,  colLx + halfW - 4, capY - rowH + 3.5, { sz: 7.5, f, c: vc });
    capY -= rowH;
  });

  // Right: Assumptions
  y = capStart;
  sectionHeader("Underwriting Assumptions", colRx, y, halfW);
  y -= 13;
  let assY = y;
  assRows.forEach(([label, val], i) => {
    rect(colRx, assY - rowH, halfW, rowH, i % 2 === 0 ? rowBase : rowAlt);
    text(label, colRx + 4, assY - rowH + 3.5, { sz: 7.5 });
    textR(val,  MR - 4,    assY - rowH + 3.5, { sz: 7.5 });
    assY -= rowH;
  });

  y = Math.min(capY, assY) - 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PROFORMA + DCF TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  const dcfYears = m.yearlyDCF.slice(0, 5);
  const showInPlace = !m.isDevelopment;
  const dataCols   = (showInPlace ? 1 : 0) + dcfYears.length;
  const labelW     = 118;
  const dataW      = (W - labelW) / dataCols;

  // Header
  sectionHeader("Proforma & DCF Summary  ($000s)", ML, y, W);
  y -= 13;

  // Sub-header: column labels
  const subHdrH = 11;
  rect(ML, y - subHdrH, W, subHdrH, rgb(0.88, 0.88, 0.92));
  if (showInPlace) textC("In-Place", ML + labelW + dataW * 0.5, y - subHdrH + 2.5, { sz: 6.5, f: bold });
  dcfYears.forEach((yr, i) => {
    const ci = (showInPlace ? 1 : 0) + i;
    textC(`Yr ${yr.year}`, ML + labelW + dataW * (ci + 0.5), y - subHdrH + 2.5, { sz: 6.5, f: bold });
  });
  y -= subHdrH;

  type PRow = { label: string; ip: number; dcf: number[]; style?: "noi" | "cf" | "bold" };
  const tableRows: PRow[] = [
    { label: "Gross Potential Rent",   ip: m.inPlaceGPR,          dcf: dcfYears.map(r => r.gpr) },
    { label: "Vacancy Loss",           ip: -m.inPlaceVacancyLoss, dcf: dcfYears.map(r => -r.vacancyLoss) },
    { label: "Effective Gross Income", ip: m.inPlaceEGI,          dcf: dcfYears.map(r => r.egi) },
    { label: "Operating Expenses",     ip: -m.inPlaceTotalOpEx,   dcf: dcfYears.map(r => -r.totalOpEx) },
    { label: "Net Operating Income",   ip: m.inPlaceNOI,          dcf: dcfYears.map(r => r.noi), style: "noi" },
    { label: "Debt Service",           ip: m.hasFinancing ? -m.inPlaceDebtService : 0, dcf: dcfYears.map(r => m.hasFinancing ? -r.debtService : 0) },
    { label: "Cash Flow",              ip: m.hasFinancing ? m.inPlaceCashFlow : m.inPlaceNOI, dcf: dcfYears.map(r => r.cashFlow), style: "cf" },
  ];
  // Remove DS row if no financing
  const visRows = m.hasFinancing ? tableRows : tableRows.filter(r => r.label !== "Debt Service");

  const tRowH = 12;
  visRows.forEach((row, i) => {
    const isNoi = row.style === "noi";
    const isCf  = row.style === "cf";
    const bg = isCf ? cfBg : isNoi ? noiBg : i % 2 === 0 ? rowBase : rowAlt;
    rect(ML, y - tRowH, W, tRowH, bg);

    const f  = (isNoi || isCf) ? bold : reg;
    const lc = (isNoi || isCf) ? ink  : ink;
    text(row.label, ML + 4, y - tRowH + 3.5, { sz: 7.5, f, c: lc });

    if (showInPlace) {
      const ipStr = fk(row.ip);
      textR(ipStr, ML + labelW + dataW - 4, y - tRowH + 3.5, { sz: 7.5, f });
    }
    row.dcf.forEach((v, ci) => {
      const colIdx = (showInPlace ? 1 : 0) + ci;
      textR(fk(v), ML + labelW + dataW * (colIdx + 1) - 4, y - tRowH + 3.5, { sz: 7.5, f });
    });
    hline(y - tRowH, rgb(0.90, 0.90, 0.92));
    y -= tRowH;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. EXIT SUMMARY STRIP
  // ═══════════════════════════════════════════════════════════════════════════
  y -= 5;
  const exitH = 28;
  rect(ML, y - exitH, W, exitH, darkPanel);

  const exitKpis = [
    { label: "Exit Value",      val: fc(m.exitValue) },
    { label: "Exit Equity",     val: fc(m.exitEquity) },
    { label: "Total CF",        val: fc(m.totalCashFlows) },
    { label: "Equity Multiple", val: fx(m.em) },
    { label: "IRR",             val: m.irr != null ? fp(m.irr, 1) : "—" },
  ];
  const eW = W / exitKpis.length;
  exitKpis.forEach((kpi, i) => {
    const ex = ML + i * eW;
    textC(kpi.label, ex + eW / 2, y - 11, { sz: 6.5, c: rgb(0.60, 0.65, 0.75) });
    textC(kpi.val,   ex + eW / 2, y - 24, { sz: 9, f: bold, c: white });
  });
  y -= exitH;

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER
  // ═══════════════════════════════════════════════════════════════════════════
  y -= 7;
  hline(y, rgb(0.80, 0.80, 0.85), 0.5);
  y -= 9;

  const disclaimer = theme.disclaimerText ||
    "This document is strictly confidential and intended solely for the recipient. Past performance is not indicative of future results. This is not an offer or solicitation.";

  // Wrap disclaimer to 2 lines max
  const maxDW = W - 70;
  let l1 = "", l2 = "";
  for (const w of disclaimer.split(" ")) {
    const t1 = l1 ? l1 + " " + w : w;
    if (reg.widthOfTextAtSize(t1, 6.5) <= maxDW) { l1 = t1; continue; }
    const t2 = l2 ? l2 + " " + w : w;
    if (reg.widthOfTextAtSize(t2, 6.5) <= maxDW) l2 = t2;
  }
  text(l1, ML, y, { sz: 6.5, c: muted });
  textR("Page 1 of 1", MR, y, { sz: 6.5, c: muted });
  if (l2) { y -= 8; text(l2, ML, y, { sz: 6.5, c: muted }); }

  return doc.save();
}
