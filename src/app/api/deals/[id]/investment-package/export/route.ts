import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";

interface ExportSection {
  id: string;
  title: string;
  notes: Array<{ text: string }>;
  generatedContent?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { sections, dealName } = await req.json() as {
      sections: ExportSection[];
      dealName: string;
    };

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Deal Intelligence";
    pptx.title = `Investment Package - ${dealName}`;

    // Color theme
    const PRIMARY = "2F3B52";
    const ACCENT = "4F46E5";
    const LIGHT_BG = "F8FAFC";
    const TEXT = "1E293B";
    const MUTED = "64748B";

    // --- Cover Slide ---
    const cover = pptx.addSlide();
    cover.background = { color: PRIMARY };
    cover.addText("INVESTMENT PACKAGE", {
      x: 0.8, y: 1.5, w: 11.5, h: 0.6,
      fontSize: 14, color: "94A3B8",
      fontFace: "Helvetica", bold: false,
      charSpacing: 6,
    });
    cover.addText(dealName, {
      x: 0.8, y: 2.2, w: 11.5, h: 1.2,
      fontSize: 36, color: "FFFFFF",
      fontFace: "Helvetica", bold: true,
    });
    cover.addText(new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), {
      x: 0.8, y: 3.5, w: 11.5, h: 0.4,
      fontSize: 14, color: "94A3B8",
      fontFace: "Helvetica",
    });
    cover.addShape(pptx.ShapeType.rect, {
      x: 0.8, y: 3.2, w: 2, h: 0.04, fill: { color: ACCENT },
    });

    // --- Content Slides ---
    for (const section of sections) {
      if (!section.generatedContent && section.notes.filter(n => n.text?.trim()).length === 0) continue;

      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      // Header bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: PRIMARY },
      });
      slide.addText(section.title.toUpperCase(), {
        x: 0.8, y: 0.15, w: 11.5, h: 0.6,
        fontSize: 18, color: "FFFFFF",
        fontFace: "Helvetica", bold: true,
        charSpacing: 2,
      });

      if (section.generatedContent) {
        // Parse markdown into slide-friendly text
        const lines = section.generatedContent.split("\n").filter(l => l.trim());
        const textContent: Array<{ text: string; options: Record<string, unknown> }> = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("###") || trimmed.startsWith("##")) {
            textContent.push({
              text: trimmed.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, ""),
              options: { fontSize: 13, color: ACCENT, bold: true, paraSpaceBefore: 8, breakType: "none" as const },
            });
          } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
            textContent.push({
              text: "  " + trimmed.replace(/^[-*+]\s*/, "• ").replace(/\*\*/g, ""),
              options: { fontSize: 11, color: TEXT, paraSpaceBefore: 2, breakType: "none" as const },
            });
          } else if (trimmed.match(/^\d+\.\s/)) {
            textContent.push({
              text: "  " + trimmed.replace(/\*\*/g, ""),
              options: { fontSize: 11, color: TEXT, paraSpaceBefore: 2, breakType: "none" as const },
            });
          } else if (trimmed.startsWith("|")) {
            // Skip markdown tables — too complex for simple PPTX
            continue;
          } else {
            textContent.push({
              text: trimmed.replace(/\*\*/g, "").replace(/\*/g, ""),
              options: { fontSize: 11, color: TEXT, paraSpaceBefore: 4, breakType: "none" as const },
            });
          }
        }

        if (textContent.length > 0) {
          slide.addText(
            textContent.map(tc => ({ text: tc.text + "\n", options: tc.options })),
            { x: 0.8, y: 1.2, w: 11.5, h: 5.8, valign: "top", fontFace: "Helvetica" }
          );
        }
      } else {
        // Just show the bullet notes
        const bullets = section.notes
          .filter(n => n.text?.trim())
          .map(n => ({ text: "• " + n.text, options: { fontSize: 12, color: TEXT, paraSpaceBefore: 4, breakType: "none" as const } }));
        if (bullets.length > 0) {
          slide.addText(
            bullets.map(b => ({ text: b.text + "\n", options: b.options })),
            { x: 0.8, y: 1.2, w: 11.5, h: 5.8, valign: "top", fontFace: "Helvetica" }
          );
        }
      }

      // Footer
      slide.addText("CONFIDENTIAL", {
        x: 0.8, y: 7.0, w: 5, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: "Helvetica",
      });
      slide.addText(dealName, {
        x: 7, y: 7.0, w: 5.5, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: "Helvetica",
        align: "right",
      });
    }

    const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
    const uint8 = new Uint8Array(buffer);

    return new NextResponse(uint8, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="Investment-Package-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.pptx"`,
      },
    });
  } catch (error) {
    console.error("Export PPTX error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
