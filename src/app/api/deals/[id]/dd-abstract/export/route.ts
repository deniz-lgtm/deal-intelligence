import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
} from "docx";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal, generatedReportsQueries } from "@/lib/db";
import { resolveBranding, markdownToDocx, shadeHex } from "@/lib/export-markdown";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/dd-abstract/export
 * Accepts { markdown: string, dealName: string } in JSON body.
 * Returns a .docx file.
 */
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
    const markdown: string = body.markdown ?? "";
    const dealName: string = body.dealName ?? "Deal";
    // Reports-hub re-download proxies to this route; skip the snapshot
    // write so we don't duplicate the saved row.
    const skipSnapshot = req.headers.get("x-skip-snapshot") === "1";

    // Fetch branding from deal's business plan
    let branding: Record<string, unknown> | null = null;
    try {
      branding = await getBrandingForDeal(params.id);
    } catch { /* use defaults */ }

    const children = parseMarkdownToDocx(markdown, dealName, branding);

    const theme = resolveBranding(branding);
    // Minimum viable Document config. markdownToDocx sets per-run
    // size/bold/color/font on each heading and renders ordered lists as
    // literal "1. foo" paragraphs (no numbering.reference needed), so we
    // skip both the Document-level paragraphStyles block and the numbering
    // registration — both have caused Packer.toBuffer() to crash on
    // certain docx@9.x patch versions.
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: theme.bodyFont, size: 22 },
            paragraph: { spacing: { after: 120 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);

    // Save a snapshot so the DD Abstract appears in the deal's Reports hub.
    // Skipped when we're re-rendering from an existing snapshot.
    if (!skipSnapshot) try {
      await generatedReportsQueries.create(params.id, uuidv4(), {
        title: `DD Abstract — ${dealName}`,
        report_type: "dd_abstract",
        format: "docx",
        audience: null,
        deal_name: dealName,
        sections: [{ id: "dd_abstract", title: "Due Diligence Abstract", content: markdown, notes: [] }],
        file_size_bytes: uint8.byteLength,
        created_by: userId,
      });
    } catch (err) {
      console.warn("dd-abstract export: failed to save generated_reports row:", err);
    }

    const filename = `DD-Abstract-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.docx`;

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": uint8.length.toString(),
      },
    });
  } catch (error) {
    console.error("DD Abstract Word export error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Export failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}

// ─── Markdown → docx parser ───────────────────────────────────────────────────

type DocxChild = Paragraph | Table;

function parseMarkdownToDocx(markdown: string, dealName: string, branding?: Record<string, unknown> | null): DocxChild[] {
  const children: DocxChild[] = [];

  // Resolve colors, fonts, confidentiality, disclaimer from the deal's
  // business plan branding (getBrandingForDeal → resolveBranding).
  const theme = resolveBranding(branding);
  const companyName = theme.companyName;
  const primaryColor = theme.primaryColor;
  const secondaryColor = theme.secondaryColor;
  const accentColor = theme.accentColor;
  const headerFont = theme.headerFont;
  const bodyFont = theme.bodyFont;
  const footerText = theme.footerText;
  const tagline = theme.tagline;
  const website = theme.website;
  const email = theme.email;
  const phone = theme.phone;
  const disclaimerText = theme.disclaimerText;

  // Branded header
  if (companyName) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: companyName, size: 32, bold: true, color: secondaryColor, font: headerFont })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
      })
    );
    if (tagline) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: tagline, size: 18, color: accentColor, font: bodyFont })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
        })
      );
    }
    const contactParts = [website, email, phone].filter(Boolean);
    if (contactParts.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: contactParts.join("  ·  "), size: 16, color: "999999", font: bodyFont })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        })
      );
    }
    children.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: primaryColor } },
        spacing: { after: 200 },
        children: [],
      })
    );
  }

  // Cover title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: "STRICTLY CONFIDENTIAL  ·  IC PRE-READ", size: 18, bold: true, color: "C2410C", font: headerFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Due Diligence Abstract", size: 36, bold: true, color: secondaryColor, font: headerFont })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: dealName, size: 26, bold: true, color: primaryColor, font: headerFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Prepared: ${new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`, size: 20, color: "666666", font: bodyFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Body — shared markdown renderer handles H1/H2/H3 with explicit style
  // hierarchy, real Word numbered lists, markdown tables, blockquotes,
  // horizontal rules, inline **bold** / *italic* / `code`, and dedupes
  // consecutive blank lines so we don't bloat the document with empty
  // paragraphs.
  const body = markdownToDocx(markdown, theme, { bodySize: 22, bodyColor: "1E293B" });
  for (const c of body) children.push(c);

  // Branded footer
  children.push(
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: shadeHex(primaryColor, 0.55) } },
      spacing: { before: 400 },
      children: [],
    })
  );
  if (footerText || companyName) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: footerText, size: 16, color: "999999", font: bodyFont }),
          ...(companyName ? [new TextRun({ text: `  —  ${companyName}`, size: 16, color: "999999", font: bodyFont })] : []),
        ],
        spacing: { after: 60 },
      })
    );
  }
  if (disclaimerText) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: disclaimerText, size: 14, color: "AAAAAA", font: bodyFont, italics: true })],
        spacing: { after: 60 },
      })
    );
  }

  return children;
}

