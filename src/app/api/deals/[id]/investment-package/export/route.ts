import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { brandingQueries } from "@/lib/db";

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
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const { sections, dealName, format = "pptx" } = await req.json() as {
      sections: ExportSection[];
      dealName: string;
      format?: string;
    };

    // Fetch company branding
    let branding: Record<string, unknown> | null = null;
    try {
      branding = await brandingQueries.get();
    } catch { /* use defaults */ }

    const b = branding ?? {};
    const companyName = (b.company_name as string) || "";
    const tagline = (b.tagline as string) || "";
    const headerFont = (b.header_font as string) || "Helvetica";
    const bodyFont = (b.body_font as string) || "Calibri";
    const footerText = (b.footer_text as string) || "CONFIDENTIAL";
    const website = (b.website as string) || "";
    const bEmail = (b.email as string) || "";
    const phone = (b.phone as string) || "";
    const disclaimerText = (b.disclaimer_text as string) || "";

    if (format === "docx") {
      return generateDocx(sections, dealName, branding);
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = companyName || "Deal Intelligence";
    pptx.title = `Investment Package - ${dealName}`;

    // Color theme from branding
    const PRIMARY = ((b.secondary_color as string) || "#2F3B52").replace("#", "");
    const ACCENT = ((b.primary_color as string) || "#4F46E5").replace("#", "");
    const ACCENT2 = ((b.accent_color as string) || "#10B981").replace("#", "");
    const LIGHT_BG = "F8FAFC";
    const TEXT = "1E293B";
    const MUTED = "64748B";

    // --- Cover Slide ---
    const cover = pptx.addSlide();
    cover.background = { color: PRIMARY };
    cover.addText("INVESTMENT PACKAGE", {
      x: 0.8, y: 1.5, w: 11.5, h: 0.6,
      fontSize: 14, color: "94A3B8",
      fontFace: headerFont, bold: false,
      charSpacing: 6,
    });
    cover.addText(dealName, {
      x: 0.8, y: 2.2, w: 11.5, h: 1.2,
      fontSize: 36, color: "FFFFFF",
      fontFace: headerFont, bold: true,
    });
    cover.addText(new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), {
      x: 0.8, y: 3.5, w: 11.5, h: 0.4,
      fontSize: 14, color: "94A3B8",
      fontFace: headerFont,
    });
    cover.addShape(pptx.ShapeType.rect, {
      x: 0.8, y: 3.2, w: 2, h: 0.04, fill: { color: ACCENT },
    });

    // Company branding on cover slide
    if (companyName) {
      cover.addText(companyName, {
        x: 0.8, y: 4.2, w: 11.5, h: 0.5,
        fontSize: 16, color: "FFFFFF",
        fontFace: headerFont, bold: true,
      });
      if (tagline) {
        cover.addText(tagline, {
          x: 0.8, y: 4.7, w: 11.5, h: 0.4,
          fontSize: 11, color: "94A3B8",
          fontFace: bodyFont,
        });
      }
      const contactParts = [website, bEmail, phone].filter(Boolean);
      if (contactParts.length > 0) {
        cover.addText(contactParts.join("  ·  "), {
          x: 0.8, y: 6.8, w: 11.5, h: 0.3,
          fontSize: 9, color: "64748B",
          fontFace: bodyFont,
        });
      }
    }

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
        fontFace: headerFont, bold: true,
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
            { x: 0.8, y: 1.2, w: 11.5, h: 5.5, valign: "top", fontFace: bodyFont }
          );
        }
      } else {
        // Just show the bullet notes
        const bullets = section.notes
          .filter(n => n.text?.trim())
          .map(n => ({ text: "• " + n.text, options: { fontSize: 12, color: TEXT, paraSpaceBefore: 4, breakType: "none" as const } }));
        if (bullets.length > 0) {
          slide.addText(
            bullets.map(blt => ({ text: blt.text + "\n", options: blt.options })),
            { x: 0.8, y: 1.2, w: 11.5, h: 5.5, valign: "top", fontFace: bodyFont }
          );
        }
      }

      // Footer with branding
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.8, y: 6.9, w: 11.5, h: 0.01, fill: { color: ACCENT + "66" },
      });
      slide.addText(footerText, {
        x: 0.8, y: 7.0, w: 5, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
      });
      slide.addText(companyName || dealName, {
        x: 7, y: 7.0, w: 5.5, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
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

// ─── Word Export ──────────────────────────────────────────────────────────────

async function generateDocx(sections: ExportSection[], dealName: string, branding?: Record<string, unknown> | null) {
  const children: Paragraph[] = [];

  const bx = branding ?? {};
  const cName = (bx.company_name as string) || "";
  const cTagline = (bx.tagline as string) || "";
  const cPrimary = ((bx.primary_color as string) || "#4F46E5").replace("#", "");
  const cSecondary = ((bx.secondary_color as string) || "#2F3B52").replace("#", "");
  const cAccent = ((bx.accent_color as string) || "#10B981").replace("#", "");
  const hFont = (bx.header_font as string) || "Helvetica";
  const bFont = (bx.body_font as string) || "Calibri";
  const fText = (bx.footer_text as string) || "CONFIDENTIAL";
  const cWebsite = (bx.website as string) || "";
  const cEmail = (bx.email as string) || "";
  const cPhone = (bx.phone as string) || "";
  const cDisclaimer = (bx.disclaimer_text as string) || "";

  // Branded header
  if (cName) {
    children.push(new Paragraph({ spacing: { before: 200 } }));
    children.push(new Paragraph({
      children: [new TextRun({ text: cName, size: 32, bold: true, color: cSecondary, font: hFont })],
      spacing: { after: 40 },
    }));
    if (cTagline) {
      children.push(new Paragraph({
        children: [new TextRun({ text: cTagline, size: 18, color: cAccent, font: bFont })],
        spacing: { after: 40 },
      }));
    }
    const contacts = [cWebsite, cEmail, cPhone].filter(Boolean);
    if (contacts.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: contacts.join("  ·  "), size: 16, color: "999999", font: bFont })],
        spacing: { after: 80 },
      }));
    }
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: cPrimary } },
      spacing: { after: 400 },
      children: [],
    }));
  } else {
    children.push(new Paragraph({ spacing: { before: 600 } }));
  }

  // Cover page
  children.push(new Paragraph({
    children: [new TextRun({ text: "INVESTMENT PACKAGE", size: 28, color: "6B7280", font: hFont })],
    spacing: { after: 100 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: dealName, size: 56, bold: true, color: cSecondary, font: hFont })],
    spacing: { after: 200 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), size: 24, color: "6B7280", font: bFont })],
    spacing: { after: 200 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: fText, size: 18, color: "9CA3AF", font: bFont })],
    spacing: { after: 400 },
  }));
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: cPrimary } },
    spacing: { after: 600 },
  }));

  // Section pages
  for (const section of sections) {
    const content = section.generatedContent || section.notes?.filter(n => n.text?.trim()).map(n => `• ${n.text}`).join("\n") || "";
    if (!content) continue;

    // Section heading
    children.push(new Paragraph({
      children: [new TextRun({ text: section.title.toUpperCase(), size: 28, bold: true, color: cSecondary, font: hFont })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: cPrimary + "40" } },
    }));

    // Parse markdown content into paragraphs
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        children.push(new Paragraph({ spacing: { before: 100 } }));
        continue;
      }
      if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
        children.push(new Paragraph({
          children: [new TextRun({ text: trimmed.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, ""), size: 24, bold: true, color: cPrimary, font: hFont })],
          spacing: { before: 200, after: 100 },
        }));
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
        children.push(new Paragraph({
          children: [new TextRun({ text: "  • " + trimmed.replace(/^[-*+]\s*/, "").replace(/\*\*/g, ""), size: 22, color: "1E293B" })],
          spacing: { before: 40 },
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: trimmed.replace(/\*\*/g, "").replace(/\*/g, ""), size: 22, color: "1E293B" })],
          spacing: { before: 80 },
        }));
      }
    }
  }

  // Branded footer
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: cPrimary + "66" } },
    spacing: { before: 400 },
    children: [],
  }));
  if (fText || cName) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: fText, size: 16, color: "999999", font: bFont }),
        ...(cName ? [new TextRun({ text: `  —  ${cName}`, size: 16, color: "999999", font: bFont })] : []),
      ],
      spacing: { after: 60 },
    }));
  }
  if (cDisclaimer) {
    children.push(new Paragraph({
      children: [new TextRun({ text: cDisclaimer, size: 14, color: "AAAAAA", font: bFont, italics: true })],
      spacing: { after: 60 },
    }));
  }

  const doc = new Document({
    sections: [{ children }],
    styles: { default: { document: { run: { font: bFont, size: 22 } } } },
  });

  const buffer = await Packer.toBuffer(doc);
  const uint8 = new Uint8Array(buffer);

  return new NextResponse(uint8, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Investment-Package-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.docx"`,
    },
  });
}
