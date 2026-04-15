import { NextRequest, NextResponse } from "next/server";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
} from "docx";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal } from "@/lib/db";

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
    const { dealName, siteInfo, zoningInfo, devParams, narrative } = body;

    let branding: Record<string, unknown> | null = null;
    try { branding = await getBrandingForDeal(params.id); } catch {}

    const docFont = (branding?.body_font as string) || "Calibri";
    const children: any[] = [];

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: `Zoning & Site Report — ${dealName}`, bold: true, size: 32, font: docFont })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    }));

    children.push(new Paragraph({
      children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString()}`, size: 18, color: "888888", font: docFont })],
      spacing: { after: 300 },
    }));

    // Site Information
    children.push(new Paragraph({
      children: [new TextRun({ text: "Site Information", bold: true, size: 26, font: docFont })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
    }));

    const siteRows = [
      ["Land Area", `${siteInfo?.land_acres || 0} AC / ${Math.round(siteInfo?.land_sf || 0).toLocaleString()} SF`],
      ["Parcel ID", siteInfo?.parcel_id || "—"],
      ["Flood Zone", siteInfo?.flood_zone || "—"],
      ["Current Improvements", siteInfo?.current_improvements || "—"],
      ["Topography", siteInfo?.topography || "—"],
      ["Utilities", siteInfo?.utilities || "—"],
      ["Environmental", siteInfo?.environmental_notes || "—"],
      ["Soil Conditions", siteInfo?.soil_conditions || "—"],
    ].filter(([_, v]) => v !== "—");

    if (siteRows.length > 0) {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: siteRows.map(([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: docFont })] })],
                width: { size: 30, type: WidthType.PERCENTAGE },
                borders: thinBorders(),
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: docFont })] })],
                width: { size: 70, type: WidthType.PERCENTAGE },
                borders: thinBorders(),
              }),
            ],
          })
        ),
      }));
    }

    // Zoning Information
    children.push(new Paragraph({
      children: [new TextRun({ text: "Zoning Information", bold: true, size: 26, font: docFont })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
    }));

    const zoningRows = [
      ["Zoning Designation", zoningInfo?.zoning_designation || "—"],
      ["FAR", zoningInfo?.far != null ? String(zoningInfo.far) : "—"],
      ["Lot Coverage", zoningInfo?.lot_coverage_pct != null ? `${zoningInfo.lot_coverage_pct}%` : "—"],
      ["Overlays", zoningInfo?.overlays?.length > 0 ? zoningInfo.overlays.join(", ") : "None"],
      ["Permitted Uses", zoningInfo?.permitted_uses?.length > 0 ? zoningInfo.permitted_uses.join(", ") : "—"],
      ["Parking Requirements", zoningInfo?.parking_requirements || "—"],
      ["Open Space", zoningInfo?.open_space_requirements || "—"],
    ];

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: zoningRows.map(([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: docFont })] })],
              width: { size: 30, type: WidthType.PERCENTAGE },
              borders: thinBorders(),
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: docFont })] })],
              width: { size: 70, type: WidthType.PERCENTAGE },
              borders: thinBorders(),
            }),
          ],
        })
      ),
    }));

    // Setbacks
    if (zoningInfo?.setbacks?.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Setbacks", bold: true, size: 22, font: docFont })],
        spacing: { before: 200, after: 100 },
      }));

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: zoningInfo.setbacks
          .filter((s: any) => s.feet != null)
          .map((s: any) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: s.label, bold: true, size: 20, font: docFont })] })],
                  borders: thinBorders(),
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: `${s.feet} ft`, size: 20, font: docFont })] })],
                  borders: thinBorders(),
                }),
              ],
            })
          ),
      }));
    }

    // Height Limits — support both the legacy `value` string and the newer
    // structured shape ({ feet, stories, connector }).
    if (zoningInfo?.height_limits?.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Height Limits", bold: true, size: 22, font: docFont })],
        spacing: { before: 200, after: 100 },
      }));

      zoningInfo.height_limits.forEach((h: any) => {
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
            new TextRun({ text: `${h.label || ""}: `, bold: true, size: 20, font: docFont }),
            new TextRun({ text: rendered, size: 20, font: docFont }),
          ],
        }));
      });
    }

    // Density Bonuses — only export ENABLED bonuses. Rows where the analyst
    // has toggled `enabled: false` are intentionally excluded from the
    // report (they were considered and ruled out).
    const activeBonuses = (zoningInfo?.density_bonuses || []).filter(
      (b: any) => b?.enabled !== false
    );
    if (activeBonuses.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Density Bonuses & Incentives", bold: true, size: 22, font: docFont })],
        spacing: { before: 200, after: 100 },
      }));

      activeBonuses.forEach((b: any) => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${b.source}: `, bold: true, size: 20, font: docFont }),
            new TextRun({ text: `${b.description} (${b.additional_density})`, size: 20, font: docFont }),
          ],
          spacing: { after: 80 },
        }));
      });
    }

    // Future Legislation & Plan Changes
    if (zoningInfo?.future_legislation?.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Future Legislation & Plan Changes", bold: true, size: 22, font: docFont })],
        spacing: { before: 200, after: 100 },
      }));

      zoningInfo.future_legislation.forEach((f: any) => {
        const header = f.effective_date
          ? `${f.source} (${f.effective_date}): `
          : `${f.source}: `;
        const body = [f.description, f.impact].filter(Boolean).join(" — ");
        children.push(new Paragraph({
          children: [
            new TextRun({ text: header, bold: true, size: 20, font: docFont }),
            new TextRun({ text: body, size: 20, font: docFont }),
          ],
          spacing: { after: 80 },
        }));
      });
    }

    // Jurisdiction source link — appears under Zoning Information for
    // traceability back to the actual code source.
    if (zoningInfo?.source_url) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "Source: ", bold: true, size: 18, font: docFont }),
          new TextRun({ text: zoningInfo.source_url, size: 18, color: "1F6FEB", font: docFont }),
        ],
        spacing: { before: 120, after: 120 },
      }));
    }

    // Development Parameters
    if (devParams?.max_gsf > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Development Parameters", bold: true, size: 26, font: docFont })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      }));

      const devRows = [
        ["Max GSF", Math.round(devParams.max_gsf).toLocaleString() + " SF"],
        ["Efficiency", `${devParams.efficiency_pct}%`],
        ["Max NRSF", Math.round(devParams.max_nrsf).toLocaleString() + " SF"],
      ];

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: devRows.map(([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: docFont })] })],
                borders: thinBorders(),
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: docFont })] })],
                borders: thinBorders(),
              }),
            ],
          })
        ),
      }));
    }

    // AI Narrative
    if (narrative) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "AI Zoning Analysis", bold: true, size: 26, font: docFont })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      }));

      narrative.split("\n").forEach((line: string) => {
        if (!line.trim()) {
          children.push(new Paragraph({ spacing: { after: 100 } }));
        } else if (line.startsWith("##")) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line.replace(/^#+\s*/, ""), bold: true, size: 22, font: docFont })],
            spacing: { before: 200, after: 100 },
          }));
        } else {
          children.push(new Paragraph({
            children: [new TextRun({ text: line, size: 20, font: docFont })],
            spacing: { after: 60 },
          }));
        }
      });
    }

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: docFont, size: 20 } },
        },
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
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

function thinBorders() {
  const b = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  return { top: b, bottom: b, left: b, right: b };
}
