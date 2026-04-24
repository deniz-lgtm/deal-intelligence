import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { locationIntelligenceQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import type { DemographicSnapshot } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// ── Market Report Extraction via Claude ──────────────────────────────────────
//
// Users paste text from paid data sources (CoStar, ESRI, Placer.ai, Yardi
// Matrix, etc.) and Claude extracts structured demographic data. This lets
// users bring in sub-mile-radius data that free Census APIs can't provide.

const MODEL = "claude-sonnet-4-6";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const EXTRACTION_PROMPT = `You are extracting demographic and market data from a commercial real estate market report or data export. Parse the text and extract as many of the following fields as you can find. Return ONLY a valid JSON object with these fields (use null for any field not found):

{
  "radius_miles": <number or null — the radius/trade area if mentioned>,
  "total_population": <number>,
  "population_growth_pct": <annual % growth>,
  "median_age": <number>,
  "median_household_income": <number>,
  "per_capita_income": <number>,
  "poverty_rate": <% number>,
  "bachelors_degree_pct": <% with bachelor's or higher>,
  "total_housing_units": <number>,
  "owner_occupied_pct": <% owner-occupied>,
  "renter_occupied_pct": <% renter-occupied>,
  "median_home_value": <number>,
  "median_gross_rent": <monthly $ number>,
  "home_value_growth_pct": <annual % growth>,
  "rent_growth_pct": <annual % growth>,
  "labor_force": <number>,
  "unemployment_rate": <% number>,
  "total_employed": <number>,
  "avg_household_size": <number>,
  "family_households_pct": <% family households>,
  "top_industries": [{"name": "Industry Name", "share_pct": <% number>}],
  "top_employers": [{"name": "Employer Name", "share_pct": <% or null>}],
  "population_growth_5yr_pct": <projected 5-year % growth if mentioned>,
  "job_growth_5yr_pct": <projected 5-year job growth %>,
  "home_value_growth_5yr_pct": <projected 5-year HV growth %>,
  "rent_growth_5yr_pct": <projected 5-year rent growth %>,
  "new_units_pipeline": <number of units under construction / planned>,
  "source_description": "<brief description of what data source this appears to be, e.g., 'CoStar 3-mile demographic report' or 'ESRI Community Analyst export'>"
}

Important:
- Convert any values to raw numbers (e.g., "$65,000" → 65000, "5.2%" → 5.2)
- If a field appears multiple times for different radii, prefer the one closest to 3 miles
- If growth rates are given as 5-year totals, convert to annual by dividing by 5
- Include top_employers if major employers are listed
- Include projected/forecast data in the growth fields if available`;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const body = await req.json();
    const { text, radius_miles = 3 } = body as {
      text: string;
      radius_miles?: number;
    };

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        {
          error:
            "Paste at least a few lines of market report data. Include demographics, income, housing, or employment statistics.",
        },
        { status: 400 }
      );
    }

    // Extract with Claude
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\nMARKET REPORT TEXT:\n${text.slice(0, 15000)}`,
        },
      ],
    });

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "{}";

    // Parse JSON from response
    let extracted: Record<string, unknown>;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return NextResponse.json(
        { error: "Failed to parse extracted data. Try pasting cleaner text." },
        { status: 422 }
      );
    }

    // Use extracted radius if found, otherwise use the requested one
    const effectiveRadius = (extracted.radius_miles as number) || radius_miles;

    // Build snapshot from extracted data
    const snapshot: DemographicSnapshot = {
      total_population: num(extracted.total_population),
      population_growth_pct: num(extracted.population_growth_pct),
      median_age: num(extracted.median_age),
      median_household_income: num(extracted.median_household_income),
      per_capita_income: num(extracted.per_capita_income),
      poverty_rate: num(extracted.poverty_rate),
      bachelors_degree_pct: num(extracted.bachelors_degree_pct),
      total_housing_units: num(extracted.total_housing_units),
      owner_occupied_pct: num(extracted.owner_occupied_pct),
      renter_occupied_pct: num(extracted.renter_occupied_pct),
      median_home_value: num(extracted.median_home_value),
      median_gross_rent: num(extracted.median_gross_rent),
      home_value_growth_pct: num(extracted.home_value_growth_pct),
      rent_growth_pct: num(extracted.rent_growth_pct),
      labor_force: num(extracted.labor_force),
      unemployment_rate: num(extracted.unemployment_rate),
      total_employed: num(extracted.total_employed),
      avg_household_size: num(extracted.avg_household_size),
      family_households_pct: num(extracted.family_households_pct),
      top_industries: Array.isArray(extracted.top_industries)
        ? extracted.top_industries as DemographicSnapshot["top_industries"]
        : [],
      top_employers: Array.isArray(extracted.top_employers)
        ? extracted.top_employers as DemographicSnapshot["top_employers"]
        : [],
      renter_households_by_income: null,
      renter_rent_burden: null,
    };

    // Build projections from extracted data
    const projections = {
      population_growth_5yr_pct: num(extracted.population_growth_5yr_pct),
      job_growth_5yr_pct: num(extracted.job_growth_5yr_pct),
      home_value_growth_5yr_pct: num(extracted.home_value_growth_5yr_pct),
      rent_growth_5yr_pct: num(extracted.rent_growth_5yr_pct),
      new_units_pipeline: num(extracted.new_units_pipeline),
      notes: (extracted.source_description as string) || null,
    };

    // Merge with existing data (report data takes precedence for non-null fields)
    const existing = await locationIntelligenceQueries.getByDealAndRadius(
      params.id,
      effectiveRadius
    );

    let mergedData = snapshot as unknown as Record<string, unknown>;
    let mergedProjections = projections as unknown as Record<string, unknown>;

    if (existing) {
      const existingData =
        typeof existing.data === "string"
          ? JSON.parse(existing.data)
          : existing.data || {};
      const existingProj =
        typeof existing.projections === "string"
          ? JSON.parse(existing.projections)
          : existing.projections || {};

      // Merge: report values override existing, but keep existing values for null fields
      mergedData = { ...existingData };
      for (const [key, val] of Object.entries(
        snapshot as unknown as Record<string, unknown>
      )) {
        if (val != null && (key !== "top_industries" && key !== "top_employers" || (Array.isArray(val) && val.length > 0))) {
          mergedData[key] = val;
        }
      }

      mergedProjections = { ...existingProj };
      for (const [key, val] of Object.entries(
        projections as unknown as Record<string, unknown>
      )) {
        if (val != null) {
          mergedProjections[key] = val;
        }
      }
    }

    const id = existing?.id ?? uuidv4();
    const row = await locationIntelligenceQueries.upsert(
      params.id,
      id,
      effectiveRadius,
      mergedData,
      mergedProjections,
      existing ? "mixed" : "report_upload",
      null,
      `Extracted from market report${extracted.source_description ? ` (${extracted.source_description})` : ""}`
    );

    // Count how many fields were extracted
    const fieldCount = Object.values(snapshot).filter(
      (v) => v != null && (!Array.isArray(v) || v.length > 0)
    ).length;

    return NextResponse.json({
      data: row,
      extracted: {
        snapshot,
        projections,
        fields_extracted: fieldCount,
        source_description: extracted.source_description || null,
        effective_radius: effectiveRadius,
      },
      meta: {
        source: "Market Report (Claude extraction)",
        fields_extracted: fieldCount,
        note: `Extracted ${fieldCount} demographic fields from pasted report text.`,
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/location-intelligence/extract-report error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to extract report data" },
      { status: 500 }
    );
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
