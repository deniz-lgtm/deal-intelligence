import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  TableRow,
  TableCell,
  Table,
  WidthType,
  ShadingType,
} from "docx";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { brandingQueries } from "@/lib/db";

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

    // Fetch company branding
    let branding: Record<string, unknown> | null = null;
    try {
      branding = await brandingQueries.get();
    } catch { /* use defaults */ }

    const children = parseMarkdownToDocx(markdown, dealName, branding);

    const docFont = branding?.body_font as string || "Calibri";
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: docFont,
              size: 22, // 11pt
            },
            paragraph: {
              spacing: { after: 120 },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1080, // 0.75 inch in twentieths of a point
                right: 1080,
                bottom: 1080,
                left: 1080,
              },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);

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
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

// ─── Markdown → docx parser ───────────────────────────────────────────────────

type DocxChild = Paragraph | Table;

function parseMarkdownToDocx(markdown: string, dealName: string, branding?: Record<string, unknown> | null): DocxChild[] {
  const children: DocxChild[] = [];

  const b = branding ?? {};
  const companyName = (b.company_name as string) || "";
  const primaryColor = ((b.primary_color as string) || "#4F46E5").replace("#", "");
  const secondaryColor = ((b.secondary_color as string) || "#2F3B52").replace("#", "");
  const accentColor = ((b.accent_color as string) || "#10B981").replace("#", "");
  const headerFont = (b.header_font as string) || "Helvetica";
  const bodyFont = (b.body_font as string) || "Calibri";
  const footerText = (b.footer_text as string) || "CONFIDENTIAL";
  const tagline = (b.tagline as string) || "";
  const website = (b.website as string) || "";
  const email = (b.email as string) || "";
  const phone = (b.phone as string) || "";
  const disclaimerText = (b.disclaimer_text as string) || "";

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
      children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`, size: 20, color: "666666", font: bodyFont })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // H1
    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          text: line.slice(2).trim(),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
        })
      );
      continue;
    }

    // H2
    if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          text: line.slice(3).trim(),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 80 },
        })
      );
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          text: line.slice(4).trim(),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 60 },
        })
      );
      continue;
    }

    // HR / separator
    if (line.match(/^---+$/)) {
      children.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" },
          },
          spacing: { before: 120, after: 120 },
          children: [],
        })
      );
      continue;
    }

    // Unordered list item
    if (line.match(/^[\s]*[-*+] /)) {
      const text = line.replace(/^[\s]*[-*+] /, "").trim();
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineMarkdown(text),
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Ordered list item
    const orderedMatch = line.match(/^[\s]*(\d+)\. (.+)/);
    if (orderedMatch) {
      children.push(
        new Paragraph({
          numbering: { reference: "default-numbering", level: 0 },
          children: parseInlineMarkdown(orderedMatch[2].trim()),
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      children.push(
        new Paragraph({
          children: parseInlineMarkdown(line.slice(2).trim()),
          indent: { left: 720 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 20, color: "4F46E5" },
          },
          spacing: { after: 120 },
          shading: {
            type: ShadingType.SOLID,
            color: "F5F3FF",
          },
        })
      );
      continue;
    }

    // Empty line — add spacing paragraph
    if (line.trim() === "") {
      children.push(
        new Paragraph({
          children: [],
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Regular paragraph with inline formatting
    children.push(
      new Paragraph({
        children: parseInlineMarkdown(line),
        spacing: { after: 100 },
      })
    );
  }

  // Branded footer
  children.push(
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: primaryColor + "66" } },
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

/**
 * Parse inline markdown (bold, italic, code, plain text) into TextRun[]
 */
function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];

  // Match **bold**, *italic*, `code`, and plain text segments
  const pattern = /(\*\*.*?\*\*|\*.*?\*|`.*?`|[^*`]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const part = match[0];

    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith("*") && part.endsWith("*")) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else if (part.startsWith("`") && part.endsWith("`")) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          font: "Courier New",
          size: 18,
          shading: { type: ShadingType.SOLID, color: "F3F4F6" },
        })
      );
    } else {
      if (part) runs.push(new TextRun({ text: part }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}
