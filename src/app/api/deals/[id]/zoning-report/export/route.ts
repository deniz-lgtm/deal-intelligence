import { NextRequest, NextResponse } from "next/server";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
  ShadingType,
} from "docx";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal } from "@/lib/db";
import {
  resolveBranding,
  inlineToDocxRuns,
  markdownToDocx,
} from "@/lib/export-markdown";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { dealName, siteInfo, zoningInfo, devParams, narrative } = body as {
      dealName: string;
      siteInfo: AnyRec;
      zoningInfo: AnyRec;
      devParams: AnyRec;
      narrative: string;
    };

    let branding: Record<string, unknown> | null = null;
    try { branding = await getBrandingForDeal(params.id); } catch { /* use defaults */ }

    // Business-plan branding — colors, fonts, confidentiality, disclaimer
    // all come from here. One source of truth across every export route.
    const theme = resolveBranding(branding);
    const hFont = theme.headerFont;
    const bFont = theme.bodyFont;

    const children: Array<Paragraph | Table> = [];

    // ── Branded cover ───────────────────────────────────────────────────
    if (theme.companyName) {
      children.push(new Paragraph({
        children: [new TextRun({ text: theme.companyName, size: 32, bold: true, color: theme.secondaryColor, font: hFont })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
      }));
      if (theme.tagline) {
        children.push(new Paragraph({
          children: [new TextRun({ text: theme.tagline, size: 18, color: theme.accentColor, font: bFont })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
        }));
      }
      const contacts = [theme.website, theme.email, theme.phone].filter(Boolean);
      if (contacts.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: contacts.join("  ·  "), size: 16, color: "999999", font: bFont })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        }));
      }
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: theme.primaryColor } },
        spacing: { after: 200 },
      }));
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: "STRICTLY CONFIDENTIAL", size: 18, bold: true, color: "C2410C", font: hFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: "Zoning & Site Report", size: 36, bold: true, color: theme.secondaryColor, font: hFont })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: dealName, size: 26, bold: true, color: theme.primaryColor, font: hFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `Prepared: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, size: 20, color: "666666", font: bFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
    }));

    // ── Site Information ────────────────────────────────────────────────
    children.push(sectionHeading("Site Information", theme));

    const siteRows: Array<[string, string]> = [
      ["Land Area", `${siteInfo?.land_acres || 0} AC / ${Math.round(siteInfo?.land_sf || 0).toLocaleString()} SF`],
      ["Parcel ID", siteInfo?.parcel_id || "—"],
      ["Flood Zone", siteInfo?.flood_zone || "—"],
      ["Current Improvements", siteInfo?.current_improvements || "—"],
      ["Topography", siteInfo?.topography || "—"],
      ["Utilities", siteInfo?.utilities || "—"],
      ["Environmental", siteInfo?.environmental_notes || "—"],
      ["Soil Conditions", siteInfo?.soil_conditions || "—"],
    ];
    const siteRowsFiltered = siteRows.filter(([, v]) => v !== "—");
    if (siteRowsFiltered.length > 0) {
      children.push(kvTable(siteRowsFiltered, theme));
    }

    // ── Zoning Information ──────────────────────────────────────────────
    children.push(sectionHeading("Zoning Information", theme));

    const zoningRows: Array<[string, string]> = [
      ["Zoning Designation", zoningInfo?.zoning_designation || "—"],
      ["FAR", zoningInfo?.far != null ? String(zoningInfo.far) : "—"],
      ["Lot Coverage", zoningInfo?.lot_coverage_pct != null ? `${zoningInfo.lot_coverage_pct}%` : "—"],
      ["Overlays", zoningInfo?.overlays?.length > 0 ? zoningInfo.overlays.join(", ") : "None"],
      ["Permitted Uses", zoningInfo?.permitted_uses?.length > 0 ? zoningInfo.permitted_uses.join(", ") : "—"],
      ["Parking Requirements", zoningInfo?.parking_requirements || "—"],
      ["Open Space", zoningInfo?.open_space_requirements || "—"],
    ];
    children.push(kvTable(zoningRows, theme));

    // Setbacks
    if (zoningInfo?.setbacks?.length > 0) {
      children.push(subHeading("Setbacks", theme));
      const rows: Array<[string, string]> = zoningInfo.setbacks
        .filter((s: AnyRec) => s.feet != null)
        .map((s: AnyRec) => [s.label as string, `${s.feet} ft`]);
      if (rows.length > 0) children.push(kvTable(rows, theme));
    }

    // Height Limits
    if (zoningInfo?.height_limits?.length > 0) {
      children.push(subHeading("Height Limits", theme));
      zoningInfo.height_limits.forEach((h: AnyRec) => {
        let rendered: string = h.value || "";
        const hasStructured =
          (typeof h.feet === "number" && h.feet !== null) ||
          (typeof h.stories === "number" && h.stories !== null);
        if (hasStructured) {
          const parts: string[] = [];
          if (h.stories != null) parts.push(`${h.stories} stories`);
          if (h.feet != null) parts.push(`${h.feet} ft`);
          rendered = parts.join(` ${h.connector || "and"} `);
        }
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${h.label || ""}: `, bold: true, size: 20, color: theme.secondaryColor, font: bFont }),
            ...inlineToDocxRuns(rendered, { size: 20, color: "1E293B", font: bFont }),
          ],
          spacing: { after: 60 },
        }));
      });
    }

    // Density Bonuses
    const activeBonuses = (zoningInfo?.density_bonuses || []).filter((b: AnyRec) => b?.enabled !== false);
    if (activeBonuses.length > 0) {
      children.push(subHeading("Density Bonuses & Incentives", theme));
      activeBonuses.forEach((b: AnyRec) => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${b.source}: `, bold: true, size: 20, color: theme.secondaryColor, font: bFont }),
            ...inlineToDocxRuns(`${b.description} (${b.additional_density})`, { size: 20, color: "1E293B", font: bFont }),
          ],
          spacing: { after: 60 },
        }));
      });
    }

    // Future Legislation
    if (zoningInfo?.future_legislation?.length > 0) {
      children.push(subHeading("Future Legislation & Plan Changes", theme));
      zoningInfo.future_legislation.forEach((f: AnyRec) => {
        const header = f.effective_date ? `${f.source} (${f.effective_date}): ` : `${f.source}: `;
        const body = [f.description, f.impact].filter(Boolean).join(" — ");
        children.push(new Paragraph({
          children: [
            new TextRun({ text: header, bold: true, size: 20, color: theme.secondaryColor, font: bFont }),
            ...inlineToDocxRuns(body, { size: 20, color: "1E293B", font: bFont }),
          ],
          spacing: { after: 60 },
        }));
      });
    }

    if (zoningInfo?.source_url) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "Source: ", bold: true, size: 18, color: theme.secondaryColor, font: bFont }),
          new TextRun({ text: zoningInfo.source_url, size: 18, color: "1F6FEB", font: bFont }),
        ],
        spacing: { before: 120, after: 120 },
      }));
    }

    // ── Development Parameters ──────────────────────────────────────────
    if (devParams?.max_gsf > 0) {
      children.push(sectionHeading("Development Parameters", theme));
      const devRows: Array<[string, string]> = [
        ["Max GSF", Math.round(devParams.max_gsf).toLocaleString() + " SF"],
        ["Efficiency", `${devParams.efficiency_pct}%`],
        ["Max NRSF", Math.round(devParams.max_nrsf).toLocaleString() + " SF"],
      ];
      children.push(kvTable(devRows, theme));
    }

    // ── AI Narrative ────────────────────────────────────────────────────
    if (narrative) {
      children.push(sectionHeading("AI Zoning Analysis", theme));
      // Route the AI-generated markdown through the shared renderer —
      // bold / italic / code, H1/H2/H3, numbered lists, bullets,
      // markdown tables, and blockquotes all render correctly and
      // consistently with the DD Abstract and Investment Package.
      const narrativeBody = markdownToDocx(narrative, theme, { bodySize: 20, bodyColor: "1E293B" });
      for (const c of narrativeBody) children.push(c);
    }

    // ── Branded footer ──────────────────────────────────────────────────
    children.push(new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: theme.primaryColor + "66" } },
      spacing: { before: 400 },
    }));
    if (theme.footerText || theme.companyName) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: theme.footerText, size: 16, color: "999999", font: bFont }),
          ...(theme.companyName ? [new TextRun({ text: `  —  ${theme.companyName}`, size: 16, color: "999999", font: bFont })] : []),
        ],
        spacing: { after: 60 },
      }));
    }
    if (theme.disclaimerText) {
      children.push(new Paragraph({
        children: [new TextRun({ text: theme.disclaimerText, size: 14, color: "AAAAAA", font: bFont, italics: true })],
        spacing: { after: 60 },
      }));
    }

    // Minimum viable Document config — no numbering registration and no
    // custom paragraphStyles. Both have been triggers for Packer.toBuffer()
    // crashes on certain docx@9.x patch versions.
    const doc = new Document({
      styles: {
        default: { document: { run: { font: bFont, size: 20 } } },
      },
      sections: [{ children }],
    });

    const buffer = await Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);
    const filename = `Zoning-Report-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.docx`;

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": uint8.length.toString(),
      },
    });
  } catch (error) {
    console.error("Zoning export error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Export failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}

// ─── Section helpers ────────────────────────────────────────────────────────

function sectionHeading(
  text: string,
  theme: ReturnType<typeof resolveBranding>
): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 26, color: theme.primaryColor, font: theme.headerFont })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: theme.primaryColor + "40" } },
  });
}

function subHeading(
  text: string,
  theme: ReturnType<typeof resolveBranding>
): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: theme.accentColor, font: theme.headerFont })],
    spacing: { before: 200, after: 100 },
  });
}

// Two-column key/value table. Value cells route through inlineToDocxRuns so
// any markdown emphasis inside a value (e.g. "**yes**, per §12-3") renders
// as real bold instead of literal asterisks leaking through.
function kvTable(
  rows: Array<[string, string]>,
  theme: ReturnType<typeof resolveBranding>
): Table {
  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" };
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  const bFont = theme.bodyFont;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value], idx) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: label, bold: true, size: 20, color: theme.secondaryColor, font: bFont })],
              spacing: { before: 40, after: 40 },
            })],
            width: { size: 30, type: WidthType.PERCENTAGE },
            borders: cellBorders,
            shading: idx % 2 === 0
              ? { type: ShadingType.SOLID, color: "F8FAFC" }
              : undefined,
          }),
          new TableCell({
            children: [new Paragraph({
              children: inlineToDocxRuns(value, { size: 20, color: "1E293B", font: bFont }),
              spacing: { before: 40, after: 40 },
            })],
            width: { size: 70, type: WidthType.PERCENTAGE },
            borders: cellBorders,
          }),
        ],
      })
    ),
  });
}
