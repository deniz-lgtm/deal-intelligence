/**
 * Plain-English summary of a deal's affordability + density-bonus strategy.
 *
 * Pure function — no IO, no React. Takes whatever the analyst has
 * configured in Programming (AffordabilityConfig), any bonus/incentive
 * programs they've "spotted" on Site & Zoning, and returns a few
 * shapes callers can reach for:
 *
 *   • headline — one line ("20% affordable at 60% AMI, +20% density")
 *   • bullets  — short lines for inline rendering in the AMI card
 *   • narrative — 2-3 prose paragraphs for the investment memo
 *
 * Used by:
 *   • src/components/AmiReference.tsx — inline summary in the AMI card
 *     so the analyst sees the deal's own strategy alongside the HUD
 *     tables, not just the abstract tier reference.
 *   • src/app/api/deals/[id]/investment-package/generate-all/route.ts
 *     — seeded into the LLM context for unit_mix, financial_summary,
 *     and risk_factors sections, and the basis for a new dedicated
 *     "Affordability & Incentives" memo section.
 */
type LooseTier = {
  ami_pct?: number;
  units_pct?: number;
  units_count?: number;
  units_studio?: number;
  units_1br?: number;
  units_2br?: number;
  units_3br?: number;
  units_4br_plus?: number;
  max_rent_studio?: number;
  max_rent_1br?: number;
  max_rent_2br?: number;
  max_rent_3br?: number;
  max_rent_4br_plus?: number;
};

export interface LooseAffordabilityConfig {
  enabled?: boolean;
  tiers?: LooseTier[];
  total_units?: number;
  market_rate_units?: number;
  density_bonus_pct?: number;
  density_bonus_source?: string;
  tax_exemption_enabled?: boolean;
  tax_exemption_pct?: number;
  tax_exemption_years?: number;
  tax_exemption_type?: string;
  notes?: string;
}

export interface LooseSpottedBonus {
  source?: string;
  description?: string;
  additional_density?: string;
  enabled?: boolean;
}

export interface AffordabilitySummary {
  /** False when there's nothing affordable configured and no bonuses spotted. */
  enabled: boolean;
  /** One-line headline, e.g. "20 affordable units (20%) at 60% AMI". */
  headline: string;
  /** Short lines suitable for inline UI rendering. */
  bullets: string[];
  /** Prose paragraphs suitable for an investment memo. */
  narrative: string;
}

const fmtPct = (n: number | undefined) =>
  n == null ? "" : `${Math.round(n * 10) / 10}%`;
const fmtInt = (n: number | undefined) =>
  n == null ? "" : Math.round(n).toLocaleString("en-US");
const fmtMoney = (n: number | undefined) =>
  n == null || !isFinite(n) ? "" : `$${Math.round(n).toLocaleString("en-US")}`;

function amiTierLabel(amiPct: number): string {
  if (amiPct <= 30) return `${amiPct}% AMI (Extremely Low Income)`;
  if (amiPct <= 50) return `${amiPct}% AMI (Very Low Income)`;
  if (amiPct === 60) return `60% AMI (LIHTC standard)`;
  if (amiPct <= 80) return `${amiPct}% AMI (Low Income)`;
  if (amiPct <= 100) return `${amiPct}% AMI (Area Median)`;
  return `${amiPct}% AMI (Moderate Income)`;
}

function tierUnitsCount(t: LooseTier): number {
  if (t.units_count && t.units_count > 0) return t.units_count;
  return (
    (t.units_studio || 0) +
    (t.units_1br || 0) +
    (t.units_2br || 0) +
    (t.units_3br || 0) +
    (t.units_4br_plus || 0)
  );
}

function tierWeightedRent(t: LooseTier): number {
  const units = tierUnitsCount(t);
  if (units <= 0) return 0;
  const totalMonthly =
    (t.units_studio || 0) * (t.max_rent_studio || 0) +
    (t.units_1br || 0) * (t.max_rent_1br || 0) +
    (t.units_2br || 0) * (t.max_rent_2br || 0) +
    (t.units_3br || 0) * (t.max_rent_3br || 0) +
    (t.units_4br_plus || 0) * (t.max_rent_4br_plus || 0);
  return totalMonthly / units;
}

function taxExemptionLabel(type: string): string {
  const t = (type || "").toLowerCase();
  if (t === "lihtc") return "LIHTC";
  if (t === "421a") return "421a";
  if (t === "485x") return "485x";
  if (t === "welfare_exemption") return "welfare exemption";
  if (t === "local_abatement") return "local tax abatement";
  if (t === "pilot") return "PILOT";
  return type || "tax exemption";
}

export function summarizeAffordability(input: {
  config?: LooseAffordabilityConfig | null;
  bonuses?: LooseSpottedBonus[];
  /** Optional market-rate rent so the narrative can cite the gap. */
  avgMarketRent?: number;
}): AffordabilitySummary {
  const cfg = input.config || {};
  const rawBonuses = input.bonuses || [];
  // Site & Zoning lets the analyst deactivate a spotted card without
  // deleting it; respect that flag so the summary matches what the deal
  // is actually committing to.
  const bonuses = rawBonuses.filter((b) => b && b.source && b.enabled !== false);

  const tiers = (cfg.tiers || []).filter((t) => tierUnitsCount(t) > 0);
  const affordableUnits = tiers.reduce((s, t) => s + tierUnitsCount(t), 0);
  const totalUnits = cfg.total_units || 0;
  const marketUnits =
    cfg.market_rate_units != null
      ? cfg.market_rate_units
      : Math.max(0, totalUnits - affordableUnits);
  const affordablePct =
    totalUnits > 0 ? (affordableUnits / totalUnits) * 100 : 0;

  const hasAffordability = !!cfg.enabled && affordableUnits > 0;
  const hasBonuses = bonuses.length > 0;
  const hasTax =
    !!cfg.tax_exemption_enabled && (cfg.tax_exemption_pct || 0) > 0;
  const hasDensityBonus = (cfg.density_bonus_pct || 0) > 0;

  if (!hasAffordability && !hasBonuses && !hasTax && !hasDensityBonus) {
    return {
      enabled: false,
      headline: "100% market-rate — no affordability restrictions or public incentives configured.",
      bullets: [],
      narrative:
        "This deal is underwritten as 100% market-rate. No affordable-housing tiers, property-tax exemptions, or density/entitlement bonuses have been configured on the Programming or Site & Zoning pages. Rents are assumed to float to market without AMI caps.",
    };
  }

  // ── Headline ──────────────────────────────────────────────────────────
  let headline: string;
  if (hasAffordability) {
    const tierPcts = tiers
      .map((t) => t.ami_pct || 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const tierLabel =
      tierPcts.length === 0
        ? ""
        : tierPcts.length === 1
        ? `at ${tierPcts[0]}% AMI`
        : `across ${tierPcts.map((p) => `${p}%`).join("/")} AMI`;
    headline = `${fmtInt(affordableUnits)} affordable unit${
      affordableUnits === 1 ? "" : "s"
    } (${fmtPct(affordablePct)}) ${tierLabel}`.trim();
    if (hasDensityBonus) {
      headline += ` with +${fmtPct(cfg.density_bonus_pct)} density`;
    }
    if (hasTax) {
      headline += ` and ${taxExemptionLabel(cfg.tax_exemption_type || "")} tax relief`;
    }
  } else if (hasDensityBonus) {
    headline = `+${fmtPct(cfg.density_bonus_pct)} density bonus via ${
      cfg.density_bonus_source || "an entitlement program"
    }`;
  } else {
    headline = `Public incentives spotted (${bonuses.length}) — no affordability tiers committed yet`;
  }

  // ── Bullets (short lines for inline UI) ───────────────────────────────
  const bullets: string[] = [];
  if (hasAffordability) {
    if (totalUnits > 0) {
      bullets.push(
        `${fmtInt(affordableUnits)} of ${fmtInt(totalUnits)} units affordable (${fmtPct(
          affordablePct
        )}); ${fmtInt(marketUnits)} market-rate`
      );
    } else {
      bullets.push(`${fmtInt(affordableUnits)} affordable units configured`);
    }
    for (const t of tiers) {
      const ami = t.ami_pct || 0;
      const count = tierUnitsCount(t);
      const rent = tierWeightedRent(t);
      const rentLabel = rent > 0 ? ` (avg ${fmtMoney(rent)}/mo)` : "";
      const pctOfTotal =
        totalUnits > 0 ? ` — ${fmtPct((count / totalUnits) * 100)}` : "";
      bullets.push(
        `• ${fmtInt(count)} at ${amiTierLabel(ami)}${pctOfTotal}${rentLabel}`
      );
    }
    if (
      input.avgMarketRent &&
      input.avgMarketRent > 0 &&
      tiers.some((t) => tierWeightedRent(t) > 0)
    ) {
      const weightedAff =
        affordableUnits > 0
          ? tiers.reduce((s, t) => s + tierWeightedRent(t) * tierUnitsCount(t), 0) /
            affordableUnits
          : 0;
      if (weightedAff > 0 && weightedAff < input.avgMarketRent) {
        const discount =
          ((input.avgMarketRent - weightedAff) / input.avgMarketRent) * 100;
        bullets.push(
          `Affordable rents ~${fmtPct(discount)} below market (${fmtMoney(
            weightedAff
          )} vs ${fmtMoney(input.avgMarketRent)}/mo)`
        );
      }
    }
  }
  if (hasTax) {
    bullets.push(
      `Tax exemption: ${fmtPct(cfg.tax_exemption_pct)} for ${fmtInt(
        cfg.tax_exemption_years
      )} years (${taxExemptionLabel(cfg.tax_exemption_type || "")})`
    );
  }
  if (hasDensityBonus) {
    bullets.push(
      `Density bonus: +${fmtPct(cfg.density_bonus_pct)}${
        cfg.density_bonus_source ? ` via ${cfg.density_bonus_source}` : ""
      }`
    );
  }
  if (hasBonuses) {
    bullets.push(
      `Spotted programs: ${bonuses.map((b) => b.source).join(", ")}`
    );
  }
  if (cfg.notes && cfg.notes.trim()) {
    bullets.push(`Notes: ${cfg.notes.trim()}`);
  }

  // ── Narrative (prose for the memo) ────────────────────────────────────
  const paragraphs: string[] = [];

  if (hasAffordability) {
    const tierDescriptions = tiers.map((t) => {
      const count = tierUnitsCount(t);
      const pctOfTotal =
        totalUnits > 0 ? ` (${fmtPct((count / totalUnits) * 100)} of total)` : "";
      return `${fmtInt(count)} unit${
        count === 1 ? "" : "s"
      } at ${amiTierLabel(t.ami_pct || 0)}${pctOfTotal}`;
    });
    let p1 = `The project is underwritten as a mixed-income deal: ${fmtInt(
      marketUnits
    )} of the ${fmtInt(
      totalUnits
    )} total units rent at market, and ${fmtInt(affordableUnits)} units (${fmtPct(
      affordablePct
    )} of the building) are income-restricted. `;
    if (tierDescriptions.length === 1) {
      p1 += `All affordable units sit at a single tier — ${tierDescriptions[0]}. `;
    } else {
      p1 += `The affordable share is split across ${tierDescriptions.length} AMI tiers: ${tierDescriptions.join(
        "; "
      )}. `;
    }
    p1 +=
      "Rent caps are set at HUD's standard 30%-of-income formula using current-year county AMI, and the restricted units reduce both the market-rate revenue base and the tax footprint of the property.";
    paragraphs.push(p1);
  } else if (hasDensityBonus || hasBonuses) {
    paragraphs.push(
      "The project does not include dedicated income-restricted units, but the analyst has identified public incentive programs that affect the entitlement path or cost basis."
    );
  }

  const secondLines: string[] = [];
  if (hasTax) {
    secondLines.push(
      `The deal applies a ${fmtPct(
        cfg.tax_exemption_pct
      )} property-tax exemption for ${fmtInt(
        cfg.tax_exemption_years
      )} years under ${taxExemptionLabel(
        cfg.tax_exemption_type || ""
      )}, pro-rated to the affordable share of units. This flows through the NOI as a direct reduction to ${
        hasAffordability ? "taxes_annual" : "stabilized taxes"
      } in the pro forma.`
    );
  }
  if (hasDensityBonus) {
    secondLines.push(
      `A density bonus of +${fmtPct(cfg.density_bonus_pct)}${
        cfg.density_bonus_source ? ` under ${cfg.density_bonus_source}` : ""
      } increases the entitled unit count above baseline zoning and is the primary justification for the affordable set-aside.`
    );
  }
  if (secondLines.length > 0) paragraphs.push(secondLines.join(" "));

  if (hasBonuses) {
    const programBlurbs = bonuses.map((b) => {
      const tag = b.additional_density ? ` (${b.additional_density})` : "";
      return `${b.source}${tag}`;
    });
    paragraphs.push(
      `Entitlement / incentive programs engaged: ${programBlurbs.join(
        "; "
      )}. These have been flagged on the Site & Zoning page and shape the project's approval path, labor-cost assumptions, and covenant period.`
    );
  }

  if (cfg.notes && cfg.notes.trim()) {
    paragraphs.push(`Analyst notes on affordability strategy: ${cfg.notes.trim()}`);
  }

  const narrative =
    paragraphs.length > 0
      ? paragraphs.join("\n\n")
      : "No affordability strategy configured.";

  return {
    enabled: hasAffordability || hasBonuses || hasTax || hasDensityBonus,
    headline,
    bullets,
    narrative,
  };
}
