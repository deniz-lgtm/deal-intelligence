/**
 * IC Package · Deal Mapper
 *
 * Turns a structured DealContext (numbers) plus ProseSections (prose from
 * the LLM or human edits) into a fully-resolved IcPackage ready for
 * rendering.
 *
 * The mapper is intentionally pure: it does no I/O, no DB access, no API
 * calls. Callers assemble the DealContext from whatever source they like
 * (live underwriting data, a saved snapshot, or demo fixtures) and hand
 * the result to us.
 */

import type {
  IcPackage,
  DealContext,
  ProseSections,
  MetricCell,
  SectionHeadProps,
  Scenario,
  CapitalSource,
} from "@/app/deals/[id]/ic-package/types";

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtUSDShort(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtPreparedDate(d: Date): string {
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  return `${String(day).padStart(2, "0")} ${mon} ${d.getFullYear()}`;
}

// ─── Derivations ────────────────────────────────────────────────────────────

/**
 * Pick the single word to italicize in the deal's headline. Heuristic:
 * prefer a proper noun, otherwise the longest word. Returns null if the
 * deal name is a single word.
 */
function pickItalicWord(dealName: string): string | null {
  const tokens = dealName.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const stop = new Set(["the", "a", "an", "of", "at", "on", "and", "for", "in", "to"]);
  const candidates = tokens.filter((t) => !stop.has(t.toLowerCase()));
  if (candidates.length === 0) return tokens[tokens.length - 1];
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

function subtitleFrom(ctx: DealContext): string {
  const parts: string[] = [];
  if (ctx.unitCount != null) {
    parts.push(`${ctx.unitCount}-UNIT`);
  } else if (ctx.squareFootage != null) {
    parts.push(`${Math.round(ctx.squareFootage / 1000)}K SF`);
  }
  if (ctx.propertyType) {
    parts.push(ctx.propertyType.replace(/_/g, " ").toUpperCase());
  }
  if (ctx.location) {
    const city = ctx.location.split(",")[0].trim().toUpperCase();
    if (city) parts.push(city);
  }
  return parts.join(" · ");
}

function defaultMetrics(ctx: DealContext): MetricCell[] {
  const ppu = ctx.pricePerUnit
    ?? (ctx.purchasePrice && ctx.unitCount ? ctx.purchasePrice / ctx.unitCount : null);

  return [
    {
      label: "Purchase Price",
      value: fmtUSDShort(ctx.purchasePrice),
      note: ppu ? `${fmtUSDShort(ppu)} / unit` : "",
      variant: "default",
    },
    {
      label: "Going-In Cap",
      value: fmtPct(ctx.goingInCap),
      note: "on T-12 NOI",
      variant: "default",
    },
    {
      label: "Stabilized YOC",
      value: fmtPct(ctx.stabilizedYOC),
      note: "post-stabilization",
      variant: "stabilized",
    },
    {
      label: "Levered IRR",
      value: fmtPct(ctx.leveredIRR),
      note:
        ctx.holdPeriod && ctx.equityMultiple
          ? `${ctx.holdPeriod}-yr hold · ${ctx.equityMultiple.toFixed(1)}x EM`
          : ctx.holdPeriod
          ? `${ctx.holdPeriod}-yr hold`
          : "",
      variant: "stabilized",
    },
  ];
}

function head(number: string, headlineHtml: string, tag: string): SectionHeadProps {
  return { number, headlineHtml, tag };
}

/**
 * Deal code — "CMT-2026-04" style. Derived from deal name initials +
 * prepared date month/year.
 */
export function makeDealCode(dealName: string, preparedDate: Date): string {
  const initials = dealName
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => /[A-Za-z]/.test(c ?? ""))
    .slice(0, 3)
    .join("")
    .toUpperCase() || "DEAL";
  const yyyy = preparedDate.getFullYear();
  const mm = String(preparedDate.getMonth() + 1).padStart(2, "0");
  return `${initials}-${yyyy}-${mm}`;
}

// ─── Main mapper ────────────────────────────────────────────────────────────

export interface MapperOptions {
  preparedDate?: Date;
  dealCode?: string;
  kicker?: string;
  brandLeft?: string;
  brandRight?: string;
  capitalSources?: CapitalSource[];
  metrics?: MetricCell[];
}

export function buildIcPackage(
  ctx: DealContext,
  prose: ProseSections,
  opts: MapperOptions = {}
): IcPackage {
  const preparedDate = opts.preparedDate ?? new Date();
  const dealCode = opts.dealCode ?? makeDealCode(ctx.dealName, preparedDate);
  const kicker = opts.kicker ?? "Investment Committee Package · Confidential · Internal Use";
  const brandLeft = opts.brandLeft ?? "DEAL INTELLIGENCE · DJA CO";
  const brandRight = opts.brandRight ?? "CONFIDENTIAL · INTERNAL USE";

  const capitalSources = opts.capitalSources ?? ctx.capitalStack ?? [];
  const metrics = opts.metrics ?? defaultMetrics(ctx);

  return {
    masthead: {
      dealName: ctx.dealName,
      italicWord: pickItalicWord(ctx.dealName),
      kicker,
      dealCode,
      dealSubtitle: subtitleFrom(ctx),
      preparedDate: fmtPreparedDate(preparedDate),
    },
    exec: {
      label: "Investment Thesis",
      headlineHtml: prose.execHeadlineHtml,
      bodyHtml: prose.execBodyHtml,
    },
    metrics,
    sections: {
      marketThesis: {
        head: head("01", "Why <em>now</em>. Why this asset.", "Market Thesis"),
        proseHtml: prose.marketThesisHtml,
        thesisCards: prose.thesisCards,
        callouts: prose.callouts.slice(0, 1),
      },
      capitalStack: {
        head: head("02", "Capital <em>structure</em>.", "Sources & Uses"),
        sources: capitalSources,
        proseHtml: capitalStackNarrative(capitalSources),
      },
      scenarios: {
        head: head("03", "Three <em>scenarios</em>.", "Sensitivity"),
        introHtml:
          "<p>We've modeled three distinct exit scenarios against our base case underwriting. The base case assumes disciplined execution on current underwriting. Upside reflects a normalized market recovery. Downside reflects soft conditions persisting through the hold.</p>",
        scenarios: prose.scenarios,
        callouts: prose.callouts.slice(1, 2),
      },
      businessPlan: {
        head: head("04", "The <em>business plan</em>.", "Execution"),
        phases: prose.businessPlan,
      },
      risks: {
        head: head("05", "What we're <em>worried</em> about.", "Risk Factors"),
        blockHeadlineHtml: `${prose.risks.length} risks. <em>Honestly named.</em>`,
        blockSubtitle: "What could go wrong, and how we've mitigated it",
        risks: prose.risks,
      },
      ask: {
        head: head("06", "The <em>ask</em>.", "Decision Required"),
        paragraphsHtml: prose.askParagraphsHtml,
      },
    },
    footer: { dealCode, brandLeft, brandRight },
  };
}

/**
 * Minimal fallback narrative for the capital stack section when the LLM
 * doesn't supply one. Prefer LLM-generated prose when available.
 */
function capitalStackNarrative(sources: CapitalSource[]): string {
  if (!sources || sources.length === 0) {
    return "<p>Capital stack details to be finalized prior to IC review.</p>";
  }
  const total = sources.reduce((s, x) => s + x.amount, 0);
  const debt = sources.find((s) => /debt|bridge|loan|senior|mezz/i.test(s.type)) ?? sources[0];
  return (
    `<p>Total capitalization of ${fmtUSDShort(total)} across ${sources.length} sources. ` +
    `The ${debt.name.toLowerCase()} anchors the stack at ${fmtPct(debt.percentage)} of cap, ` +
    "with equity structured to align GP and LP incentives through stabilization and exit.</p>"
  );
}
