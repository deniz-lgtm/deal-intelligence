import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle, Table } from "docx";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal } from "@/lib/db";
import {
  resolveBranding,
  markdownToPptxBlocks,
  markdownToDocx,
  shadeHex,
} from "@/lib/export-markdown";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

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
    // Darker shade of PRIMARY for subtle side-panel accents on the cover.
    // Blends a fixed 20% black into whatever the brand's secondary color is
    // so we get a visible tonal shift even when PRIMARY is already dark.
    const PRIMARY_DARK = shadeHex(PRIMARY, -0.2);

    // Pre-compute the list of sections with meaningful content so the TOC
    // and page numbers line up with what actually renders.
    const renderableSections = sections.filter(
      (s) => s.generatedContent || s.notes.filter(n => n.text?.trim()).length > 0
    );

    // Shared footer block — bottom rule + confidentiality + company + page.
    // Declared up here (as an arrow, not a nested function declaration, to
    // satisfy strict-mode ES5 target) so both the TOC and every content
    // slide can call it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addSlideFooter = (slide: any, pageNum?: number) => {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.85, y: 6.9, w: 11.5, h: 0.01, fill: { color: ACCENT + "66" },
      });
      slide.addText(footerText, {
        x: 0.85, y: 7.0, w: 4, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
      });
      slide.addText(companyName || dealName, {
        x: 4.85, y: 7.0, w: 4, h: 0.3,
        fontSize: 8, color: MUTED, fontFace: bodyFont,
        align: "center",
      });
      if (pageNum != null) {
        slide.addText(`${pageNum} / ${renderableSections.length}`, {
          x: 10.5, y: 7.0, w: 1.85, h: 0.3,
          fontSize: 8, color: MUTED, fontFace: bodyFont,
          align: "right",
        });
      }
    };

    // --- Cover Slide ───────────────────────────────────────────────────
    // Two-column composition: a dark PRIMARY band covers the full slide as
    // the background with a vertical ACCENT stripe at left, big title in
    // the center, confidentiality mark + date + company locked to the
    // top-left and bottom. Deliberately heavier weight than a Word cover
    // because pitch decks are read from across a conference-room table.
    const cover = pptx.addSlide();
    cover.background = { color: PRIMARY };

    // Vertical accent stripe — full slide height, left edge
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: ACCENT },
    });
    // Subtle right-side accent block so the composition doesn't feel top-heavy
    cover.addShape(pptx.ShapeType.rect, {
      x: 12.4, y: 0, w: 0.93, h: 7.5, fill: { color: PRIMARY_DARK },
    });

    // Confidentiality tag
    cover.addText("STRICTLY CONFIDENTIAL  ·  FOR INTERNAL IC USE ONLY", {
      x: 0.8, y: 0.45, w: 11.5, h: 0.3,
      fontSize: 9, color: "FCA5A5",
      fontFace: headerFont, bold: true,
      charSpacing: 10,
    });

    // Section label above title
    cover.addText("INVESTMENT COMMITTEE MATERIALS", {
      x: 0.8, y: 2.2, w: 11.5, h: 0.4,
      fontSize: 12, color: "93C5FD",
      fontFace: headerFont, bold: false,
      charSpacing: 8,
    });
    // Deal name — the focal point
    cover.addText(dealName, {
      x: 0.8, y: 2.75, w: 11.2, h: 1.5,
      fontSize: 44, color: "FFFFFF",
      fontFace: headerFont, bold: true,
    });
    // Accent divider under the name
    cover.addShape(pptx.ShapeType.rect, {
      x: 0.8, y: 4.35, w: 1.8, h: 0.06, fill: { color: ACCENT },
    });
    // Date — understated subtitle
    cover.addText(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), {
      x: 0.8, y: 4.55, w: 11.5, h: 0.4,
      fontSize: 14, color: "CBD5E1",
      fontFace: headerFont,
    });

    // Deal one-line metadata chip row (asking / units / sf / year / strategy)
    // — pulled from the sections list when a cover "notes" array supplies it.
    // Skipping by default; can be wired later by passing deal data into this
    // route.

    // Company block — bottom-left, institutional signature
    if (companyName) {
      cover.addText(companyName, {
        x: 0.8, y: 6.35, w: 7, h: 0.4,
        fontSize: 14, color: "FFFFFF",
        fontFace: headerFont, bold: true,
        charSpacing: 1,
      });
      if (tagline) {
        cover.addText(tagline, {
          x: 0.8, y: 6.75, w: 7, h: 0.3,
          fontSize: 10, color: "94A3B8",
          fontFace: bodyFont, italic: true,
        });
      }
      const contactParts = [website, bEmail, phone].filter(Boolean);
      if (contactParts.length > 0) {
        cover.addText(contactParts.join("  ·  "), {
          x: 8, y: 7.05, w: 4.4, h: 0.3,
          fontSize: 8, color: "64748B",
          fontFace: bodyFont, align: "right",
        });
      }
    }

    // --- Table of Contents ─────────────────────────────────────────────
    // Two-column TOC: big section numbers in ACCENT at left, section titles
    // at right, each row separated by a hairline. Feels more like a printed
    // memo than a text dump.
    if (renderableSections.length > 1) {
      const toc = pptx.addSlide();
      toc.background = { color: "FFFFFF" };
      // Colored sidebar — echoes the cover's accent stripe for continuity
      toc.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: ACCENT },
      });
      // Label strip
      toc.addText("CONTENTS", {
        x: 0.85, y: 0.6, w: 6, h: 0.35,
        fontSize: 10, color: ACCENT,
        fontFace: headerFont, bold: true, charSpacing: 10,
      });
      toc.addText(dealName, {
        x: 0.85, y: 1.0, w: 11.5, h: 0.8,
        fontSize: 28, color: PRIMARY,
        fontFace: headerFont, bold: true,
      });
      toc.addShape(pptx.ShapeType.rect, {
        x: 0.85, y: 1.85, w: 1.5, h: 0.04, fill: { color: ACCENT },
      });

      // Rows
      const rowH = 0.5;
      const startY = 2.3;
      const visible = renderableSections.slice(0, 10);
      visible.forEach((s, i) => {
        const y = startY + i * rowH;
        toc.addText(String(i + 1).padStart(2, "0"), {
          x: 0.85, y, w: 0.8, h: rowH - 0.05,
          fontSize: 22, color: ACCENT,
          fontFace: headerFont, bold: true, valign: "middle",
        });
        toc.addText(s.title, {
          x: 1.75, y, w: 10.5, h: rowH - 0.05,
          fontSize: 13, color: TEXT,
          fontFace: bodyFont, valign: "middle",
        });
        toc.addShape(pptx.ShapeType.rect, {
          x: 0.85, y: y + rowH - 0.05, w: 11.5, h: 0.005, fill: { color: "E5E7EB" },
        });
      });

      addSlideFooter(toc);
    }

    // --- Content Slides ───────────────────────────────────────────────
    let slideIdx = 0;
    for (const section of sections) {
      if (!section.generatedContent && section.notes.filter(n => n.text?.trim()).length === 0) continue;
      slideIdx += 1;

      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      // Left accent stripe — full slide height. Anchors every content
      // slide to the brand color without consuming the full header.
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: ACCENT },
      });

      // Top-left: small section label ("01 / 08  ·  CONFIDENTIAL")
      slide.addText(
        `${String(slideIdx).padStart(2, "0")} / ${String(renderableSections.length).padStart(2, "0")}  ·  ${footerText}`,
        {
          x: 0.85, y: 0.45, w: 6, h: 0.3,
          fontSize: 9, color: MUTED,
          fontFace: headerFont, bold: true, charSpacing: 6,
        }
      );
      // Section title — big, dark, left-aligned
      slide.addText(section.title, {
        x: 0.85, y: 0.75, w: 11.5, h: 0.6,
        fontSize: 22, color: PRIMARY,
        fontFace: headerFont, bold: true,
      });
      // Accent rule under the title
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.85, y: 1.38, w: 1.2, h: 0.045, fill: { color: ACCENT },
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
              x: 0.85, y: 1.65, w: 11.5, h: 5.0,
              valign: "top",
              fontFace: bodyFont,
              shrinkText: true,
            } as unknown as Parameters<typeof slide.addText>[1]
          );
        }
      }

      addSlideFooter(slide, slideIdx);
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
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Export failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
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
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: shadeHex(cPrimary, 0.75) } },
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
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: shadeHex(cPrimary, 0.75) } },
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
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: shadeHex(cPrimary, 0.55) } },
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

  // Minimum viable Document config. markdownToDocx sets per-run size / bold
  // / color / font on every paragraph, so we don't need a custom stylesheet
  // or a numbering registration — both have been triggers for
  // Packer.toBuffer() crashes on certain docx@9.x patch versions.
  const doc = new Document({
    sections: [{ children }],
    styles: {
      default: { document: { run: { font: bFont, size: 22 } } },
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

