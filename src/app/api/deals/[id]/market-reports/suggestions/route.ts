import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * GET /api/deals/:id/market-reports/suggestions
 *
 * Given the deal's location + asset class, returns a curated list of FREE
 * broker research publications the analyst should pull before running the
 * AI extractor. We intentionally don't scrape these sites — most require
 * an email capture or have rate-limited PDFs — we just deep-link the
 * publisher's research landing page so the analyst grabs the right vintage
 * themselves, then drags the PDF onto the deal.
 *
 * The curation mapping favors firms known to publish submarket-level
 * research for the asset class in question. E.g. Berkadia and
 * Marcus & Millichap lead on MF; CBRE, JLL, Cushman & Wakefield, and
 * Colliers cover all asset classes with strong submarket depth.
 */

interface Suggestion {
  publisher: string;
  publisher_label: string;
  report_series: string;            // "MarketBeat", "Research", "BeyondInsights", etc.
  url: string;                      // landing page for the series
  why: string;                      // one-line justification
  free: boolean;
  asset_classes: string[];          // asset classes this series covers
}

// Known publisher landing pages — public research hubs only. No gated URLs.
const CATALOG: Suggestion[] = [
  {
    publisher: "cbre",
    publisher_label: "CBRE Research",
    report_series: "Figures / MarketBeat / Viewpoint",
    url: "https://www.cbre.com/insights",
    why: "Deep submarket-level Figures reports across every major MSA; quarterly cap-rate surveys.",
    free: true,
    asset_classes: ["multifamily", "industrial", "office", "retail", "mixed_use", "self_storage", "hospitality", "land"],
  },
  {
    publisher: "jll",
    publisher_label: "JLL Research",
    report_series: "Research / MarketBeat",
    url: "https://www.jll.com/en-us/insights",
    why: "Quarterly submarket reports + strong supply-pipeline tracking.",
    free: true,
    asset_classes: ["multifamily", "industrial", "office", "retail", "mixed_use", "hospitality"],
  },
  {
    publisher: "cushman_wakefield",
    publisher_label: "Cushman & Wakefield",
    report_series: "MarketBeat",
    url: "https://www.cushmanwakefield.com/en/insights",
    why: "Consistent quarterly MarketBeat reports by asset class and market.",
    free: true,
    asset_classes: ["multifamily", "industrial", "office", "retail", "mixed_use", "hospitality"],
  },
  {
    publisher: "colliers",
    publisher_label: "Colliers",
    report_series: "Market Reports",
    url: "https://www.colliers.com/en/research",
    why: "Submarket reports with good rent + cap-rate detail.",
    free: true,
    asset_classes: ["multifamily", "industrial", "office", "retail", "self_storage", "land"],
  },
  {
    publisher: "newmark",
    publisher_label: "Newmark",
    report_series: "Research / Viewpoint",
    url: "https://www.nmrk.com/insights",
    why: "Strong capital-markets + debt-market commentary alongside submarket data.",
    free: true,
    asset_classes: ["multifamily", "industrial", "office", "retail", "mixed_use"],
  },
  {
    publisher: "marcus_millichap",
    publisher_label: "Marcus & Millichap",
    report_series: "Market Reports / Investor Insights",
    url: "https://www.marcusmillichap.com/research",
    why: "Best free private-capital sale-comp and cap-rate coverage; strong in MF, retail, self-storage.",
    free: true,
    asset_classes: ["multifamily", "retail", "self_storage", "industrial", "office", "hospitality"],
  },
  {
    publisher: "berkadia",
    publisher_label: "Berkadia",
    report_series: "BeyondInsights",
    url: "https://www.berkadia.com/insights",
    why: "MF-focused: quarterly submarket-level rent, occupancy, and pipeline data.",
    free: true,
    asset_classes: ["multifamily"],
  },
  {
    publisher: "yardi_matrix",
    publisher_label: "Yardi Matrix",
    report_series: "National / MSA Reports",
    url: "https://www.yardimatrix.com/Publications",
    why: "MF: monthly rent + supply pipeline. Some free reports at MSA level.",
    free: true,
    asset_classes: ["multifamily", "self_storage", "office", "industrial"],
  },
  {
    publisher: "realpage",
    publisher_label: "RealPage Market Analytics",
    report_series: "Market Insights",
    url: "https://www.realpage.com/analytics/market-insights/",
    why: "MF-specific: granular submarket rent + occupancy trends.",
    free: true,
    asset_classes: ["multifamily", "student_housing"],
  },
];

// Asset classes that LPC / TCC / developer-focused shops care about most.
// Student housing, self-storage, and industrial all get separate callouts
// so the suggestions list doesn't collapse every market into an MF default.
const ASSET_CLASS_ALIAS: Record<string, string> = {
  sfr: "multifamily",
  bfr: "multifamily",
  build_to_rent: "multifamily",
  student: "student_housing",
  storage: "self_storage",
  hotel: "hospitality",
  industrial_flex: "industrial",
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const rawType = (deal.property_type || "").toLowerCase();
    const assetClass = ASSET_CLASS_ALIAS[rawType] || rawType || "multifamily";
    const city = deal.city || "";
    const state = deal.state || "";
    const locationBits = [city, state].filter(Boolean).join(", ");

    // Filter the catalog to publishers that cover this asset class.
    const matches = CATALOG.filter((s) =>
      s.asset_classes.includes(assetClass) || s.asset_classes.includes("multifamily")
    );

    // Build a suggested search-hint the analyst can paste into the publisher
    // site to find the right vintage quickly. We don't deep-link because
    // publisher URL schemes change constantly and a dead link is worse than
    // a reliable landing page + search hint.
    const searchHint = locationBits
      ? `${locationBits} ${assetClass.replace("_", " ")} market report`
      : `${assetClass.replace("_", " ")} market report`;

    return NextResponse.json({
      data: {
        asset_class: assetClass,
        market: locationBits || null,
        search_hint: searchHint,
        suggestions: matches,
      },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/market-reports/suggestions error:", error);
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}
