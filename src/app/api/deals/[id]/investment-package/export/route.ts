import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle, Table } from "docx";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal } from "@/lib/db";
import {
  resolveBranding,
  markdownToPptxBlocks,
  markdownToDocx,
  DOCX_NUMBERING,
} from "@/lib/export-markdown";

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

    // Fetch branding from deal's business plan
    let branding: Record<string, unknown> | null = null;
    try {
      branding = await getBrandingForDeal(params.id);
    } catch { /* use defaults */ }

    // Resolve branding from the deal's business plan — colors, fonts,
    // confidentiality text, contact info. resolveBranding() supplies
    // institutional defaults for anything the BP hasn't set yet.
    const theme = resolveBranding(branding);
    const companyName = theme.companyName;
    const tagline = theme.tagline;
    const headerFont = theme.headerFont;
    const bodyFont = theme.bodyFont;
    const footerText = theme.footerText;
    const website = theme.website;
    const bEmail = theme.email;
    const phone = theme.phone;

    if (format === "docx") {
      return generateDocx(sections, dealName, branding);
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = companyName || "Deal Intelligence";
    pptx.title = `Investment Package - ${dealName}`;

    // Color theme — PRIMARY is the darker (secondary) color used for the
    // header bars / cover background; ACCENT is the brand primary used for
    // rule lines and the section-number badge.
    const PRIMARY = theme.secondaryColor;
    const ACCENT = theme.primaryColor;
    const TEXT = "1E293B";
    const MUTED = "64748B";

    // Pre-compute the list of sections with meaningful content so the TOC
    // and page numbers line up with what actually renders.
    const renderableSections = sections.filter(
      (s) => s.generatedContent || s.notes.filter(n => n.text?.trim()).length > 0
    );

    // --- Cover Slide ---
    const cover = pptx.addSlide();
    cover.background = { color: PRIMARY };

    // Confidentiality strip (top-left, institutional convention)
    cover.addText("STRICTLY CONFIDENTIAL", {
      x: 0.8, y: 0.5, w: 5, h: 0.3,
      fontSize: 10, color: "FF7A7A",
      fontFace: headerFont, bold: true,
      charSpacing: 8,
    });

    cover.addText("INVESTMENT COMMITTEE MATERIALS", {
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
    cover.addShape(pptx.ShapeType.rect, {
      x: 0.8, y: 3.2, w: 2, h: 0.04, fill: { color: ACCENT },
    });
    cover.addText(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), {
      x: 0.8, y: 3.5, w: 11.5, h: 0.4,
      fontSize: 14, color: "94A3B8",
      fontFace: headerFont,
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

    // --- Table of Contents ---
    if (renderableSections.length > 1) {
      const toc = pptx.addSlide();
      toc.background = { color: "FFFFFF" };
      toc.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: PRIMARY },
      });
      toc.addText("TABLE OF CONTENTS", {
        x: 0.8, y: 0.15, w: 11.5, h: 0.6,
        fontSize: 18, color: "FFFFFF",
        fontFace: headerFont, bold: true,
        charSpacing: 2,
      });
      const tocEntries = renderableSections.map((s, i) => ({
        text: `${String(i + 1).padStart(2, "0")}    ${s.title}\n`,
        options: { fontSize: 14, color: TEXT, paraSpaceBefore: 10, breakType: "none" as const },
      }));
      toc.addText(
        tocEntries,
        { x: 1.2, y: 1.4, w: 10.5, h: 5.5, valign: "top", fontFace: bodyFont }
      );
      toc.addShape(pptx.ShapeType.rect, {
        x: 0.8, y: 6.9, w: 11.5, h: 0.01, fill: { color: ACCENT + "66" },
      });
      toc.addText(footerText, {
        x: 0.8, y: 7.0, w: 5, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
      });
      toc.addText(companyName || dealName, {
        x: 7, y: 7.0, w: 5.5, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
        align: "right",
      });
    }

    // --- Content Slides ---
    let slideIdx = 0;
    for (const section of sections) {
      if (!section.generatedContent && section.notes.filter(n => n.text?.trim()).length === 0) continue;
      slideIdx += 1;

      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      // Header bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: PRIMARY },
      });
      // Section number badge (e.g. "01", "02") — institutional deck convention
      slide.addText(String(slideIdx).padStart(2, "0"), {
        x: 0.8, y: 0.15, w: 0.8, h: 0.6,
        fontSize: 22, color: ACCENT,
        fontFace: headerFont, bold: true,
      });
      slide.addText(section.title.toUpperCase(), {
        x: 1.7, y: 0.15, w: 10.6, h: 0.6,
        fontSize: 18, color: "FFFFFF",
        fontFace: headerFont, bold: true,
        charSpacing: 2,
      });

      // Render body content — either the AI-generated markdown, or bullet
      // notes if no AI content yet. All inline **bold**, *italic*, `code`,
      // markdown tables, blockquotes, numbered lists, and nested bullets
      // flow through the shared parser, so what renders on the slide is
      // semantically the same as what renders in the Word export.
      const contentMd = section.generatedContent
        ? section.generatedContent
        : section.notes.filter(n => n.text?.trim()).map(n => `- ${n.text}`).join("\n");

      if (contentMd) {
        const blocks = markdownToPptxBlocks(contentMd, theme, TEXT, ACCENT, MUTED);
        // Flatten blocks into a single run array. PptxGenJS renders each
        // entry as a run, and a run whose `text` ends with "\n" starts a
        // new paragraph. This preserves inline formatting (bold / italic
        // / code) within a paragraph.
        const runs: Array<{ text: string; options: Record<string, unknown> }> = [];
        for (const blk of blocks) {
          if (Array.isArray(blk.text)) {
            blk.text.forEach((r, i, arr) => {
              const isLast = i === arr.length - 1;
              runs.push({
                text: r.text + (isLast ? "\n" : ""),
                options: { ...blk.options, ...r.options },
              });
            });
          } else {
            runs.push({ text: String(blk.text) + "\n", options: blk.options });
          }
        }
        if (runs.length > 0) {
          slide.addText(
            runs as unknown as Parameters<typeof slide.addText>[0],
            {
              x: 0.8, y: 1.2, w: 11.5, h: 5.5,
              valign: "top",
              fontFace: bodyFont,
              // Auto-shrink so long AI-generated sections fit the slide
              // instead of silently clipping off the bottom — the #1 PPTX
              // formatting defect users reported.
              autoFit: true,
              shrinkText: true,
              fit: "shrink",
            } as unknown as Parameters<typeof slide.addText>[1]
          );
        }
      }

      // Footer with branding + page number
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.8, y: 6.9, w: 11.5, h: 0.01, fill: { color: ACCENT + "66" },
      });
      slide.addText(footerText, {
        x: 0.8, y: 7.0, w: 4, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
      });
      slide.addText(companyName || dealName, {
        x: 4.8, y: 7.0, w: 4, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
        align: "center",
      });
      slide.addText(`${slideIdx} / ${renderableSections.length}`, {
        x: 10.5, y: 7.0, w: 1.8, h: 0.3,
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
  // Section children can be either Paragraphs or Tables — the shared
  // markdown renderer emits both for properly-formatted markdown tables.
  const children: Array<Paragraph | Table> = [];

  // All branding (colors, fonts, confidentiality, disclaimers) comes from
  // the deal's business plan via getBrandingForDeal().
  const theme = resolveBranding(branding);
  const cName = theme.companyName;
  const cTagline = theme.tagline;
  const cPrimary = theme.primaryColor;
  const cSecondary = theme.secondaryColor;
  const cAccent = theme.accentColor;
  const hFont = theme.headerFont;
  const bFont = theme.bodyFont;
  const fText = theme.footerText;
  const cWebsite = theme.website;
  const cEmail = theme.email;
  const cPhone = theme.phone;
  const cDisclaimer = theme.disclaimerText;

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
    children: [new TextRun({ text: "STRICTLY CONFIDENTIAL", size: 18, color: "C2410C", bold: true, font: hFont })],
    spacing: { after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "INVESTMENT COMMITTEE MATERIALS", size: 28, color: "6B7280", font: hFont })],
    spacing: { after: 100 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: dealName, size: 56, bold: true, color: cSecondary, font: hFont })],
    spacing: { after: 200 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), size: 24, color: "6B7280", font: bFont })],
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

  // Table of contents — institutional memos always paginate this
  const renderable = sections.filter(
    (s) => (s.generatedContent || s.notes?.filter(n => n.text?.trim()).length)
  );
  if (renderable.length > 1) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "TABLE OF CONTENTS", size: 24, bold: true, color: cSecondary, font: hFont })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: cPrimary + "40" } },
    }));
    renderable.forEach((s, i) => {
      const num = String(i + 1).padStart(2, "0");
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${num}   `, size: 22, bold: true, color: cPrimary, font: hFont }),
          new TextRun({ text: s.title, size: 22, color: "1E293B", font: bFont }),
        ],
        spacing: { after: 80 },
      }));
    });
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" } },
      spacing: { before: 200, after: 400 },
    }));
  }

  // Section pages
  let sectionIdx = 0;
  for (const section of sections) {
    const content = section.generatedContent || section.notes?.filter(n => n.text?.trim()).map(n => `• ${n.text}`).join("\n") || "";
    if (!content) continue;
    sectionIdx += 1;

    // Section heading — numbered (01, 02, ...) so readers can cross-reference
    // back to the table of contents.
    const sectionNum = String(sectionIdx).padStart(2, "0");
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${sectionNum}   `, size: 28, bold: true, color: cPrimary, font: hFont }),
        new TextRun({ text: section.title.toUpperCase(), size: 28, bold: true, color: cSecondary, font: hFont }),
      ],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: cPrimary + "40" } },
    }));

    // Render the body markdown through the shared parser — preserves
    // inline **bold** / *italic* / `code`, markdown tables, blockquotes,
    // horizontal rules, nested bullets, and real Word numbering for
    // ordered lists. This replaces the old regex-stripping loop that
    // dropped emphasis and tables.
    const bodyChildren = markdownToDocx(content, theme, { bodySize: 22, bodyColor: "1E293B" });
    for (const c of bodyChildren) children.push(c);
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
    // Register the numbering reference the shared markdown renderer uses
    // for ordered lists — without this, `1. foo` lines render as literal
    // text instead of real Word auto-numbered lists.
    numbering: DOCX_NUMBERING,
    styles: {
      default: { document: { run: { font: bFont, size: 22 } } },
      // Explicit H1/H2/H3 styling so the markdown renderer's heading
      // levels stay visually distinct in the final DOCX.
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
          run: { size: 32, bold: true, color: cSecondary, font: hFont },
          paragraph: { spacing: { before: 320, after: 160 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal",
          run: { size: 26, bold: true, color: cPrimary, font: hFont },
          paragraph: { spacing: { before: 260, after: 120 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal",
          run: { size: 22, bold: true, color: cAccent, font: hFont },
          paragraph: { spacing: { before: 200, after: 100 } } },
      ],
    },
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
