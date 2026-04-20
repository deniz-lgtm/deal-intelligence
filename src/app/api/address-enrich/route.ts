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

interface AddressEnrichResult {
  name: string | null;
  property_type: string | null;
  year_built: number | null;
  square_footage: number | null;
  units: number | null;
  asking_price: number | null;
  cap_rate: number | null;
  noi: number | null;
  occupancy: number | null;
  lot_size: string | null;
  description: string | null;
  notes: string | null;
}

const FALLBACK: AddressEnrichResult = {
  name: null, property_type: null, year_built: null,
  square_footage: null, units: null, asking_price: null,
  cap_rate: null, noi: null, occupancy: null,
  lot_size: null, description: null, notes: null,
};

/**
 * POST /api/address-enrich
 * Given an address with no OM or listing URL, use Claude web_search against
 * public records, listing aggregators, and assessor sites to infer
 * property details. Any field that cannot be verified is returned null —
 * the prompt is explicit about not fabricating values.
 *
 * Body: { address: string; city: string; state: string; zip?: string; property_type?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, city, state, zip, property_type } = body as {
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      property_type?: string;
    };

    if (!address || !city || !state) {
      return NextResponse.json(
        { error: "address, city, and state are required" },
        { status: 400 }
      );
    }

    const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
    const hintLine = property_type
      ? `The user indicated the property type is: ${property_type}. Keep this in mind but correct it if public records clearly disagree.`
      : "";

    const prompt = `You are a commercial real estate analyst. Look up the following property using web search against public county assessor records, GIS parcel viewers, and listing aggregators (LoopNet, Crexi, Redfin, Zillow, CoStar public previews). Do NOT invent data — if a field cannot be verified from a source you actually read, return null.

Property: ${fullAddress}
${hintLine}

Return ONLY a JSON object with these fields (use null for anything you cannot verify with confidence):

{
  "name": "common property name or marketing title if one exists, otherwise null",
  "property_type": "one of: multifamily|sfr|student_housing|industrial|office|retail|mixed_use|land|hospitality|other — or null",
  "year_built": 1985,
  "square_footage": 45000,
  "units": 24,
  "asking_price": 5500000,
  "cap_rate": 6.5,
  "noi": 357500,
  "occupancy": 92,
  "lot_size": "2.5 acres",
  "description": "Brief 1-2 sentence summary of the property (what it is, size, notable features) — or null",
  "notes": "Short note on what you could and could not find, and which sources you used. Plain text, no JSON."
}

Rules:
- All dollar values as plain numbers (no $ or commas). Convert M/K suffixes: 5.5M → 5500000
- cap_rate and occupancy as percentages (e.g. 6.5 not 0.065)
- square_footage and units as integers
- year_built as 4-digit integer
- Only populate asking_price/cap_rate/noi/occupancy if the property is currently on-market and you can read a listing. Otherwise return null for those.
- Respond with ONLY the JSON object, no other text.`;

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
        extracted = parseJson<AddressEnrichResult>(text, FALLBACK);
      }
    } catch (err) {
      console.error("Address-enrich web search failed, falling back:", err);
      const fallbackResponse = await getClient().messages.create({
        model: MODEL,
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: prompt.replace(
              /Look up the following property using web search[\s\S]*?return null\./,
              "Based on what you already know about this address (if anything), fill in the JSON. If you do not recognize it, return null for every field and explain in notes."
            ),
          },
        ],
      });
      const raw =
        fallbackResponse.content[0].type === "text"
          ? fallbackResponse.content[0].text
          : "{}";
      extracted = parseJson<AddressEnrichResult>(raw, FALLBACK);
    }

    return NextResponse.json({ data: extracted });
  } catch (error) {
    console.error("POST /api/address-enrich error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to enrich address: ${message}` },
      { status: 500 }
    );
  }
}
