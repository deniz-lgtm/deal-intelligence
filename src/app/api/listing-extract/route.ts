import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

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

interface ListingExtractResult {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: string | null;
  investment_strategy: string | null;
  year_built: number | null;
  square_footage: number | null;
  units: number | null;
  asking_price: number | null;
  cap_rate: number | null;
  noi: number | null;
  occupancy: number | null;
  lot_size: string | null;
  description: string | null;
}

const FALLBACK: ListingExtractResult = {
  name: null, address: null, city: null, state: null, zip: null,
  property_type: null, investment_strategy: null, year_built: null,
  square_footage: null, units: null, asking_price: null,
  cap_rate: null, noi: null, occupancy: null, lot_size: null, description: null,
};

/**
 * POST /api/listing-extract
 * Extract deal info from a property listing URL (LoopNet, Crexi, CoStar, etc.)
 * Uses Claude web_search to fetch and read the listing page.
 *
 * Body: { url: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body as { url: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate it looks like a URL
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Use Claude with web_search to fetch and extract from the listing
    const prompt = `You are an expert commercial real estate analyst. I need you to visit and read this property listing URL, then extract deal information from it.

URL: ${url}

Use web search to access this listing page. Extract all available property details.

Return ONLY a JSON object with these fields. Use null for anything you cannot find with confidence:

{
  "name": "property name or marketing title (e.g. 'Hawthorne Commerce Center') or null",
  "address": "street address only (e.g. '123 Industrial Ave') or null",
  "city": "city name or null",
  "state": "2-letter state code (e.g. 'CA') or null",
  "zip": "ZIP code or null",
  "property_type": "one of: multifamily|student_housing|industrial|office|retail|mixed_use|land|hospitality|other — or null",
  "investment_strategy": "one of: value_add|ground_up|core|core_plus|opportunistic — infer from listing context (vacant/distressed = opportunistic, new construction/land = ground_up, stabilized = core, light reno needed = value_add, minor improvements = core_plus) or null",
  "year_built": 1985,
  "square_footage": 45000,
  "units": 24,
  "asking_price": 5500000,
  "cap_rate": 6.5,
  "noi": 357500,
  "occupancy": 92,
  "lot_size": "2.5 acres",
  "description": "Brief 1-2 sentence summary of the property and opportunity"
}

Rules:
- All dollar values as plain numbers (no $ or commas). Convert M/K suffixes: 5.5M → 5500000
- cap_rate and occupancy as percentages (e.g. 6.5 not 0.065)
- square_footage and units as integers
- year_built as 4-digit integer
- For investment_strategy, infer from context: if the listing mentions value-add, rehab, or below-market rents → "value_add". If it's raw land or new development → "ground_up". If it's a stabilized asset at market rents → "core". If it shows minor improvement opportunity → "core_plus". Distressed or vacant → "opportunistic".
- Respond with ONLY the JSON object, no other text`;

    // Try with web_search tool
    let extracted = FALLBACK;
    try {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 1500,
        tools: [
          {
            type: "web_search" as const,
            name: "web_search" as const,
            max_uses: 3,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        messages: [{ role: "user", content: prompt }],
      });

      let text = "";
      for (const block of response.content) {
        if (block.type === "text") text = block.text;
      }

      if (text.trim()) {
        extracted = parseJson<ListingExtractResult>(text, FALLBACK);
      }
    } catch (err) {
      console.error("Web search extraction failed, trying without:", err);

      // Fallback: try without web_search (Claude may still know the listing from training data)
      const fallbackResponse = await getClient().messages.create({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt.replace("Use web search to access this listing page. ", "") }],
      });

      const raw = fallbackResponse.content[0].type === "text" ? fallbackResponse.content[0].text : "{}";
      extracted = parseJson<ListingExtractResult>(raw, FALLBACK);
    }

    return NextResponse.json({ data: extracted });
  } catch (error) {
    console.error("POST /api/listing-extract error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to extract listing: ${message}` }, { status: 500 });
  }
}
