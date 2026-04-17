// ─── AI Sections & Doc-Relevance Map ────────────────────────────────────────
//
// Single source of truth for which documents are relevant to which
// AI-autofill surfaces. The `<AIButton>` and `<DocCoverageChip>` primitives
// read from here so every AI affordance in the app sings the same song:
// "here's how many docs back this field up, and here's how confident we
// are that AI-only output would be useful".
//
// Adding a new AI surface? Register it here — don't hand-roll another
// doc-counting block inside the page.

import type { Document, DocumentCategory } from "./types";

export type AISection =
  | "deal_intake"        // Overview: top-level deal fields from OM / listing
  | "revenue"            // UW: rent roll, unit mix, in-place rents
  | "opex"               // UW: operating expenses from T-12 / financials
  | "capex"              // UW: CapEx / dev budget from inspections / engineering
  | "financing"          // UW: debt terms, rates, LTV from term sheets
  | "zoning"             // Site & Zoning: zoning designation, FAR, bonuses
  | "comps"              // Comps: rent / sale comps from market reports
  | "location"           // Location Intel: demographics, jobs, pipeline
  | "loi"                // LOI: earnest money, diligence, closing terms
  | "dd_abstract"        // DD Abstract report
  | "inv_package"        // Investment Package sections
  | "entitlement_tasks"  // Dev schedule: jurisdiction-specific tasks
  | "affordability";     // Programming: affordable mix under bonus programs

export interface AISectionDef {
  label: string;
  // DocumentCategory values that are typically relevant for this section.
  // Scored at weight 1 per match.
  categories: DocumentCategory[];
  // Case-insensitive keywords matched against document name + ai_tags.
  // Scored at weight 2 per match (a named "T-12" beats a generic "financial").
  keywords: string[];
}

export const AI_SECTIONS: Record<AISection, AISectionDef> = {
  deal_intake: {
    label: "Deal Intake",
    categories: ["om", "market"],
    keywords: ["om", "offering memorandum", "brochure", "flyer", "listing", "broker package"],
  },
  revenue: {
    label: "Revenue",
    categories: ["financial", "leases"],
    keywords: ["rent roll", "rent-roll", "rentroll", "lease abstract", "lease schedule", "lease"],
  },
  opex: {
    label: "Operating Expenses",
    categories: ["financial", "utilities", "insurance"],
    keywords: ["t-12", "t12", "trailing 12", "operating statement", "p&l", "p+l", "income statement", "tax bill", "property tax", "insurance binder"],
  },
  capex: {
    label: "Capital Expenditures",
    categories: ["inspections", "surveys_engineering"],
    keywords: ["inspection", "pcr", "property condition", "engineering report", "phase i", "phase ii", "capital plan", "scope of work"],
  },
  financing: {
    label: "Financing",
    categories: ["financial", "legal"],
    keywords: ["term sheet", "commitment letter", "loan", "lender quote", "debt", "refi"],
  },
  zoning: {
    label: "Zoning",
    categories: ["zoning_entitlements", "permits"],
    keywords: ["zoning letter", "zoning report", "entitlement", "permit", "variance", "use permit"],
  },
  comps: {
    label: "Comps",
    categories: ["market"],
    keywords: ["comp", "market report", "appraisal", "bov", "rent study", "sales comp"],
  },
  location: {
    label: "Location Intel",
    categories: ["market"],
    keywords: ["demographic", "market study", "esri", "placer", "submarket", "costar report"],
  },
  loi: {
    label: "LOI",
    categories: ["legal", "om"],
    keywords: ["loi", "letter of intent", "term sheet", "psa", "broker email"],
  },
  dd_abstract: {
    label: "DD Abstract",
    // Pulls from the full diligence set — any uploaded doc is fair game.
    categories: [
      "om", "title_ownership", "environmental", "zoning_entitlements",
      "financial", "surveys_engineering", "legal", "inspections",
    ],
    keywords: [],
  },
  inv_package: {
    label: "Investment Package",
    categories: ["om", "financial", "market"],
    keywords: ["om", "rent roll", "t-12", "market report"],
  },
  entitlement_tasks: {
    label: "Entitlement Tasks",
    categories: ["zoning_entitlements", "permits", "legal"],
    keywords: ["zoning letter", "entitlement", "permit", "general plan", "specific plan"],
  },
  affordability: {
    label: "Affordability",
    categories: ["zoning_entitlements"],
    keywords: ["density bonus", "ami", "inclusionary", "sb 35", "sb 9", "sb 166", "affordable housing"],
  },
};

// ─── Relevance scoring ──────────────────────────────────────────────────────

export interface DocRelevance {
  doc: Document;
  score: number;       // 0 = not relevant, higher = more relevant
  matched: string[];   // which keywords / "category" tokens matched
}

function scoreDoc(doc: Document, def: AISectionDef): DocRelevance {
  const matched: string[] = [];
  let score = 0;

  if (def.categories.includes(doc.category)) {
    score += 1;
    matched.push(`category:${doc.category}`);
  }

  const haystack = [
    doc.name ?? "",
    doc.original_name ?? "",
    doc.ai_tags ?? "",
  ].join(" ").toLowerCase();

  for (const kw of def.keywords) {
    if (haystack.includes(kw.toLowerCase())) {
      score += 2;
      matched.push(kw);
    }
  }

  return { doc, score, matched };
}

/**
 * Returns docs relevant to the given section, sorted by relevance
 * descending. Docs with score 0 are excluded. Callers can clamp the
 * returned length themselves — the full ranked list is useful for the
 * doc-picker modal too.
 */
export function getRelevantDocs(
  documents: Document[],
  section: AISection,
): DocRelevance[] {
  const def = AI_SECTIONS[section];
  return documents
    .map((doc) => scoreDoc(doc, def))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ─── Coverage tier ──────────────────────────────────────────────────────────
//
// High / medium / low maps directly onto the confidence chip the user
// sees before clicking an <AIButton>. Thresholds are intentionally simple
// so a PM can tune them without digging into component internals.

export type CoverageTier = "high" | "medium" | "low";

export function coverageTier(relevantCount: number): CoverageTier {
  if (relevantCount >= 3) return "high";
  if (relevantCount >= 1) return "medium";
  return "low";
}
