import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

interface OmExtractResult {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: string | null;
  year_built: number | null;
  square_footage: number | null;
  units: number | null;
  asking_price: number | null;
}

/**
 * POST /api/om-extract
 * Quick Stage-1-only extraction for pre-filling the new deal form.
 * No deal or DB writes required.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let pdfText = "";

    if (file.type === "application/pdf") {
      try {
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(buffer);
        pdfText = (data.text || "").replace(/\x00/g, "").replace(/[\uFFFD]/g, "");
      } catch (e) {
        console.error("PDF parse error:", e);
      }
    }

    const snippet = pdfText.slice(0, 12000);

    const prompt = `You are an expert commercial real estate analyst. Extract property details from this Offering Memorandum to pre-fill a deal intake form.

OFFERING MEMORANDUM TEXT:
${snippet}

Return ONLY a JSON object with these fields. Use null for anything you cannot find with confidence:

{
  "name": "property marketing name (e.g. 'Hawthorne Commerce Center') or null",
  "address": "street address only (e.g. '123 Industrial Ave') or null",
  "city": "city name or null",
  "state": "2-letter state code (e.g. 'CA') or null",
  "zip": "ZIP code or null",
  "property_type": "one of: multifamily|sfr|student_housing|industrial|office|retail|mixed_use|land|hospitality|other — or null",
  "year_built": 1985,
  "square_footage": 45000,
  "units": null,
  "asking_price": 5500000
}

Rules:
- All dollar values as plain numbers (no $ or commas). Convert M/K suffixes: 5.5M → 5500000
- square_footage and units as integers
- year_built as 4-digit integer
- Respond with ONLY the JSON object`;

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const extracted = parseJson<OmExtractResult>(raw, {
      name: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      property_type: null,
      year_built: null,
      square_footage: null,
      units: null,
      asking_price: null,
    });

    return NextResponse.json({ data: extracted });
  } catch (error) {
    console.error("POST /api/om-extract error:", error);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
