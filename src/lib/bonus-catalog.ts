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
  /**
   * Entitlement-pathway programs (SB 35, CCHS, SB 330, etc.) usually
   * come with specific filings / reviews the analyst needs to track
   * during the entitlement phase. When a card is spotted and the
   * analyst clicks "Seed Entitlement Tasks" on the Development
   * Schedule, these become child phases of "Entitlements & Permits".
   */
  entitlement_tasks?: Array<{
    label: string;
    duration_days?: number;
    category?: TaskCategory;
  }>;
  applySummary?: string;
}

// Jurisdictional scope of the program. Used to label each card so analysts
// can quickly see whether a program is available nationally, restricted to
// a state, or a city/local ordinance.
export type BonusScope = "federal" | "state" | "regional" | "local";

export interface BonusCard {
  source: string;
  description: string;
  additional_density: string;
  effects?: BonusCardEffects;
  scope: BonusScope;
  jurisdiction: string;
  details: string;
  // US state abbreviations where this program is available (e.g. ["CA"],
  // ["NY"]). Omit for federal programs and broadly-local programs that
  // exist in many jurisdictions (e.g. "Local Inclusionary Zoning",
  // "PILOT Agreement"). The Site & Zoning page uses this to pre-classify
  // cards as "Doesn't Apply" when the deal's state doesn't match —
  // before the AI report has a chance to run. Users can still override.
  applicableStates?: string[];
}

export const BONUS_CATALOG: BonusCard[] = [
  {
    source: "CA Density Bonus Law",
    description:
      "State density bonus for providing affordable units. Incentives scale with the % of units affordable and the AMI target.",
    additional_density: "+20% to +50% units",
    scope: "state",
    jurisdiction: "California",
    applicableStates: ["CA"],
    details:
      "Gov. Code §65915. Grants a density bonus, concessions/incentives, waivers of development standards, and reduced parking in exchange for providing a minimum share of affordable units on site. The bonus sizing scales with both the percentage of affordable units and the AMI tier targeted (Very Low, Low, Moderate, or 100% affordable). Recent amendments (AB 1287, AB 2334) stack additional bonuses for projects serving Very Low Income or 100% affordable projects in high-resource areas, and can take the total bonus to +80% or more. Applies to residential projects of 5+ units.",
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
    scope: "state",
    jurisdiction: "California",
    applicableStates: ["CA"],
    details:
      "Gov. Code §65913.4. Provides streamlined, ministerial (non-discretionary, no CEQA) approval for multifamily projects that meet objective standards in jurisdictions that have not met their RHNA targets. The affordable threshold is 10% of units for most jurisdictions behind on above-moderate RHNA, or 50% for those behind on lower-income RHNA. Labor standards (prevailing wage, skilled-and-trained workforce for large projects) apply. Extended and expanded by SB 423 through 2036.",
    effects: {
      affordability_tier: { ami_pct: 80, units_pct: 10 },
      applySummary: "Adds 10% @ 80% AMI tier",
      entitlement_tasks: [
        { label: "SB 35 Eligibility Letter",                 duration_days: 14, category: "pre_submittal" },
        { label: "Preliminary Application (SB 330 lock-in)", duration_days: 14, category: "pre_submittal" },
        { label: "SB 35 Ministerial Filing",                 duration_days: 30, category: "pre_submittal" },
        { label: "Objective Design Review",                  duration_days: 60, category: "review" },
        { label: "Ministerial Permit Issuance",              duration_days: 90, category: "permit" },
      ],
    },
  },
  {
    source: "CCHS (Citywide Commercial-Corridor Housing Services)",
    description:
      "Allows residential use by-right in qualifying commercial corridors, bypassing rezone timelines.",
    additional_density: "By-right residential",
    scope: "local",
    jurisdiction: "Varies by city",
    details:
      "Local overlay programs (sometimes branded differently per city) that permit housing by-right on commercial-corridor parcels that would otherwise require a rezone or conditional use permit. Typical benefits: residential as a permitted use, relaxed FAR/height, reduced or no parking minimums. Analysts should verify the specific ordinance in the jurisdiction — eligibility often depends on lot size, frontage type, and transit proximity.",
    effects: {
      entitlement_tasks: [
        { label: "CCHS Eligibility Verification",        duration_days: 14, category: "pre_submittal" },
        { label: "CCHS Ministerial Filing",              duration_days: 30, category: "pre_submittal" },
        { label: "Planning Department Objective Review", duration_days: 60, category: "review" },
        { label: "Ministerial Permit Issuance",          duration_days: 60, category: "permit" },
      ],
      applySummary: "Adds 4 CCHS entitlement tasks",
    },
  },
  {
    source: "LIHTC 9% (100% affordable)",
    description:
      "Competitive Low-Income Housing Tax Credit — roughly 70% of eligible basis over 10 years. Typically paired with a 100% affordable tier structure.",
    additional_density: "Equity ~70% basis",
    scope: "federal",
    jurisdiction: "Federal (administered by states)",
    details:
      "IRC §42. Competitive 9% LIHTC credits are allocated by each state's housing finance agency through a Qualified Allocation Plan (QAP). The credit delivers roughly 70% of a project's eligible basis as equity, claimed by investors over 10 years. In exchange, 100% of units (typical structure) are income-restricted at 60% AMI or below for a 15-year compliance period plus a 15-year extended-use period (30 years minimum; often extended to 55 in CA and other states). QAP scoring usually favors deep affordability, tenant services, and location criteria.",
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
    scope: "federal",
    jurisdiction: "Federal (administered by states)",
    details:
      "IRC §42. The 4% credit is non-competitive but requires the project to be financed with tax-exempt Private Activity Bonds (PABs). The credit delivers roughly 30% of eligible basis as equity over 10 years. As with 9% LIHTC, 100% of units are typically income-restricted at 60% AMI or below. PAB volume cap availability is the main constraint — in supply-constrained states analysts should check recent allocation trends. Often paired with soft debt, seller carryback, or state/local subsidies to fill the gap.",
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
    scope: "local",
    jurisdiction: "New York City",
    applicableStates: ["NY"],
    details:
      "RPTL §421-a. Partial property-tax exemption on new multifamily construction that meets affordability set-asides. The program sunset for new construction starting after June 2022, but a successor (485-x / Affordable Neighborhoods for New Yorkers) was enacted in 2024. Existing 421-a projects under options A–G continue their benefit schedule (typically 25–35 years of exemption, phasing out at the end). Affordability requirements range from 25% @ 80% AMI (Option A) to deeper set-asides for larger projects.",
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
    scope: "local",
    jurisdiction: "New York City",
    applicableStates: ["NY"],
    details:
      "NYC Admin Code §11-243. Property-tax abatement (offsets rehab costs) plus exemption (freezes assessed value) for qualifying renovation, conversion, or moderate/gut rehab projects that bring units into rent regulation. The original J-51 lapsed in 2022; a replacement program (J-51 Reform, enacted 2024) restarted eligibility with updated income and affordability criteria. Benefits typically run up to 34 years.",
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
    scope: "local",
    jurisdiction: "Varies by city",
    details:
      "City- or county-level ordinance that requires new market-rate housing to include a share of on-site affordable units, with some ordinances allowing an in-lieu fee or off-site construction instead. Typical parameters: 10–20% of units at 50–80% AMI, 30–55 year affordability term, modest density bonuses or fee waivers as offsets. Analysts should check the specific ordinance for the jurisdiction — requirements vary widely (SF, LA, NYC, Boston, Seattle all differ substantially).",
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
    scope: "federal",
    jurisdiction: "Federal",
    details:
      "IRC §§1400Z-1 & 1400Z-2. Investors roll capital gains into a Qualified Opportunity Fund (QOF) that invests in Qualified Opportunity Zone (QOZ) property. Benefits: (1) deferral of the rolled-in gain until Dec 31, 2026; (2) a 10%/15% basis step-up if held 5/7 years by that date (now largely expired for new investments); (3) tax-free appreciation on the QOZ investment if held 10+ years. Property must satisfy the substantial-improvement test — basis doubled within 30 months for acquired buildings. Only relevant for deals in designated census tracts.",
    // OZ affects investor-level tax, not property-level — no tier or
    // property-tax effects to apply. Informational.
  },
  {
    source: "HUD 221(d)(4)",
    description:
      "FHA-insured construction/rehab loan — up to 40-year fixed-rate non-recourse financing for market-rate or affordable MF.",
    additional_density: "Debt 83.3% LTV",
    scope: "federal",
    jurisdiction: "Federal (HUD)",
    details:
      "Section 221(d)(4) of the National Housing Act. FHA-insured loan for new construction or substantial rehab of multifamily rental housing (affordable or market-rate). Terms: up to 83.3% LTC market-rate / 87% affordable, 40-year amortization after construction, fixed-rate and fully assumable. Davis-Bacon prevailing wage applies. Long processing timelines (12+ months) are a common tradeoff for the attractive terms.",
    // Debt program — no tier/exemption effects. Informational.
  },
  {
    source: "PILOT Agreement",
    description:
      "Payment In Lieu Of Taxes — negotiated reduced property-tax payments for projects with affordable set-asides.",
    additional_density: "Tax reduction",
    scope: "local",
    jurisdiction: "Varies by city/county",
    details:
      "A negotiated agreement between a developer/owner and a local taxing authority (often through an Industrial Development Agency, Housing Authority, or similar) in which the project makes a scheduled payment in lieu of standard ad valorem property taxes. Terms vary widely but commonly: a capped payment schedule for 20–40 years, stepped increases over time, and affordability set-asides or other public-benefit conditions. The underwriting impact depends on the negotiated schedule vs. the but-for property-tax bill.",
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
    scope: "state",
    jurisdiction: "California",
    applicableStates: ["CA"],
    details:
      "Gov. Code §65589.5 / §65941.1. The Housing Crisis Act of 2019 (extended through 2030 by SB 8) caps the number of public hearings (max 5), caps processing time, prohibits downzoning housing sites, and — most powerfully — vests a project under the ordinances, policies, and standards in effect at the time a Preliminary Application (SB 330 App) is filed. This protects against hostile mid-entitlement zoning changes. Applies to projects with 2/3 residential use.",
    effects: {
      entitlement_tasks: [
        { label: "SB 330 Preliminary Application",        duration_days: 14,  category: "pre_submittal" },
        { label: "Vesting Lock-In Confirmation",          duration_days: 30,  category: "pre_submittal" },
        { label: "Discretionary Review (max 5 hearings)", duration_days: 120, category: "approval" },
      ],
      applySummary: "Adds 3 SB 330 entitlement tasks",
    },
  },
];

/** Look up a catalog card by its `source` name. */
export function findBonusCard(source: string): BonusCard | undefined {
  return BONUS_CATALOG.find((b) => b.source === source);
}

/**
 * Given the deal's US state abbreviation (e.g. "CA", "NY"), return a
 * default applicability map for every catalog card.  State/local
 * programs that don't match the deal's state get "not_applicable";
 * everything else gets "may_apply". The map is used as the fallback
 * before the AI report has run — once the AI returns
 * `bonus_applicability`, those values take precedence.
 */
export function defaultApplicability(
  dealState?: string | null
): Record<string, "applies" | "may_apply" | "not_applicable"> {
  const norm = (dealState || "").toUpperCase().trim();
  const out: Record<string, "applies" | "may_apply" | "not_applicable"> = {};
  for (const card of BONUS_CATALOG) {
    if (card.applicableStates && card.applicableStates.length > 0 && norm) {
      out[card.source] = card.applicableStates.includes(norm) ? "may_apply" : "not_applicable";
    } else {
      out[card.source] = "may_apply";
    }
  }
  return out;
}

import type { TaskCategory } from "./types";

/**
 * Default entitlement tasks that apply to just about any discretionary
 * ground-up approval regardless of which programs are spotted. The
 * "Seed Entitlement Tasks" button seeds these alongside whatever the
 * spotted bonuses contribute.
 *
 * Durations are conservative placeholders — analysts should tailor them
 * to their jurisdiction after seeding.
 */
export interface EntitlementTaskDef {
  label: string;
  duration_days: number;
  category?: TaskCategory;
}

export const DEFAULT_ENTITLEMENT_TASKS: EntitlementTaskDef[] = [
  { label: "Pre-Application Meeting",             duration_days: 14,  category: "pre_submittal" },
  { label: "Community / Neighborhood Outreach",   duration_days: 30,  category: "pre_submittal" },
  { label: "Project Application Submittal",       duration_days: 30,  category: "pre_submittal" },
  { label: "Environmental Review (CEQA/NEPA)",    duration_days: 120, category: "review" },
  { label: "Design Review Board",                 duration_days: 45,  category: "review" },
  { label: "Planning Commission Hearing",         duration_days: 30,  category: "approval" },
  { label: "City Council Hearing",                duration_days: 30,  category: "approval" },
  { label: "Building Permit Issuance",            duration_days: 60,  category: "permit" },
];

/**
 * Entitlement scenario presets — each one captures a typical approval
 * pathway. The analyst picks one as the starting point, then edits /
 * adds / removes tasks as their jurisdiction requires.
 *
 * Spotted bonus cards (SB 35, CCHS, SB 330) still merge program-specific
 * filings on top of the selected scenario.
 *
 * Keep the `key` stable across releases so deep-link / future template
 * features can reference a scenario by id.
 */
export interface EntitlementScenario {
  key: string;
  label: string;
  description: string;
  tasks: EntitlementTaskDef[];
}

export const ENTITLEMENT_SCENARIOS: EntitlementScenario[] = [
  {
    key: "by_right",
    label: "By-Right (Ministerial)",
    description:
      "No discretionary review — administrative checks and the building permit. Project conforms to zoning; staff approves at counter.",
    tasks: [
      { label: "Zoning Verification Letter",   duration_days: 14, category: "pre_submittal" },
      { label: "Building Permit Submittal",     duration_days: 30, category: "permit" },
      { label: "Plan Check & Corrections",      duration_days: 45, category: "review" },
      { label: "Building Permit Issuance",      duration_days: 30, category: "permit" },
    ],
  },
  {
    key: "ministerial_streamlined",
    label: "Streamlined Ministerial (SB 35 / CCHS)",
    description:
      "State / local streamlining — no hearings, objective standards, fixed clock. Requires program eligibility.",
    tasks: [
      { label: "Eligibility / Pre-Application Filing", duration_days: 14, category: "pre_submittal" },
      { label: "Objective Standards Checklist",         duration_days: 21, category: "pre_submittal" },
      { label: "Ministerial Permit Application",        duration_days: 30, category: "pre_submittal" },
      { label: "Objective Design Review",               duration_days: 60, category: "review" },
      { label: "Plan Check & Corrections",              duration_days: 45, category: "review" },
      { label: "Building Permit Issuance",              duration_days: 60, category: "permit" },
    ],
  },
  {
    key: "minor_discretionary",
    label: "Minor Discretionary (Admin Use Permit)",
    description:
      "Administrative use permit or minor modification — staff-level decision with public notice but no hearing.",
    tasks: [
      { label: "Pre-Application Meeting",     duration_days: 14, category: "pre_submittal" },
      { label: "Use Permit Application",      duration_days: 30, category: "pre_submittal" },
      { label: "Public Notice Period",        duration_days: 14, category: "review" },
      { label: "Design Review (Staff)",       duration_days: 30, category: "review" },
      { label: "Administrative Decision",     duration_days: 14, category: "approval" },
      { label: "Appeal Window",               duration_days: 14, category: "approval" },
      { label: "Building Permit Submittal",   duration_days: 30, category: "permit" },
      { label: "Building Permit Issuance",    duration_days: 45, category: "permit" },
    ],
  },
  {
    key: "major_discretionary",
    label: "Major Discretionary (Full Review)",
    description:
      "Standard discretionary approval — pre-app, CEQA, DRB, Planning Commission, City Council. The default for most value-add / ground-up projects.",
    tasks: DEFAULT_ENTITLEMENT_TASKS,
  },
  {
    key: "rezone_gpa",
    label: "Rezone / General Plan Amendment",
    description:
      "Requires legislative action — General Plan or zoning map change on top of the standard discretionary path. Longer timeline, higher risk.",
    tasks: [
      { label: "Pre-Application Meeting",                  duration_days: 21,  category: "pre_submittal" },
      { label: "Community / Neighborhood Outreach",        duration_days: 60,  category: "pre_submittal" },
      { label: "Application: Rezone + GPA + Entitlements", duration_days: 45,  category: "pre_submittal" },
      { label: "Environmental Review (EIR likely)",         duration_days: 180, category: "review" },
      { label: "Design Review Board",                      duration_days: 45,  category: "review" },
      { label: "Planning Commission Hearing",              duration_days: 45,  category: "approval" },
      { label: "City Council — First Reading",             duration_days: 30,  category: "approval" },
      { label: "City Council — Second Reading / Adoption", duration_days: 30,  category: "approval" },
      { label: "Ordinance Effective Date",                 duration_days: 30,  category: "approval" },
      { label: "Building Permit Submittal",                duration_days: 30,  category: "permit" },
      { label: "Building Permit Issuance",                 duration_days: 60,  category: "permit" },
    ],
  },
  {
    key: "specific_plan",
    label: "Specific Plan / Planned Development",
    description:
      "Master plan framework (SP / PD) approved first, individual permits follow. Best for phased or campus-scale projects.",
    tasks: [
      { label: "Pre-Application Meeting",                    duration_days: 21,  category: "pre_submittal" },
      { label: "Specific Plan Preparation",                   duration_days: 120, category: "pre_submittal" },
      { label: "Community / Neighborhood Outreach",           duration_days: 90,  category: "pre_submittal" },
      { label: "Environmental Review (Program EIR)",          duration_days: 240, category: "review" },
      { label: "Specific Plan Adoption — Planning Commission", duration_days: 45, category: "approval" },
      { label: "Specific Plan Adoption — City Council",        duration_days: 45, category: "approval" },
      { label: "Phase Implementation Permit",                 duration_days: 60,  category: "permit" },
      { label: "Building Permit Submittal",                   duration_days: 30,  category: "permit" },
      { label: "Building Permit Issuance",                    duration_days: 60,  category: "permit" },
    ],
  },
  {
    key: "coastal_ca",
    label: "Coastal (CA Coastal Commission)",
    description:
      "Within California's coastal zone — Coastal Development Permit layered on top of standard discretionary review. Adds significant calendar risk.",
    tasks: [
      { label: "Pre-Application Meeting",              duration_days: 14,  category: "pre_submittal" },
      { label: "Community / Neighborhood Outreach",    duration_days: 30,  category: "pre_submittal" },
      { label: "Project Application Submittal",        duration_days: 30,  category: "pre_submittal" },
      { label: "Environmental Review (CEQA)",          duration_days: 120, category: "review" },
      { label: "Coastal Development Permit Application", duration_days: 30, category: "pre_submittal" },
      { label: "Coastal Commission Staff Review",      duration_days: 60,  category: "review" },
      { label: "Coastal Commission Hearing",           duration_days: 60,  category: "approval" },
      { label: "Design Review Board",                  duration_days: 45,  category: "review" },
      { label: "Planning Commission Hearing",          duration_days: 30,  category: "approval" },
      { label: "City Council Hearing",                 duration_days: 30,  category: "approval" },
      { label: "Building Permit Issuance",             duration_days: 60,  category: "permit" },
    ],
  },
  {
    key: "historic_review",
    label: "Historic / Preservation Review",
    description:
      "Project affects a historic resource or district — adds Historic Review Board / SHPO review on top of standard discretionary.",
    tasks: [
      { label: "Pre-Application Meeting",             duration_days: 14,  category: "pre_submittal" },
      { label: "Historic Resources Assessment",        duration_days: 45,  category: "pre_submittal" },
      { label: "Community / Neighborhood Outreach",    duration_days: 30,  category: "pre_submittal" },
      { label: "Project Application Submittal",        duration_days: 30,  category: "pre_submittal" },
      { label: "Environmental Review (CEQA)",          duration_days: 120, category: "review" },
      { label: "Historic Review Board Hearing",        duration_days: 45,  category: "review" },
      { label: "SHPO Consultation (if federal nexus)", duration_days: 60,  category: "review" },
      { label: "Design Review Board",                  duration_days: 45,  category: "review" },
      { label: "Planning Commission Hearing",          duration_days: 30,  category: "approval" },
      { label: "City Council Hearing",                 duration_days: 30,  category: "approval" },
      { label: "Building Permit Issuance",             duration_days: 60,  category: "permit" },
    ],
  },
];

/** Look up an entitlement scenario by its `key`. */
export function findEntitlementScenario(key: string): EntitlementScenario | undefined {
  return ENTITLEMENT_SCENARIOS.find((s) => s.key === key);
}
