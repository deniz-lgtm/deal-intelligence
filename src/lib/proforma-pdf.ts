import { PDFDocument, StandardFonts, rgb, type RGB } from "pdf-lib";
import type { BrandingTheme } from "@/lib/export-markdown";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProformaDealMeta {
  name: string;
  address: string;
  city: string;
  state: string;
  propertyType: string;
  yearBuilt: number | null;
  units: number | null;
  squareFootage: number | null;
  asOfDate: string; // "MM/DD/YYYY"
}

export interface ProformaMetrics {
  irr: number;            // percentage, e.g. 14.2
  em: number;             // multiplier, e.g. 1.87
  stabilizedCoC: number;  // percentage
  stabilizedDSCR: number; // e.g. 1.35
  yoc: number;            // percentage
  proformaCapRate: number;
  exitCapRate: number;
  inPlaceCapRate: number;
  // Capitalization
  purchasePrice: number;
  closingCosts: number;
  capexTotal: number;
  totalCost: number;
  acqLoan: number;
  acqLtc: number;
  acqInterestRate: number;
  acqAmortYears: number;
  equity: number;
  hasFinancing: boolean;
  // Assumptions
  vacancyRate: number;
  rentGrowthPct: number;
  expenseGrowthPct: number;
  holdPeriodYears: number;
  managementFeePct: number;
  // Proforma columns
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
  // DCF (up to 5 years)
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
  // Exit
  exitValue: number;
  exitEquity: number;
  totalCashFlows: number;
}

// ─── Color helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return rgb(
    isNaN(r) ? 0 : r,
    isNaN(g) ? 0 : g,
    isNaN(b) ? 0 : b,
  );
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const fc = (n: number) =>
  n == null || isNaN(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US");
const fp = (n: number, dec = 2) =>
  n == null || isNaN(n) || n === 0 ? "—" : n.toFixed(dec) + "%";
const fx = (n: number) =>
  n == null || isNaN(n) || n === 0 ? "—" : n.toFixed(2) + "x";

// ─── Main builder ────────────────────────────────────────────────────────────

export async function buildProformaPdf(
  theme: BrandingTheme,
  deal: ProformaDealMeta,
  m: ProformaMetrics,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter portrait

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary   = hexToRgb(theme.primaryColor);
  const secondary = hexToRgb(theme.secondaryColor);
  const white     = rgb(1, 1, 1);
  const black     = rgb(0, 0, 0);
  const light     = rgb(0.93, 0.93, 0.93);
  const mid       = rgb(0.5, 0.5, 0.5);

  const L = 40;          // left margin
  const R = 572;         // right edge (612 - 40)
  const W = R - L;       // content width = 532
  let y = 752;           // current y, starts near top (will decrease)

  // ── Helper: draw a text string, return its width ──────────────────────────
  const drawText = (
    text: string,
    x: number,
    yPos: number,
    { size = 9, font = regular, color = black, maxWidth }: {
      size?: number; font?: typeof regular; color?: RGB; maxWidth?: number;
    } = {},
  ) => {
    let t = text;
    if (maxWidth && font.widthOfTextAtSize(t, size) > maxWidth) {
      while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
        t = t.slice(0, -1);
      }
      t += "…";
    }
    page.drawText(t, { x, y: yPos, size, font, color });
    return font.widthOfTextAtSize(t, size);
  };

  // ── Helper: right-aligned text ────────────────────────────────────────────
  const drawTextR = (
    text: string,
    rightEdge: number,
    yPos: number,
    opts: { size?: number; font?: typeof regular; color?: RGB } = {},
  ) => {
    const { size = 9, font = regular, color = black } = opts;
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: rightEdge - w, y: yPos, size, font, color });
  };

  // ── Helper: horizontal rule ───────────────────────────────────────────────
  const rule = (yPos: number, color: RGB = light, thickness = 0.5) => {
    page.drawLine({ start: { x: L, y: yPos }, end: { x: R, y: yPos }, thickness, color });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Top accent stripe
  // ─────────────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: L, y, width: W, height: 12, color: primary });

  // Confidentiality + company bar
  y -= 12;
  page.drawRectangle({ x: L, y: y - 16, width: W, height: 16, color: secondary });
  const confLeft = `${theme.footerText || "STRICTLY CONFIDENTIAL"}  ·  ${deal.asOfDate}`;
  drawText(confLeft, L + 6, y - 12, { size: 7, font: bold, color: white });
  if (theme.companyName) {
    drawTextR(theme.companyName.toUpperCase(), R - 6, y - 12, { size: 7, font: bold, color: white });
  }
  y -= 16;

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Deal header
  // ─────────────────────────────────────────────────────────────────────────
  y -= 14;
  drawText(deal.name, L, y, { size: 18, font: bold });
  y -= 20;

  const addrParts = [deal.address, deal.city, deal.state].filter(Boolean);
  if (addrParts.length) {
    drawText(addrParts.join(", "), L, y, { size: 9, color: mid });
    y -= 13;
  }

  // Sub-line: type · units/SF · year built · going-in cap
  const subParts: string[] = [];
  if (deal.propertyType) subParts.push(deal.propertyType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
  if (deal.units) subParts.push(`${deal.units.toLocaleString()} units`);
  else if (deal.squareFootage) subParts.push(`${deal.squareFootage.toLocaleString()} SF`);
  if (deal.yearBuilt) subParts.push(`Built ${deal.yearBuilt}`);
  if (m.inPlaceCapRate > 0) subParts.push(`Going-in ${fp(m.inPlaceCapRate, 2)} cap`);
  if (subParts.length) {
    drawText(subParts.join("  ·  "), L, y, { size: 8, color: mid });
    y -= 12;
  }

  y -= 8;
  rule(y);
  y -= 8;

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Returns KPI band (6 tiles)
  // ─────────────────────────────────────────────────────────────────────────
  const kpis: Array<{ label: string; value: string }> = [
    { label: "IRR",           value: m.irr > 0 ? fp(m.irr, 1) : "—" },
    { label: "Equity Multiple", value: fx(m.em) },
    { label: "Stab. CoC",     value: fp(m.stabilizedCoC, 1) },
    { label: "Stab. DSCR",    value: m.stabilizedDSCR > 0 ? `${m.stabilizedDSCR.toFixed(2)}x` : "—" },
    { label: "Yield on Cost", value: fp(m.yoc, 2) },
    { label: "Exit Cap",      value: m.exitCapRate > 0 ? fp(m.exitCapRate, 2) : "—" },
  ];

  const tileW = W / kpis.length;
  const tileH = 42;
  kpis.forEach((kpi, i) => {
    const tx = L + i * tileW;
    const isEven = i % 2 === 0;
    const tileBg = isEven ? rgb(0.97, 0.97, 0.97) : rgb(0.93, 0.93, 0.93);
    page.drawRectangle({ x: tx, y: y - tileH, width: tileW, height: tileH, color: tileBg });
    // label
    const labelW = bold.widthOfTextAtSize(kpi.label, 7);
    page.drawText(kpi.label, { x: tx + (tileW - labelW) / 2, y: y - 14, size: 7, font: regular, color: mid });
    // value
    const valW = bold.widthOfTextAtSize(kpi.value, 14);
    page.drawText(kpi.value, { x: tx + (tileW - valW) / 2, y: y - 32, size: 14, font: bold, color: primary });
  });
  y -= tileH + 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Capitalization | Assumptions two-column
  // ─────────────────────────────────────────────────────────────────────────
  const colGap  = 16;
  const halfW   = (W - colGap) / 2;
  const colLx   = L;
  const colRx   = L + halfW + colGap;
  const colREdge = R;

  // Section header helper
  const sectionHeader = (text: string, x: number, w: number) => {
    page.drawRectangle({ x, y, width: w, height: 14, color: secondary });
    drawText(text.toUpperCase(), x + 5, y + 3, { size: 7, font: bold, color: white });
    y -= 14;
  };

  const rowY0 = y;

  // ── Left: Capitalization ──────────────────────────────────────────────────
  sectionHeader("Capitalization", colLx, halfW);

  const capRows: Array<[string, string]> = [
    ["Purchase Price", fc(m.purchasePrice)],
    ["Closing Costs", fc(m.closingCosts)],
    ["CapEx / Reno", fc(m.capexTotal)],
    ["Total Cost", fc(m.totalCost)],
    ...(m.hasFinancing
      ? ([
          ["Loan Amount", fc(m.acqLoan)],
          ["LTC / Rate", `${m.acqLtc}% / ${m.acqInterestRate}%`],
          ["Amortization", m.acqAmortYears > 0 ? `${m.acqAmortYears}yr` : "Interest-Only"],
        ] as Array<[string, string]>)
      : ([["Financing", "None"]] as Array<[string, string]>)),
    ["Equity", fc(m.equity)],
  ];

  let capY = y;
  capRows.forEach(([label, val], i) => {
    const rowBg = i % 2 === 0 ? white : rgb(0.97, 0.97, 0.97);
    page.drawRectangle({ x: colLx, y: capY - 13, width: halfW, height: 13, color: rowBg });
    const isTotal = label === "Total Cost" || label === "Equity";
    drawText(label, colLx + 5, capY - 10, { size: 8, font: isTotal ? bold : regular });
    drawTextR(val, colLx + halfW - 5, capY - 10, { size: 8, font: isTotal ? bold : regular, color: isTotal ? primary : black });
    capY -= 13;
  });

  // ── Right: Assumptions ────────────────────────────────────────────────────
  y = rowY0;
  sectionHeader("Underwriting Assumptions", colRx, halfW);

  const assRows: Array<[string, string]> = [
    ["Hold Period",       `${m.holdPeriodYears} years`],
    ["Vacancy",           fp(m.vacancyRate, 1)],
    ["Rent Growth",       fp(m.rentGrowthPct, 1) + " / yr"],
    ["Expense Growth",    fp(m.expenseGrowthPct, 1) + " / yr"],
    ["Mgmt Fee",          fp(m.managementFeePct, 1)],
    ["Going-in Cap",      m.inPlaceCapRate > 0 ? fp(m.inPlaceCapRate, 2) : "—"],
    ["Pro Forma Cap",     fp(m.proformaCapRate, 2)],
    ["Exit Cap",          m.exitCapRate > 0 ? fp(m.exitCapRate, 2) : "—"],
  ];

  let assY = y;
  assRows.forEach(([label, val], i) => {
    const rowBg = i % 2 === 0 ? white : rgb(0.97, 0.97, 0.97);
    page.drawRectangle({ x: colRx, y: assY - 13, width: halfW, height: 13, color: rowBg });
    drawText(label, colRx + 5, assY - 10, { size: 8, font: regular });
    drawTextR(val, colREdge - 5, assY - 10, { size: 8, font: regular });
    assY -= 13;
  });

  // Advance y past the taller of the two columns
  const bottomOfCols = Math.min(capY, assY);
  y = bottomOfCols - 10;

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Proforma + DCF table
  // ─────────────────────────────────────────────────────────────────────────
  // Columns: label | In-Place | Yr1 | Yr2 | Yr3 | Yr4 | Yr5
  const dcfYears = m.yearlyDCF.slice(0, 5);
  const numCols  = 2 + dcfYears.length; // label + In-Place + Yr1..Yr5
  const labelColW = 100;
  const dataColW  = (W - labelColW) / (numCols - 1);

  // Table header
  page.drawRectangle({ x: L, y, width: W, height: 14, color: secondary });
  drawText("PROFORMA & DCF SUMMARY", L + 5, y + 3, { size: 7, font: bold, color: white });
  y -= 14;

  // Sub-header row: column labels
  page.drawRectangle({ x: L, y: y - 13, width: W, height: 13, color: light });
  drawText("($000s)", L + 5, y - 10, { size: 7, font: regular, color: mid });
  const colHeaders = ["In-Place", ...dcfYears.map(r => `Yr ${r.year}`)];
  colHeaders.forEach((h, i) => {
    const cx = L + labelColW + i * dataColW + dataColW / 2;
    const hw = bold.widthOfTextAtSize(h, 7);
    page.drawText(h, { x: cx - hw / 2, y: y - 10, size: 7, font: bold });
  });
  y -= 13;

  // Row: GPR | Vac | EGI | OpEx | NOI | DS | CF
  type SimpleRow = { label: string; ip: number; dcf: number[]; isNoi?: boolean; isCf?: boolean };
  const rows: SimpleRow[] = [
    { label: "Gross Potential Rent",   ip: m.inPlaceGPR,          dcf: dcfYears.map(r => r.gpr) },
    { label: "Vacancy Loss",           ip: -m.inPlaceVacancyLoss, dcf: dcfYears.map(r => -r.vacancyLoss) },
    { label: "Effective Gross Income", ip: m.inPlaceEGI,          dcf: dcfYears.map(r => r.egi) },
    { label: "Operating Expenses",     ip: -m.inPlaceTotalOpEx,   dcf: dcfYears.map(r => -r.totalOpEx) },
    { label: "Net Operating Income",   ip: m.inPlaceNOI,          dcf: dcfYears.map(r => r.noi), isNoi: true },
    { label: "Debt Service",           ip: m.hasFinancing ? -m.inPlaceDebtService : 0, dcf: dcfYears.map(r => m.hasFinancing ? -r.debtService : 0) },
    { label: "Cash Flow",              ip: m.hasFinancing ? m.inPlaceCashFlow : m.inPlaceNOI, dcf: dcfYears.map(r => r.cashFlow), isCf: true },
  ];

  const fmtK = (n: number) => {
    if (n == null || isNaN(n)) return "—";
    const k = Math.round(n / 1000);
    return (k < 0 ? "(" + Math.abs(k).toLocaleString() + ")" : k.toLocaleString());
  };

  rows.forEach((row, i) => {
    const isHighlight = row.isNoi || row.isCf;
    const rowBg = isHighlight
      ? (row.isCf ? rgb(0.92, 0.97, 0.93) : rgb(0.94, 0.94, 0.98))
      : i % 2 === 0 ? white : rgb(0.97, 0.97, 0.97);
    page.drawRectangle({ x: L, y: y - 13, width: W, height: 13, color: rowBg });

    const f = isHighlight ? bold : regular;
    const lc = isHighlight ? black : black;
    drawText(row.label, L + 5, y - 10, { size: 7.5, font: f, color: lc });

    // In-place column
    drawTextR(fmtK(row.ip), L + labelColW - 3, y - 10, { size: 7.5, font: f });
    // DCF columns
    row.dcf.forEach((val, ci) => {
      const cx = L + labelColW + ci * dataColW + dataColW - 3;
      drawTextR(fmtK(val), cx, y - 10, { size: 7.5, font: f });
    });
    y -= 13;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Exit summary strip
  // ─────────────────────────────────────────────────────────────────────────
  y -= 6;
  page.drawRectangle({ x: L, y: y - 28, width: W, height: 28, color: rgb(0.18, 0.18, 0.22) });

  const exitKpis = [
    { label: "Exit Value",    val: fc(m.exitValue) },
    { label: "Exit Equity",   val: fc(m.exitEquity) },
    { label: "Total CF",      val: fc(m.totalCashFlows) },
    { label: "Equity Multiple", val: fx(m.em) },
    { label: "IRR",           val: m.irr > 0 ? fp(m.irr, 1) : "—" },
  ];
  const eW = W / exitKpis.length;
  exitKpis.forEach((kpi, i) => {
    const ex = L + i * eW;
    const lw = regular.widthOfTextAtSize(kpi.label, 6.5);
    page.drawText(kpi.label, { x: ex + (eW - lw) / 2, y: y - 12, size: 6.5, font: regular, color: rgb(0.7, 0.7, 0.7) });
    const vw = bold.widthOfTextAtSize(kpi.val, 9);
    page.drawText(kpi.val, { x: ex + (eW - vw) / 2, y: y - 24, size: 9, font: bold, color: white });
  });
  y -= 28;

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Footer
  // ─────────────────────────────────────────────────────────────────────────
  y -= 8;
  rule(y, light);
  y -= 10;

  const disclaimer = theme.disclaimerText ||
    "This document is strictly confidential and intended solely for the recipient. Past performance is not indicative of future results. This is not an offer or solicitation.";
  // Wrap disclaimer across up to 2 lines
  const maxLineW = W - 80;
  let line1 = "", line2 = "";
  const words = disclaimer.split(" ");
  for (const w of words) {
    const test = line1 ? line1 + " " + w : w;
    if (regular.widthOfTextAtSize(test, 6.5) <= maxLineW) {
      line1 = test;
    } else if (!line2) {
      line2 = w;
    } else {
      const test2 = line2 + " " + w;
      if (regular.widthOfTextAtSize(test2, 6.5) <= maxLineW) line2 = test2;
    }
  }
  drawText(line1, L, y, { size: 6.5, color: mid });
  if (line2) {
    y -= 9;
    drawText(line2, L, y, { size: 6.5, color: mid });
  }
  // Page mark
  drawTextR("Page 1 of 1", R, y, { size: 6.5, color: mid });

  return doc.save();
}
