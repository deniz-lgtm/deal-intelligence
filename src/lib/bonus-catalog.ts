/**
 * Shared catalog of density / affordability bonus & incentive programs.
 *
 * The Site & Zoning page renders one clickable card per entry. Clicking a
 * card "spots" the program — it's appended to
 * `zoning_info.density_bonuses` on the underwriting blob.
 *
 * Each card may also declare STRUCTURED EFFECTS that the Programming page
 * can apply to the project with a single click:
 *
 *   • affordability_tier  — creates an AMI tier (ami_pct + units_pct).
 *   • tax_exemption       — turns on property-tax exemption for the
 *                           affordable share with a given pct / years / type.
 *   • density_bonus_pct   — informational headline for the card; NOT
 *                           auto-applied to FAR/massing (too many other
 *                           inputs feed FAR — we surface the number and
 *                           let the analyst bump it explicitly).
 *
 * `applySummary` is a one-line human description of what "Apply" will do.
 * Keep it short — it's rendered as a caption on the Apply button.
 *
 * Cards are matched back to spotted rows by `source` — keep those strings
 * stable across releases.
 */

export interface BonusCardEffects {
  affordability_tier?: {
    ami_pct: number;
    units_pct: number;
  };
  tax_exemption?: {
    pct: number;     // % reduction in property tax
    years: number;   // how many years the exemption lasts
    type: string;    // "lihtc" | "welfare_exemption" | "local_abatement" | "pilot" | "421a" | "other"
  };
  density_bonus_pct?: number; // informational headline only
  applySummary?: string;
}

export interface BonusCard {
  source: string;
  description: string;
  additional_density: string;
  effects?: BonusCardEffects;
}

export const BONUS_CATALOG: BonusCard[] = [
  {
    source: "CA Density Bonus Law",
    description:
      "State density bonus for providing affordable units. Incentives scale with the % of units affordable and the AMI target.",
    additional_density: "+20% to +50% units",
    effects: {
      affordability_tier: { ami_pct: 50, units_pct: 15 },
      density_bonus_pct: 35,
      applySummary: "Adds 15% @ 50% AMI tier",
    },
  },
  {
    source: "SB 35 (CA)",
    description:
      "Streamlined ministerial approval when the project includes at least 10% (or 50%) affordable units in a jurisdiction behind its RHNA.",
    additional_density: "By-right",
    effects: {
      affordability_tier: { ami_pct: 80, units_pct: 10 },
      applySummary: "Adds 10% @ 80% AMI tier",
    },
  },
  {
    source: "CCHS (Citywide Commercial-Corridor Housing Services)",
    description:
      "Allows residential use by-right in qualifying commercial corridors, bypassing rezone timelines.",
    additional_density: "By-right residential",
    // No auto-applied effects — entitlement pathway only.
  },
  {
    source: "LIHTC 9% (100% affordable)",
    description:
      "Competitive Low-Income Housing Tax Credit — roughly 70% of eligible basis over 10 years. Typically paired with a 100% affordable tier structure.",
    additional_density: "Equity ~70% basis",
    effects: {
      affordability_tier: { ami_pct: 60, units_pct: 100 },
      tax_exemption: { pct: 100, years: 55, type: "lihtc" },
      applySummary: "100% @ 60% AMI tier · 100% tax exemption (55 yrs)",
    },
  },
  {
    source: "LIHTC 4% (100% affordable)",
    description:
      "Non-competitive 4% LIHTC paired with tax-exempt bonds. ~30% of eligible basis over 10 years.",
    additional_density: "Equity ~30% basis",
    effects: {
      affordability_tier: { ami_pct: 60, units_pct: 100 },
      tax_exemption: { pct: 100, years: 55, type: "lihtc" },
      applySummary: "100% @ 60% AMI tier · 100% tax exemption (55 yrs)",
    },
  },
  {
    source: "421-a (NYC)",
    description:
      "NYC property tax exemption for new multifamily with affordable set-asides. Terms vary by option (A–G).",
    additional_density: "Tax abatement 25–35 yrs",
    effects: {
      affordability_tier: { ami_pct: 80, units_pct: 25 },
      tax_exemption: { pct: 100, years: 35, type: "421a" },
      applySummary: "25% @ 80% AMI tier · 100% tax exemption (35 yrs)",
    },
  },
  {
    source: "J-51 (NYC)",
    description:
      "NYC tax abatement + exemption for substantial rehab or conversion projects that add regulated affordable units.",
    additional_density: "Tax abatement",
    effects: {
      tax_exemption: { pct: 100, years: 34, type: "local_abatement" },
      applySummary: "100% tax exemption (34 yrs)",
    },
  },
  {
    source: "Local Inclusionary Zoning",
    description:
      "Jurisdiction-specific inclusionary ordinance — typically 10%–20% of units at 50%–80% AMI with optional in-lieu fee.",
    additional_density: "Varies by city",
    effects: {
      affordability_tier: { ami_pct: 80, units_pct: 20 },
      applySummary: "Adds 20% @ 80% AMI tier",
    },
  },
  {
    source: "Opportunity Zone",
    description:
      "Federal OZ tax benefits: deferred capital-gains recognition + 10-year basis step-up on the replacement investment.",
    additional_density: "Tax deferral",
    // OZ affects investor-level tax, not property-level — no tier or
    // property-tax effects to apply. Informational.
  },
  {
    source: "HUD 221(d)(4)",
    description:
      "FHA-insured construction/rehab loan — up to 40-year fixed-rate non-recourse financing for market-rate or affordable MF.",
    additional_density: "Debt 83.3% LTV",
    // Debt program — no tier/exemption effects. Informational.
  },
  {
    source: "PILOT Agreement",
    description:
      "Payment In Lieu Of Taxes — negotiated reduced property-tax payments for projects with affordable set-asides.",
    additional_density: "Tax reduction",
    effects: {
      tax_exemption: { pct: 80, years: 30, type: "pilot" },
      applySummary: "80% tax reduction (30 yrs)",
    },
  },
  {
    source: "SB 330 (CA)",
    description:
      "Housing Crisis Act — caps approval timelines and locks in the rules in effect when a preliminary application is filed.",
    additional_density: "Entitlement shield",
    // Entitlement pathway — no auto-applied effects.
  },
];

/** Look up a catalog card by its `source` name. */
export function findBonusCard(source: string): BonusCard | undefined {
  return BONUS_CATALOG.find((b) => b.source === source);
}
