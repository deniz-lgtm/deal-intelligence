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
  }>;
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
      entitlement_tasks: [
        { label: "SB 35 Eligibility Letter", duration_days: 14 },
        { label: "Preliminary Application (SB 330 lock-in)", duration_days: 14 },
        { label: "SB 35 Ministerial Filing", duration_days: 30 },
        { label: "Objective Design Review", duration_days: 60 },
        { label: "Ministerial Permit Issuance", duration_days: 90 },
      ],
    },
  },
  {
    source: "CCHS (Citywide Commercial-Corridor Housing Services)",
    description:
      "Allows residential use by-right in qualifying commercial corridors, bypassing rezone timelines.",
    additional_density: "By-right residential",
    effects: {
      entitlement_tasks: [
        { label: "CCHS Eligibility Verification", duration_days: 14 },
        { label: "CCHS Ministerial Filing", duration_days: 30 },
        { label: "Planning Department Objective Review", duration_days: 60 },
        { label: "Ministerial Permit Issuance", duration_days: 60 },
      ],
      applySummary: "Adds 4 CCHS entitlement tasks",
    },
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
    effects: {
      entitlement_tasks: [
        { label: "SB 330 Preliminary Application", duration_days: 14 },
        { label: "Vesting Lock-In Confirmation", duration_days: 30 },
        { label: "Discretionary Review (max 5 hearings)", duration_days: 120 },
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
 * Default entitlement tasks that apply to just about any discretionary
 * ground-up approval regardless of which programs are spotted. The
 * "Seed Entitlement Tasks" button seeds these alongside whatever the
 * spotted bonuses contribute.
 *
 * Durations are conservative placeholders — analysts should tailor them
 * to their jurisdiction after seeding.
 */
export const DEFAULT_ENTITLEMENT_TASKS: Array<{
  label: string;
  duration_days: number;
}> = [
  { label: "Pre-Application Meeting", duration_days: 14 },
  { label: "Community / Neighborhood Outreach", duration_days: 30 },
  { label: "Project Application Submittal", duration_days: 30 },
  { label: "Environmental Review (CEQA/NEPA)", duration_days: 120 },
  { label: "Design Review Board", duration_days: 45 },
  { label: "Planning Commission Hearing", duration_days: 30 },
  { label: "City Council Hearing", duration_days: 30 },
  { label: "Building Permit Issuance", duration_days: 60 },
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
  tasks: Array<{ label: string; duration_days: number }>;
}

export const ENTITLEMENT_SCENARIOS: EntitlementScenario[] = [
  {
    key: "by_right",
    label: "By-Right (Ministerial)",
    description:
      "No discretionary review — administrative checks and the building permit. Project conforms to zoning; staff approves at counter.",
    tasks: [
      { label: "Zoning Verification Letter", duration_days: 14 },
      { label: "Building Permit Submittal", duration_days: 30 },
      { label: "Plan Check & Corrections", duration_days: 45 },
      { label: "Building Permit Issuance", duration_days: 30 },
    ],
  },
  {
    key: "ministerial_streamlined",
    label: "Streamlined Ministerial (SB 35 / CCHS)",
    description:
      "State / local streamlining — no hearings, objective standards, fixed clock. Requires program eligibility.",
    tasks: [
      { label: "Eligibility / Pre-Application Filing", duration_days: 14 },
      { label: "Objective Standards Checklist", duration_days: 21 },
      { label: "Ministerial Permit Application", duration_days: 30 },
      { label: "Objective Design Review", duration_days: 60 },
      { label: "Plan Check & Corrections", duration_days: 45 },
      { label: "Building Permit Issuance", duration_days: 60 },
    ],
  },
  {
    key: "minor_discretionary",
    label: "Minor Discretionary (Admin Use Permit)",
    description:
      "Administrative use permit or minor modification — staff-level decision with public notice but no hearing.",
    tasks: [
      { label: "Pre-Application Meeting", duration_days: 14 },
      { label: "Use Permit Application", duration_days: 30 },
      { label: "Public Notice Period", duration_days: 14 },
      { label: "Design Review (Staff)", duration_days: 30 },
      { label: "Administrative Decision", duration_days: 14 },
      { label: "Appeal Window", duration_days: 14 },
      { label: "Building Permit Submittal", duration_days: 30 },
      { label: "Building Permit Issuance", duration_days: 45 },
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
      { label: "Pre-Application Meeting", duration_days: 21 },
      { label: "Community / Neighborhood Outreach", duration_days: 60 },
      { label: "Application: Rezone + GPA + Entitlements", duration_days: 45 },
      { label: "Environmental Review (EIR likely)", duration_days: 180 },
      { label: "Design Review Board", duration_days: 45 },
      { label: "Planning Commission Hearing", duration_days: 45 },
      { label: "City Council — First Reading", duration_days: 30 },
      { label: "City Council — Second Reading / Adoption", duration_days: 30 },
      { label: "Ordinance Effective Date", duration_days: 30 },
      { label: "Building Permit Submittal", duration_days: 30 },
      { label: "Building Permit Issuance", duration_days: 60 },
    ],
  },
  {
    key: "specific_plan",
    label: "Specific Plan / Planned Development",
    description:
      "Master plan framework (SP / PD) approved first, individual permits follow. Best for phased or campus-scale projects.",
    tasks: [
      { label: "Pre-Application Meeting", duration_days: 21 },
      { label: "Specific Plan Preparation", duration_days: 120 },
      { label: "Community / Neighborhood Outreach", duration_days: 90 },
      { label: "Environmental Review (Program EIR)", duration_days: 240 },
      { label: "Specific Plan Adoption — Planning Commission", duration_days: 45 },
      { label: "Specific Plan Adoption — City Council", duration_days: 45 },
      { label: "Phase Implementation Permit", duration_days: 60 },
      { label: "Building Permit Submittal", duration_days: 30 },
      { label: "Building Permit Issuance", duration_days: 60 },
    ],
  },
  {
    key: "coastal_ca",
    label: "Coastal (CA Coastal Commission)",
    description:
      "Within California's coastal zone — Coastal Development Permit layered on top of standard discretionary review. Adds significant calendar risk.",
    tasks: [
      { label: "Pre-Application Meeting", duration_days: 14 },
      { label: "Community / Neighborhood Outreach", duration_days: 30 },
      { label: "Project Application Submittal", duration_days: 30 },
      { label: "Environmental Review (CEQA)", duration_days: 120 },
      { label: "Coastal Development Permit Application", duration_days: 30 },
      { label: "Coastal Commission Staff Review", duration_days: 60 },
      { label: "Coastal Commission Hearing", duration_days: 60 },
      { label: "Design Review Board", duration_days: 45 },
      { label: "Planning Commission Hearing", duration_days: 30 },
      { label: "City Council Hearing", duration_days: 30 },
      { label: "Building Permit Issuance", duration_days: 60 },
    ],
  },
  {
    key: "historic_review",
    label: "Historic / Preservation Review",
    description:
      "Project affects a historic resource or district — adds Historic Review Board / SHPO review on top of standard discretionary.",
    tasks: [
      { label: "Pre-Application Meeting", duration_days: 14 },
      { label: "Historic Resources Assessment", duration_days: 45 },
      { label: "Community / Neighborhood Outreach", duration_days: 30 },
      { label: "Project Application Submittal", duration_days: 30 },
      { label: "Environmental Review (CEQA)", duration_days: 120 },
      { label: "Historic Review Board Hearing", duration_days: 45 },
      { label: "SHPO Consultation (if federal nexus)", duration_days: 60 },
      { label: "Design Review Board", duration_days: 45 },
      { label: "Planning Commission Hearing", duration_days: 30 },
      { label: "City Council Hearing", duration_days: 30 },
      { label: "Building Permit Issuance", duration_days: 60 },
    ],
  },
];

/** Look up an entitlement scenario by its `key`. */
export function findEntitlementScenario(key: string): EntitlementScenario | undefined {
  return ENTITLEMENT_SCENARIOS.find((s) => s.key === key);
}
