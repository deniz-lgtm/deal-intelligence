import Anthropic from "@anthropic-ai/sdk";
import { getActiveModel } from "./claude";
import { CONCISE_STYLE } from "./ai-style";
import type {
  SiteWalk,
  SiteWalkRecording,
  SiteWalkPhoto,
  SiteWalkDeficiency,
  SiteWalkAreaTag,
  DeficiencySeverity,
} from "./types";
import { SITE_WALK_AREA_LABELS } from "./types";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export interface ProcessedObservation {
  area_tag: SiteWalkAreaTag;
  text: string;
  is_positive: boolean;
  is_concern: boolean;
}

export interface ProcessedDeficiency {
  area_tag: SiteWalkAreaTag;
  description: string;
  severity: DeficiencySeverity;
  category: string;
  estimated_cost_note: string | null;
}

export interface ProcessedTranscript {
  cleaned_transcript: string;
  summary: string;
  observations: ProcessedObservation[];
  deficiencies: ProcessedDeficiency[];
}

const AREA_TAGS = Object.keys(SITE_WALK_AREA_LABELS).join(", ");
const SEVERITY_VALUES = "minor, moderate, major, critical";

const PROCESS_SYSTEM = `You are a commercial real estate site walk analyst. You receive raw transcripts from property tour recordings (phone voice memos, video walkthroughs). Your job is to turn them into structured, professional notes.

${CONCISE_STYLE}

Rules:
- Strip small talk, greetings, filler words, and irrelevant chatter.
- Keep observations specific — cite measurements, conditions, and details the speaker mentioned.
- Classify each observation under the best-fit area tag from this list: ${AREA_TAGS}.
- Surface any deficiencies, deferred maintenance, or concerns as separate "deficiencies" entries with a severity of: ${SEVERITY_VALUES}.
- Typical deficiency categories: exterior, interior, mechanical, electrical, plumbing, roofing, structural, life_safety, cosmetic, ada, other.
- Return ONLY valid JSON — no markdown, no preamble, no commentary.`;

export async function processTranscript(
  rawTranscript: string,
  dealContext?: string
): Promise<ProcessedTranscript> {
  if (!rawTranscript.trim()) {
    return {
      cleaned_transcript: "",
      summary: "",
      observations: [],
      deficiencies: [],
    };
  }

  const userPrompt = `${dealContext ? `DEAL CONTEXT:\n${dealContext}\n\n` : ""}RAW TRANSCRIPT:
"""
${rawTranscript}
"""

Return a JSON object with this exact shape:
{
  "cleaned_transcript": "Professional paragraph-form narrative with small talk removed.",
  "summary": "2-3 sentence overall summary of the walk.",
  "observations": [
    { "area_tag": "exterior", "text": "...", "is_positive": false, "is_concern": false }
  ],
  "deficiencies": [
    {
      "area_tag": "roof",
      "description": "...",
      "severity": "moderate",
      "category": "roofing",
      "estimated_cost_note": null
    }
  ]
}`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 4000,
    system: PROCESS_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      cleaned_transcript: typeof parsed.cleaned_transcript === "string" ? parsed.cleaned_transcript : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      observations: Array.isArray(parsed.observations)
        ? parsed.observations.map((o: Record<string, unknown>) => ({
            area_tag: (o.area_tag as SiteWalkAreaTag) || "general",
            text: String(o.text ?? ""),
            is_positive: Boolean(o.is_positive),
            is_concern: Boolean(o.is_concern),
          }))
        : [],
      deficiencies: Array.isArray(parsed.deficiencies)
        ? parsed.deficiencies.map((d: Record<string, unknown>) => ({
            area_tag: (d.area_tag as SiteWalkAreaTag) || "general",
            description: String(d.description ?? ""),
            severity: ((d.severity as DeficiencySeverity) || "minor") as DeficiencySeverity,
            category: String(d.category ?? "other"),
            estimated_cost_note: d.estimated_cost_note ? String(d.estimated_cost_note) : null,
          }))
        : [],
    };
  } catch (err) {
    console.error("processTranscript parse failed:", err, "raw:", text.slice(0, 300));
    return {
      cleaned_transcript: rawTranscript,
      summary: "",
      observations: [],
      deficiencies: [],
    };
  }
}

export interface WalkReportInput {
  walk: SiteWalk;
  recordings: SiteWalkRecording[];
  photos: SiteWalkPhoto[];
  deficiencies: SiteWalkDeficiency[];
  dealContext?: string;
}

const REPORT_SYSTEM = `You are a commercial real estate analyst writing a professional site walk report for an investment committee.

${CONCISE_STYLE}

Output format: clean GitHub-flavored markdown with the following sections:
1. ## Overview — date, attendees, weather, overall condition
2. ## Executive Summary — 3-5 bullets on key findings
3. ## Observations by Area — sub-headings per area; bulleted findings
4. ## Deficiency Summary — markdown table: | Area | Description | Severity | Est. Cost |
5. ## Recommendations — 3-5 bullets on next steps or underwriting impact

Do not invent data. Only use what's provided.`;

export async function generateWalkReport(input: WalkReportInput): Promise<string> {
  const { walk, recordings, photos, deficiencies, dealContext } = input;

  const transcriptsText = recordings
    .filter((r) => r.transcript_cleaned || r.transcript_raw)
    .map((r, i) => {
      const label = `Recording ${i + 1} (${r.original_name})`;
      const body = r.transcript_cleaned || r.transcript_raw || "";
      return `### ${label}\n${body}`;
    })
    .join("\n\n");

  const photoList = photos.length
    ? photos
        .map((p) => `- [${SITE_WALK_AREA_LABELS[p.area_tag] ?? p.area_tag}] ${p.unit_label ? `${p.unit_label}: ` : ""}${p.caption || p.original_name}`)
        .join("\n")
    : "(none)";

  const deficiencyList = deficiencies.length
    ? deficiencies
        .map(
          (d) =>
            `- [${SITE_WALK_AREA_LABELS[d.area_tag] ?? d.area_tag}] ${d.description} — severity: ${d.severity}, category: ${d.category}${d.estimated_cost ? `, est. cost: $${d.estimated_cost}` : ""}, status: ${d.status}`
        )
        .join("\n")
    : "(none)";

  const userPrompt = `${dealContext ? `DEAL CONTEXT:\n${dealContext}\n\n` : ""}WALK METADATA:
- Title: ${walk.title || "Untitled"}
- Date: ${walk.walk_date}
- Status: ${walk.status}
- Attendees: ${walk.attendees.join(", ") || "(none listed)"}
- Property contact: ${walk.property_contact || "(not listed)"}
- Weather: ${walk.weather || "(not listed)"}
- User summary: ${walk.summary || "(none)"}

TRANSCRIPTS:
${transcriptsText || "(no recordings transcribed)"}

PHOTOS LOGGED:
${photoList}

DEFICIENCIES LOGGED:
${deficiencyList}

Write the full markdown report now.`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 4000,
    system: REPORT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
