// ─── Deal / Property ───────────────────────────────────────────────────────

export type DealStatus =
  | "sourcing"
  | "screening"
  | "loi"
  | "under_contract"
  | "diligence"
  | "closing"
  | "closed"
  | "dead"
  | "archived";

export type PropertyType =
  | "industrial"
  | "office"
  | "retail"
  | "multifamily"
  | "sfr"
  | "student_housing"
  | "mixed_use"
  | "land"
  | "hospitality"
  | "other";

// Ordered pipeline stages (excludes "dead" which is off-pipeline)
export const DEAL_PIPELINE: DealStatus[] = [
  "sourcing",
  "screening",
  "loi",
  "under_contract",
  "diligence",
  "closing",
  "closed",
];

export const DEAL_STAGE_LABELS: Record<DealStatus, string> = {
  sourcing: "Sourcing",
  screening: "Screening",
  loi: "LOI",
  under_contract: "Under Contract",
  diligence: "Diligence",
  closing: "Closing",
  closed: "Closed",
  dead: "Dead",
  archived: "Archived",
};

// Stage gates: advancing TO this status requires the flag to be true
export const STAGE_GATES: Partial<Record<DealStatus, { flag: "loi_executed" | "psa_executed"; message: string }>> = {
  under_contract: {
    flag: "loi_executed",
    message: "No executed LOI on file. Are you sure you want to move to Under Contract without one?",
  },
  diligence: {
    flag: "psa_executed",
    message: "No executed PSA on file. Are you sure you want to move to Diligence without one?",
  },
};

export interface Deal {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  property_type: PropertyType;
  investment_strategy: InvestmentThesis | null;
  deal_scope: DealScope | null;
  status: DealStatus;
  starred: boolean;
  asking_price: number | null;
  square_footage: number | null;
  units: number | null;
  bedrooms: number | null;
  year_built: number | null;
  notes: string | null;
  land_acres: number | null;
  lat: number | null;
  lng: number | null;
  loi_executed: boolean;
  psa_executed: boolean;
  business_plan_id: string | null;
  om_score: number | null;
  uw_score: number | null;
  uw_score_reasoning: string | null;
  final_score: number | null;
  final_score_reasoning: string | null;
  // Inbox / AI Deal Sourcing
  auto_ingested: boolean;
  inbox_reviewed_at: string | null;
  ingested_from_path: string | null;
  // Execution / Post-Closing
  execution_phase: ExecutionPhase | null;
  execution_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewDeal = Omit<Deal, "id" | "created_at" | "updated_at">;

// ─── Deal Notes ───────────────────────────────────────────────────────────

export type DealNoteCategory = "context" | "thesis" | "risk" | "review" | "site_walk";

export const DEAL_NOTE_CATEGORIES: Record<DealNoteCategory, { label: string; description: string; inMemory: boolean }> = {
  context: { label: "Deal Context", description: "Broker intel, seller motivation, market conditions", inMemory: true },
  thesis: { label: "Investment Thesis", description: "Investment rationale, strategy notes", inMemory: true },
  risk: { label: "Key Risk", description: "Red flags, concerns, issues to watch", inMemory: true },
  review: { label: "Team Review", description: "Notes for IC/team discussion", inMemory: false },
  site_walk: { label: "Site Walk", description: "Observations from property site walks", inMemory: true },
};

export interface DealNote {
  id: string;
  deal_id: string;
  text: string;
  category: DealNoteCategory;
  source: "manual" | "chat" | "ai";
  created_at: string;
}

// ─── Business Plan ─────────────────────────────────────────────────────────

export type InvestmentThesis =
  | "value_add"
  | "ground_up"
  | "core"
  | "core_plus"
  | "opportunistic";

export const INVESTMENT_THESIS_LABELS: Record<InvestmentThesis, string> = {
  value_add: "Value-Add",
  ground_up: "Ground-Up Development",
  core: "Core",
  core_plus: "Core-Plus",
  opportunistic: "Opportunistic",
};

export const INVESTMENT_THESIS_DESCRIPTIONS: Record<InvestmentThesis, string> = {
  value_add: "Acquire underperforming assets, renovate/reposition, increase NOI, and sell at a higher valuation",
  ground_up: "Develop new construction from raw or entitled land through lease-up and stabilization",
  core: "Acquire stabilized, high-quality assets in prime locations for steady cash flow with minimal risk",
  core_plus: "Acquire quality assets with minor value-add potential through light improvements or lease-up",
  opportunistic: "High-risk/high-return strategies including distressed assets, heavy rehab, or market turnarounds",
};

// ─── Deal Scope ────────────────────────────────────────────────────────────
// Orthogonal to InvestmentThesis: drives UI complexity (which sections matter).
// Acquisition → underwriting-focused; Programming + Site & Zoning are de-emphasized.
// Value-Add + Expansion → adds new SF (vertical additions, ADUs, phased adds); full flow.
// Ground-Up → new construction; full flow with programming, site, and zoning defaults.

export type DealScope = "acquisition" | "value_add_expansion" | "ground_up";

export const DEAL_SCOPE_LABELS: Record<DealScope, string> = {
  acquisition: "Acquisition",
  value_add_expansion: "Value-Add + Expansion",
  ground_up: "Ground-Up Development",
};

export const DEAL_SCOPE_DESCRIPTIONS: Record<DealScope, string> = {
  acquisition: "Buy and operate, or interior renovation only. No new SF. Underwriting-focused.",
  value_add_expansion: "Reposition with added square footage — vertical additions, ADUs, new phases.",
  ground_up: "New construction on raw or entitled land. Full programming, site, and zoning flow.",
};

// Suggest a default scope from an investment thesis. User can always override.
export function suggestScopeFromStrategy(strategy: InvestmentThesis | null | ""): DealScope | null {
  if (strategy === "ground_up") return "ground_up";
  if (strategy === "value_add") return "value_add_expansion";
  if (strategy === "core" || strategy === "core_plus") return "acquisition";
  return null;
}

export const PREDEFINED_MARKETS = [
  "DFW", "Houston", "San Antonio", "Austin", "Tampa", "Orlando", "Jacksonville",
  "Atlanta", "Charlotte", "Raleigh-Durham", "Nashville", "Phoenix", "Denver",
  "Las Vegas", "Salt Lake City", "Boise", "Indianapolis", "Columbus", "Kansas City",
  "Minneapolis", "Chicago", "Detroit", "St. Louis", "Miami", "Fort Lauderdale",
  "Savannah", "Charleston", "Richmond", "Washington DC", "Baltimore", "Philadelphia",
  "Boston", "New York", "Los Angeles", "San Diego", "San Francisco", "Seattle", "Portland",
];

export interface BusinessPlan {
  id: string;
  name: string;
  description: string;
  investment_theses: InvestmentThesis[];
  target_markets: string[];
  property_types: PropertyType[];
  hold_period_min: number | null;
  hold_period_max: number | null;
  target_irr_min: number | null;
  target_irr_max: number | null;
  target_equity_multiple_min: number | null;
  target_equity_multiple_max: number | null;
  is_default: boolean;
  // Branding fields (per-plan)
  branding_company_name: string;
  branding_tagline: string;
  branding_logo_url: string | null;
  branding_logo_width: number | null;
  branding_primary_color: string;
  branding_secondary_color: string;
  branding_accent_color: string;
  branding_header_font: string;
  branding_body_font: string;
  branding_footer_text: string;
  branding_website: string;
  branding_email: string;
  branding_phone: string;
  branding_address: string;
  branding_disclaimer_text: string;
  created_at: string;
  updated_at: string;
}

// ─── Document Categories ────────────────────────────────────────────────────

export type DocumentCategory =
  | "om"
  | "title_ownership"
  | "environmental"
  | "zoning_entitlements"
  | "financial"
  | "surveys_engineering"
  | "legal"
  | "utilities"
  | "inspections"
  | "market"
  | "insurance"
  | "leases"
  | "permits"
  | "other";

export const DOCUMENT_CATEGORIES: Record<
  DocumentCategory,
  { label: string; icon: string; description: string }
> = {
  om: {
    label: "Offering Memorandum",
    icon: "📄",
    description: "Offering memorandums, broker packages, investment summaries",
  },
  title_ownership: {
    label: "Title & Ownership",
    icon: "🏛️",
    description: "Title reports, deed, ownership history",
  },
  environmental: {
    label: "Environmental",
    icon: "🌿",
    description: "Phase I/II ESA, remediation reports",
  },
  zoning_entitlements: {
    label: "Zoning & Entitlements",
    icon: "📋",
    description: "Zoning letters, permits, entitlement docs",
  },
  financial: {
    label: "Financial",
    icon: "💰",
    description: "P&L, rent rolls, operating statements, tax returns",
  },
  surveys_engineering: {
    label: "Surveys & Engineering",
    icon: "📐",
    description: "ALTA surveys, structural, civil, MEP reports",
  },
  legal: {
    label: "Legal",
    icon: "⚖️",
    description: "Contracts, easements, CC&Rs, HOA docs",
  },
  utilities: {
    label: "Utilities",
    icon: "⚡",
    description: "Utility bills, service agreements, capacity letters",
  },
  inspections: {
    label: "Inspections",
    icon: "🔍",
    description: "Property condition reports, roof, HVAC, plumbing",
  },
  market: {
    label: "Market",
    icon: "📊",
    description: "Comp sales, market studies, appraisals",
  },
  insurance: {
    label: "Insurance",
    icon: "🛡️",
    description: "Insurance policies, loss runs, certificates",
  },
  leases: {
    label: "Leases",
    icon: "📝",
    description: "Tenant leases, amendments, estoppels, SNDAs",
  },
  permits: {
    label: "Permits",
    icon: "🔑",
    description: "Building permits, certificates of occupancy",
  },
  other: {
    label: "Other",
    icon: "📁",
    description: "Uncategorized documents",
  },
};

// ─── Document ───────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  deal_id: string;
  name: string;
  original_name: string;
  category: DocumentCategory;
  file_path: string;
  file_size: number;
  mime_type: string;
  content_text: string | null;
  ai_summary: string | null;
  ai_tags: string | null; // JSON array string
  is_key: boolean;
  // Document Intelligence Pipeline: version chain within the same deal
  parent_document_id: string | null;
  version: number;
  auto_diff_result: Record<string, unknown> | null;
  uploaded_at: string;
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export interface Photo {
  id: string;
  deal_id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  is_cover: boolean;
  uploaded_at: string;
}

// ─── Site Walk ──────────────────────────────────────────────────────────────

export type SiteWalkStatus = "draft" | "in_progress" | "completed";

export type SiteWalkAreaTag =
  | "exterior"
  | "lobby"
  | "hallways"
  | "studio"
  | "1br"
  | "2br"
  | "3br"
  | "amenities"
  | "parking"
  | "roof"
  | "mechanical"
  | "laundry"
  | "office"
  | "storage"
  | "landscaping"
  | "pool"
  | "general";

export const SITE_WALK_AREA_LABELS: Record<SiteWalkAreaTag, string> = {
  exterior: "Exterior",
  lobby: "Lobby",
  hallways: "Hallways",
  studio: "Studio Unit",
  "1br": "1BR Unit",
  "2br": "2BR Unit",
  "3br": "3BR Unit",
  amenities: "Amenities",
  parking: "Parking",
  roof: "Roof",
  mechanical: "Mechanical",
  laundry: "Laundry",
  office: "Office",
  storage: "Storage",
  landscaping: "Landscaping",
  pool: "Pool",
  general: "General",
};

export type DeficiencySeverity = "minor" | "moderate" | "major" | "critical";
export type DeficiencyStatus = "open" | "in_progress" | "resolved" | "deferred";

export const DEFICIENCY_SEVERITY_LABELS: Record<DeficiencySeverity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
  critical: "Critical",
};

export const DEFICIENCY_STATUS_LABELS: Record<DeficiencyStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  deferred: "Deferred",
};

export type RecordingMediaType = "audio" | "video";
export type RecordingProcessingStatus =
  | "pending"
  | "uploading"
  | "transcribing"
  | "processing"
  | "completed"
  | "error";

export interface SiteWalk {
  id: string;
  deal_id: string;
  title: string;
  walk_date: string;
  status: SiteWalkStatus;
  attendees: string[];
  property_contact: string | null;
  weather: string | null;
  summary: string | null;
  ai_report: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteWalkRecording {
  id: string;
  site_walk_id: string;
  deal_id: string;
  file_path: string;
  original_name: string;
  file_size: number;
  mime_type: string;
  media_type: RecordingMediaType;
  duration_seconds: number | null;
  transcript_raw: string | null;
  transcript_cleaned: string | null;
  processing_status: RecordingProcessingStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteWalkPhoto {
  id: string;
  site_walk_id: string;
  deal_id: string;
  area_tag: SiteWalkAreaTag;
  unit_label: string | null;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export interface SiteWalkDeficiency {
  id: string;
  site_walk_id: string;
  deal_id: string;
  area_tag: SiteWalkAreaTag;
  description: string;
  severity: DeficiencySeverity;
  category: string;
  estimated_cost: number | null;
  photo_id: string | null;
  status: DeficiencyStatus;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ─── Underwriting ────────────────────────────────────────────────────────────

export interface UnitGroup {
  id: string;
  label: string;             // e.g., "3BR/2BA" or "Flex Bay — Suite 101"
  unit_count: number;
  will_renovate: boolean;
  renovation_cost_per_unit: number;
  // How units transition to market rent over the hold.
  //   - `annual_turnover_pct`: default mechanism. % of units/yr that roll to
  //     market rent as leases expire. Applied cumulatively, clamped to unit
  //     count. Independent of `renovation_count` (which is capex-only).
  //   - `market_rent_schedule`: optional override. Units hitting market rent
  //     each year, indexed by year (0 = yr 1). When present, `annual_turnover_pct`
  //     is ignored.
  annual_turnover_pct?: number;
  market_rent_schedule?: number[];
  // Multifamily (bed-based) — used when property_type is multifamily / student_housing
  beds_per_unit?: number;
  current_rent_per_bed?: number;  // monthly $/bed
  market_rent_per_bed?: number;   // monthly $/bed
  // Commercial (SF-based) — used for all other property types
  sf_per_unit?: number;
  current_rent_per_sf?: number;   // annual $/SF
  market_rent_per_sf?: number;    // annual $/SF
  lease_type?: "NNN" | "MG" | "Gross" | "Modified Gross";
  expense_reimbursement_per_sf?: number;  // annual $/SF
}

export interface AduAddition {
  id: string;
  label: string;             // e.g., "Detached ADU"
  unit_count: number;
  beds_per_unit: number;
  construction_cost_per_unit: number;
  target_rent_per_bed: number;
}

export interface UnderwritingData {
  // Purchase
  purchase_price: number;
  closing_costs_pct: number;   // % of purchase price (default 2)
  // Unit mix (existing)
  unit_groups: UnitGroup[];
  // ADU / new construction
  adu_additions: AduAddition[];
  // Operating assumptions
  vacancy_rate: number;          // % (default 5)
  management_fee_pct: number;    // % of EGR (default 8)
  taxes_annual: number;
  insurance_annual: number;
  repairs_per_unit_annual: number;
  utilities_annual: number;
  other_expenses_annual: number;
  // Financing
  has_financing: boolean;
  loan_to_value: number;         // %
  interest_rate: number;         // %
  amortization_years: number;
  io_period_years: number;
  // Exit
  exit_cap_rate: number;         // %
  hold_period_years: number;
  // Notes
  notes: string;
}

export interface Underwriting {
  id: string;
  deal_id: string;
  data: string;  // JSON of UnderwritingData
  updated_at: string;
}

// ─── Comps & Market ────────────────────────────────────────────────────────
// Unified sale + rent comp store. Paste-mode first: user pastes listing text
// or a URL, Claude extracts structured fields, user reviews before saving.
// Deliberately NOT fed by server-side scraping of broker sites — see
// FEATURE_ROADMAP_BACKLOG.md and the domain allowlist helper in src/lib/web-allowlist.ts.

export type CompType = "sale" | "rent";

export type CompSource =
  | "manual"         // user typed fields directly
  | "paste"          // pasted listing text → Claude extracted
  | "doc"            // pulled from a classified "market" document
  | "deal_snapshot"  // snapshot of a deal's own underwriting data
  | "api";           // future: RentCast / ATTOM / etc.

export interface Comp {
  id: string;
  // deal_id is nullable because comps can live at the workspace level (not
  // attached to any particular deal). When a deal is deleted, attached comps
  // are detached (SET NULL) rather than cascade-deleted so they survive as
  // workspace comps with their source_deal_id preserved as a provenance tag.
  deal_id: string | null;
  source_deal_id: string | null;   // historical reference even after detach
  comp_type: CompType;

  // Core property identity
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  property_type: string | null;
  year_built: number | null;

  // Size
  units: number | null;
  total_sf: number | null;

  // Sale comp fields (nullable for rent comps)
  sale_price: number | null;
  sale_date: string | null;     // ISO date
  cap_rate: number | null;       // %
  noi: number | null;
  price_per_unit: number | null;
  price_per_sf: number | null;

  // Rent comp fields (nullable for sale comps)
  rent_per_unit: number | null;  // monthly $/unit
  rent_per_sf: number | null;    // annual $/SF
  rent_per_bed: number | null;   // monthly $/bed (student housing)
  occupancy_pct: number | null;
  lease_type: string | null;

  // Comparability
  distance_mi: number | null;
  lat: number | null;            // WGS84 latitude (populated by geocoder)
  lng: number | null;            // WGS84 longitude
  selected: boolean;             // include in investment package

  // Provenance
  source: CompSource;
  source_url: string | null;     // reference only, never auto-fetched
  source_note: string | null;    // free-form analyst note
  extra: Record<string, unknown>; // overflow for amenities, unit_type breakdowns, etc.

  created_at: string;
  updated_at: string;
}

export interface SubmarketMetrics {
  id: string;
  deal_id: string;
  submarket_name: string | null;
  msa: string | null;
  market_cap_rate: number | null;     // %
  market_rent_growth: number | null;  // annual %
  market_vacancy: number | null;      // %
  absorption_units: number | null;    // annual
  deliveries_units: number | null;    // annual
  narrative: string | null;           // AI-generated commentary
  sources: Array<{ url: string; title?: string; note?: string }>;
  updated_at: string;
}

// ─── Location Intelligence ──────────────────────────────────────────────────

export type LocationRadiusMiles = 1 | 2 | 3 | 5 | 10 | 15 | 25;

export const LOCATION_RADIUS_OPTIONS: LocationRadiusMiles[] = [1, 2, 3, 5, 10, 15, 25];

export interface DemographicSnapshot {
  total_population: number | null;
  population_growth_pct: number | null;        // annual %
  median_age: number | null;
  median_household_income: number | null;
  per_capita_income: number | null;
  poverty_rate: number | null;                 // %
  bachelors_degree_pct: number | null;         // %
  // Housing
  total_housing_units: number | null;
  owner_occupied_pct: number | null;           // %
  renter_occupied_pct: number | null;          // %
  median_home_value: number | null;
  median_gross_rent: number | null;
  home_value_growth_pct: number | null;        // annual %
  rent_growth_pct: number | null;              // annual %
  // Employment
  labor_force: number | null;
  unemployment_rate: number | null;            // %
  total_employed: number | null;
  // Top industries (name + share %)
  top_employers: Array<{ name: string; share_pct?: number }>;
  top_industries: Array<{ name: string; share_pct?: number }>;
  // Household composition
  avg_household_size: number | null;
  family_households_pct: number | null;        // %
}

export interface LocationIntelligence {
  id: string;
  deal_id: string;
  radius_miles: LocationRadiusMiles;
  // Core demographic data
  data: DemographicSnapshot;
  // Growth projections (user-entered or from paid reports)
  projections: {
    population_growth_5yr_pct: number | null;
    job_growth_5yr_pct: number | null;
    home_value_growth_5yr_pct: number | null;
    rent_growth_5yr_pct: number | null;
    new_units_pipeline: number | null;         // units under construction / planned
    notes: string | null;
  };
  // Data provenance
  data_source: "census_acs" | "manual" | "report_upload" | "mixed";
  source_year: number | null;                  // e.g. 2023
  source_notes: string | null;
  // Map snapshot for investment packages
  map_snapshot_url: string | null;
  updated_at: string;
}

// ─── LOI ────────────────────────────────────────────────────────────────────

export interface LOIData {
  // Parties
  buyer_entity: string;
  buyer_contact: string;
  buyer_contact_id?: string | null;
  buyer_address: string;
  seller_name: string;
  seller_contact_id?: string | null;
  seller_address: string;
  // Financial terms
  purchase_price: number | null;
  earnest_money: number | null;
  earnest_money_hard_days: number | null;
  // Timeline
  due_diligence_days: number | null;
  financing_contingency_days: number | null;
  closing_days: number | null;
  // Financing
  has_financing_contingency: boolean;
  lender_name: string;
  lender_contact_id?: string | null;
  // Other
  as_is: boolean;
  broker_name: string;
  broker_contact_id?: string | null;
  broker_commission: string;
  additional_terms: string;
  loi_date: string;
}

export interface LOI {
  id: string;
  deal_id: string;
  data: string;   // JSON of LOIData
  executed: boolean;
  updated_at: string;
}

// ─── Checklist ──────────────────────────────────────────────────────────────

export type ChecklistStatus = "pending" | "complete" | "na" | "issue";

export interface ChecklistItem {
  id: string;
  deal_id: string;
  category: string;
  item: string;
  status: ChecklistStatus;
  notes: string | null;
  ai_filled: boolean;
  source_document_ids: string | null; // JSON array string
  updated_at: string;
}

// Standard diligence checklist template
export const DILIGENCE_CHECKLIST_TEMPLATE: Array<{
  category: string;
  items: string[];
}> = [
  {
    category: "Title & Ownership",
    items: [
      "Preliminary title report reviewed",
      "Chain of title confirmed",
      "Outstanding liens identified",
      "Easements and encumbrances reviewed",
      "Title insurance commitment obtained",
      "ALTA survey ordered",
      "Legal description matches deed",
    ],
  },
  {
    category: "Environmental",
    items: [
      "Phase I ESA completed",
      "Phase II ESA completed (if required)",
      "No recognized environmental conditions (RECs)",
      "ASTM standards compliance confirmed",
      "Underground storage tanks (USTs) checked",
      "Asbestos / lead paint assessment",
      "Mold assessment completed",
    ],
  },
  {
    category: "Zoning & Entitlements",
    items: [
      "Current zoning confirmed",
      "Permitted uses verified",
      "Non-conforming use status reviewed",
      "Variances or special permits reviewed",
      "Development rights / FAR reviewed",
      "Parking requirements verified",
      "Future zoning / overlay district reviewed",
    ],
  },
  {
    category: "Financial",
    items: [
      "Rent roll obtained and verified",
      "3 years operating statements reviewed",
      "Pro forma underwriting completed",
      "In-place NOI verified",
      "Property tax history reviewed",
      "Operating expense breakdown verified",
      "Capital expenditures history reviewed",
      "Deferred maintenance cost estimated",
      "Bank statements reviewed (if available)",
    ],
  },
  {
    category: "Leases",
    items: [
      "All leases obtained and reviewed",
      "Lease expirations mapped",
      "Rent escalations confirmed",
      "Tenant credit reviewed",
      "Estoppel certificates obtained",
      "SNDAs executed or required",
      "Assignment provisions reviewed",
      "Renewal / expansion options noted",
      "CAM reconciliation reviewed",
    ],
  },
  {
    category: "Physical Inspections",
    items: [
      "Property condition report (PCR) completed",
      "Roof inspection completed",
      "HVAC inspection completed",
      "Electrical system inspection",
      "Plumbing system inspection",
      "Structural assessment",
      "ADA compliance reviewed",
      "Life safety systems reviewed",
      "Deferred maintenance identified",
    ],
  },
  {
    category: "Legal & Contracts",
    items: [
      "Purchase and sale agreement reviewed",
      "Contingencies and deadlines tracked",
      "CC&Rs reviewed (if applicable)",
      "HOA documents reviewed (if applicable)",
      "Existing litigation / disputes checked",
      "Warranties and guarantees reviewed",
      "Closing conditions confirmed",
    ],
  },
  {
    category: "Utilities & Infrastructure",
    items: [
      "Water service confirmed",
      "Sewer / septic reviewed",
      "Electrical capacity verified",
      "Gas service reviewed",
      "Telecom / fiber availability checked",
      "12-month utility bills reviewed",
      "Utility deposits / obligations reviewed",
    ],
  },
  {
    category: "Permits & Compliance",
    items: [
      "Certificate of occupancy on file",
      "All open permits identified",
      "Building code violations checked",
      "Fire code compliance reviewed",
      "Health department compliance (if applicable)",
      "Signage permits reviewed",
    ],
  },
  {
    category: "Market & Valuation",
    items: [
      "Appraisal ordered / reviewed",
      "Comparable sales analyzed",
      "Market rent survey completed",
      "Absorption and vacancy rates reviewed",
      "Demographics and demand drivers reviewed",
      "Exit strategy / disposition plan confirmed",
    ],
  },
  {
    category: "Insurance",
    items: [
      "Property insurance history reviewed",
      "Current coverage verified",
      "Loss runs obtained (5 years)",
      "Flood zone status confirmed",
      "Insurance quote for acquisition obtained",
    ],
  },
  {
    category: "CEQA & Environmental Review (CA)",
    items: [
      "CEQA pathway determined (exempt, ND, MND, EIR, SB 35)",
      "CEQA exemption basis documented (if applicable)",
      "Initial Study prepared (if ND/MND)",
      "Environmental consultant engaged",
      "Public comment period completed",
      "Mitigation measures identified and costed",
      "Notice of Determination (NOD) filed",
      "CEQA challenge period expired (35 days post-NOD)",
    ],
  },
  {
    category: "Ground-Up Development",
    items: [
      "Entitlements confirmed or application filed",
      "Site plan and architectural drawings approved",
      "Grading and building permits issued",
      "Construction loan commitment obtained",
      "GC / design-build contract executed",
      "Construction schedule and draw schedule finalized",
      "Absorption and lease-up assumptions validated",
      "Parking requirements met per zoning",
      "Utility capacity confirmed for new construction",
      "Development agreement with city executed (if applicable)",
    ],
  },
];

// ─── Project Management ────────────────────────────────────────────────────

export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export interface DealTask {
  id: string;
  deal_id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  milestone_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DealMilestone {
  id: string;
  deal_id: string;
  title: string;
  stage: DealStatus | null;
  target_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const TASK_PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "text-zinc-400" },
  medium: { label: "Medium", color: "text-blue-400" },
  high: { label: "High", color: "text-amber-400" },
  critical: { label: "Critical", color: "text-red-400" },
};

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "To Do", color: "bg-zinc-500/20 text-zinc-300" },
  in_progress: { label: "In Progress", color: "bg-blue-500/20 text-blue-300" },
  blocked: { label: "Blocked", color: "bg-red-500/20 text-red-300" },
  done: { label: "Done", color: "bg-emerald-500/20 text-emerald-300" },
};

export const STAGE_MILESTONE_TEMPLATES: Record<DealStatus, string[]> = {
  sourcing: ["Initial property screening", "Broker outreach", "Site visit scheduled"],
  screening: ["Financial review complete", "Market analysis complete", "IC memo drafted"],
  loi: ["LOI drafted", "LOI negotiated", "LOI executed"],
  under_contract: ["PSA negotiated", "PSA executed", "Earnest money deposited"],
  diligence: ["Title review complete", "Environmental clear", "Physical inspections done", "Financing commitment"],
  closing: ["Final walkthrough", "Closing docs signed", "Funding wired", "Deal closed"],
  closed: [],
  dead: [],
  archived: [],
};

// Default milestones that always seed regardless of stage
export const DEFAULT_MILESTONES: Array<{ title: string; stage: DealStatus }> = [
  { title: "Site visit completed", stage: "sourcing" },
  { title: "OM reviewed & scored", stage: "screening" },
  { title: "Underwriting model complete", stage: "screening" },
  { title: "IC approval obtained", stage: "screening" },
  { title: "LOI submitted", stage: "loi" },
  { title: "LOI executed", stage: "loi" },
  { title: "PSA executed", stage: "under_contract" },
  { title: "Earnest money deposited", stage: "under_contract" },
  { title: "Title & survey clear", stage: "diligence" },
  { title: "Environmental clear", stage: "diligence" },
  { title: "Physical inspections complete", stage: "diligence" },
  { title: "Financing secured", stage: "diligence" },
  { title: "Closing docs signed", stage: "closing" },
  { title: "Deal closed", stage: "closing" },
];

// Default tasks that always seed
export const DEFAULT_TASKS: Array<{ title: string; priority: TaskPriority; milestone_title?: string }> = [
  { title: "Request offering memorandum from broker", priority: "high" },
  { title: "Review OM and score deal", priority: "high", milestone_title: "OM reviewed & scored" },
  { title: "Schedule property site visit", priority: "high", milestone_title: "Site visit completed" },
  { title: "Run initial underwriting model", priority: "high", milestone_title: "Underwriting model complete" },
  { title: "Pull market comps and rent survey", priority: "medium" },
  { title: "Prepare IC memo / investment summary", priority: "high", milestone_title: "IC approval obtained" },
  { title: "Draft LOI terms", priority: "high", milestone_title: "LOI submitted" },
  { title: "Negotiate LOI with seller/broker", priority: "high", milestone_title: "LOI executed" },
  { title: "Engage title company", priority: "medium", milestone_title: "Title & survey clear" },
  { title: "Order Phase I ESA", priority: "high", milestone_title: "Environmental clear" },
  { title: "Order ALTA survey", priority: "medium", milestone_title: "Title & survey clear" },
  { title: "Schedule property condition assessment", priority: "high", milestone_title: "Physical inspections complete" },
  { title: "Obtain insurance quotes", priority: "medium" },
  { title: "Finalize loan application", priority: "high", milestone_title: "Financing secured" },
  { title: "Review all lease abstracts", priority: "medium" },
  { title: "Confirm zoning & permitted uses", priority: "medium" },
  { title: "Final walkthrough before closing", priority: "high", milestone_title: "Closing docs signed" },
  { title: "Wire closing funds", priority: "critical", milestone_title: "Deal closed" },
];

// ─── Communication ─────────────────────────────────────────────────────────

export type StakeholderType =
  | "broker"
  | "seller"
  | "buyer"
  | "lender"
  | "attorney"
  | "title"
  | "inspector"
  | "appraiser"
  | "property_manager"
  | "ic"
  | "partner"
  | "tenant"
  | "city"
  | "other";

export type CommunicationChannel =
  | "email"
  | "phone"
  | "text"
  | "meeting"
  | "video"
  | "letter"
  | "other";

export type CommunicationDirection = "inbound" | "outbound";

export type CommunicationStatus = "open" | "awaiting_reply" | "closed";

export type QuestionStatus = "open" | "asked" | "answered" | "na";

export type QuestionSource = "manual" | "template" | "ai";

export interface DealCommunication {
  id: string;
  deal_id: string;
  stakeholder_type: StakeholderType;
  stakeholder_name: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject: string;
  summary: string;
  status: CommunicationStatus;
  occurred_at: string;
  follow_up_at: string | null;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealQuestion {
  id: string;
  deal_id: string;
  target_role: StakeholderType;
  phase: DealStatus;
  question: string;
  answer: string | null;
  status: QuestionStatus;
  source: QuestionSource;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const STAKEHOLDER_LABELS: Record<StakeholderType, string> = {
  broker: "Broker",
  seller: "Seller",
  buyer: "Buyer",
  lender: "Lender",
  attorney: "Attorney",
  title: "Title / Escrow",
  inspector: "Inspector",
  appraiser: "Appraiser",
  property_manager: "Property Manager",
  ic: "Investment Committee",
  partner: "Partner / JV",
  tenant: "Tenant",
  city: "City / Municipality",
  other: "Other",
};

export const COMMUNICATION_CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  email: "Email",
  phone: "Phone",
  text: "Text",
  meeting: "Meeting",
  video: "Video Call",
  letter: "Letter",
  other: "Other",
};

export const COMMUNICATION_STATUS_CONFIG: Record<
  CommunicationStatus,
  { label: string; color: string }
> = {
  open: { label: "Open", color: "bg-blue-500/20 text-blue-300" },
  awaiting_reply: { label: "Awaiting Reply", color: "bg-amber-500/20 text-amber-300" },
  closed: { label: "Closed", color: "bg-emerald-500/20 text-emerald-300" },
};

export const QUESTION_STATUS_CONFIG: Record<
  QuestionStatus,
  { label: string; color: string }
> = {
  open: { label: "Open", color: "bg-zinc-500/20 text-zinc-300" },
  asked: { label: "Asked", color: "bg-blue-500/20 text-blue-300" },
  answered: { label: "Answered", color: "bg-emerald-500/20 text-emerald-300" },
  na: { label: "N/A", color: "bg-muted text-muted-foreground" },
};

/**
 * Suggested questions to ask brokers / sellers / others at each phase of the
 * deal. Used by the Communication section to seed the questions list.
 */
export const STAGE_QUESTION_TEMPLATES: Record<
  DealStatus,
  Array<{ target_role: StakeholderType; question: string }>
> = {
  sourcing: [
    { target_role: "broker", question: "What is the seller's motivation and timing?" },
    { target_role: "broker", question: "Has the property been on the market before? At what price?" },
    { target_role: "broker", question: "Are there any other offers or LOIs in hand?" },
    { target_role: "broker", question: "What is the asking price and how was it determined?" },
    { target_role: "broker", question: "Can you share the rent roll, T-12, and OM?" },
    { target_role: "broker", question: "Are there any known capex needs or deferred maintenance?" },
    { target_role: "broker", question: "Who is the current property manager?" },
  ],
  screening: [
    { target_role: "broker", question: "Can you provide trailing 24 months of operating statements?" },
    { target_role: "broker", question: "Are utilities separately metered?" },
    { target_role: "broker", question: "What is the in-place vs. market rent gap?" },
    { target_role: "broker", question: "Are there any below-market leases or anchor tenants in renewal?" },
    { target_role: "seller", question: "What capital improvements have been made in the last 5 years?" },
    { target_role: "seller", question: "Are there any pending or threatened litigation matters?" },
    { target_role: "lender", question: "What loan terms can you offer for this asset class and market?" },
    { target_role: "property_manager", question: "What is the current occupancy and trailing 12-month average?" },
    { target_role: "property_manager", question: "Walk me through the biggest deferred maintenance items." },
    { target_role: "property_manager", question: "What is the current staffing model and any open positions?" },
    { target_role: "property_manager", question: "What is the average tenant tenure and turnover rate?" },
    { target_role: "property_manager", question: "Are there any recurring complaints or maintenance issues from tenants?" },
  ],
  loi: [
    { target_role: "broker", question: "What deal terms are most important to the seller (price, close timing, contingencies)?" },
    { target_role: "broker", question: "What earnest money deposit will the seller expect?" },
    { target_role: "broker", question: "How long of a due diligence period is acceptable?" },
    { target_role: "seller", question: "Will seller financing be considered?" },
    { target_role: "attorney", question: "Any concerns with our standard LOI terms for this jurisdiction?" },
  ],
  under_contract: [
    { target_role: "seller", question: "Can you provide all leases, amendments, and estoppels?" },
    { target_role: "seller", question: "Please provide vendor contracts and service agreements." },
    { target_role: "seller", question: "Are there any unrecorded agreements affecting the property?" },
    { target_role: "title", question: "What is the timeline for title commitment and survey delivery?" },
    { target_role: "lender", question: "What is the timeline for loan application, appraisal, and commitment?" },
  ],
  diligence: [
    { target_role: "seller", question: "Have all environmental reports (Phase I/II) been provided?" },
    { target_role: "inspector", question: "Any major roof, HVAC, or structural concerns to flag?" },
    { target_role: "appraiser", question: "What comparable sales are you using and what is your timing?" },
    { target_role: "title", question: "Any title exceptions that need to be cleared before closing?" },
    { target_role: "city", question: "Are there any open code violations or pending assessments?" },
    { target_role: "tenant", question: "Have you executed the estoppel certificate and SNDA?" },
    { target_role: "lender", question: "What conditions remain for final loan approval and rate lock?" },
    { target_role: "property_manager", question: "Can you provide the full vendor list with contracts and renewal dates?" },
    { target_role: "property_manager", question: "What is the historical annual capex spend, itemized?" },
    { target_role: "property_manager", question: "Are there any labor / union agreements in place?" },
  ],
  closing: [
    { target_role: "title", question: "Has the closing statement (HUD/CD) been finalized and reviewed?" },
    { target_role: "lender", question: "Are wire instructions and final funding amounts confirmed?" },
    { target_role: "attorney", question: "Have all closing documents been reviewed and signed?" },
    { target_role: "seller", question: "Has the final walkthrough been scheduled?" },
    { target_role: "broker", question: "Are commission instructions and W-9s in place?" },
  ],
  closed: [
    { target_role: "partner", question: "Schedule post-close kickoff with property manager and asset manager." },
    { target_role: "tenant", question: "Send new ownership notification and payment instructions." },
  ],
  dead: [],
  archived: [],
};

// ─── Contacts (CRM) ────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: StakeholderType;
  company: string | null;
  title: string | null;
  notes: string | null;
  tags: string[];
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactWithDeals extends Contact {
  deals: Array<{
    link_id: string;
    deal_id: string;
    deal_name: string;
    deal_status: DealStatus;
    city: string;
    state: string;
    role_on_deal: string | null;
    link_notes: string | null;
    linked_at: string;
  }>;
}

/** A contact joined with its deal_contacts link row, as returned by the per-deal contacts API */
export interface DealContactLink extends Contact {
  link_id: string;
  role_on_deal: string | null;
  link_notes: string | null;
  linked_at: string;
}

// ─── Development Schedule ──────────────────────────────────────────────────

export type DevPhaseStatus = "not_started" | "in_progress" | "complete" | "delayed";

/**
 * Entitlement task category — drives the visual chip on child rows and
 * keeps related tasks visually grouped. Top-level phases typically
 * leave this null (not used for them).
 */
export type TaskCategory =
  | "pre_submittal"
  | "review"
  | "approval"
  | "permit"
  | "other";

export const TASK_CATEGORY_CONFIG: Record<TaskCategory, { label: string; color: string; bg: string; border: string }> = {
  pre_submittal: { label: "Pre-Submittal", color: "text-sky-300",    bg: "bg-sky-500/10",    border: "border-sky-500/30" },
  review:        { label: "Review",        color: "text-amber-300",  bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  approval:      { label: "Approval",      color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  permit:        { label: "Permit",        color: "text-violet-300", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  other:         { label: "Other",         color: "text-zinc-300",   bg: "bg-zinc-500/10",   border: "border-zinc-500/30" },
};

export interface DevPhase {
  id: string;
  deal_id: string;
  phase_key: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  predecessor_id: string | null;
  lag_days: number;
  /**
   * When set, this phase is a child task rendered under its parent phase
   * (e.g. "Neighborhood Meeting" under "Entitlements & Permits"). Null /
   * absent for top-level phases.
   */
  parent_phase_id: string | null;
  /**
   * Optional visual chip that groups related entitlement tasks (e.g.
   * pre-submittal vs hearings vs permit). Scenario seeders assign
   * sensible defaults.
   */
  task_category: TaskCategory | null;
  /**
   * Free-text owner / assignee — who's driving this task (project
   * manager, architect, outside counsel, broker, etc.). Not tied to a
   * user record so it can be anyone.
   */
  task_owner: string | null;
  /**
   * Documents from the deal's Documents tab linked to this task —
   * typically the actual filed PDF for e.g. "Application Submittal" or
   * "CEQA Review". Array of document ids; empty / null = no links.
   */
  linked_document_ids: string[] | null;
  pct_complete: number;
  budget: number | null;
  status: DevPhaseStatus;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const DEV_PHASE_STATUS_CONFIG: Record<DevPhaseStatus, { label: string; color: string; bg: string }> = {
  not_started: { label: "Not Started", color: "text-zinc-400", bg: "bg-zinc-500/30" },
  in_progress: { label: "In Progress", color: "text-blue-400", bg: "bg-blue-500/50" },
  complete: { label: "Complete", color: "text-emerald-400", bg: "bg-emerald-500/50" },
  delayed: { label: "Delayed", color: "text-red-400", bg: "bg-red-500/50" },
};

// Default development phases (typical CRE development timeline)
export const DEFAULT_DEV_PHASES: Array<{
  phase_key: string;
  label: string;
  duration_months: number;
}> = [
  { phase_key: "acquisition", label: "Acquisition & Closing", duration_months: 2 },
  { phase_key: "predevelopment", label: "Pre-Development", duration_months: 3 },
  { phase_key: "entitlements", label: "Entitlements & Permits", duration_months: 6 },
  { phase_key: "design", label: "Design & Engineering", duration_months: 4 },
  { phase_key: "procurement", label: "Procurement & Bidding", duration_months: 2 },
  { phase_key: "construction", label: "Construction", duration_months: 18 },
  { phase_key: "marketing", label: "Marketing & Pre-Lease", duration_months: 6 },
  { phase_key: "lease_up", label: "Lease-Up", duration_months: 12 },
  { phase_key: "stabilization", label: "Stabilization", duration_months: 3 },
];

// ─── Pre-Development Budget Tracker ──────────────────────────────────────

export type PreDevCostStatus = "estimated" | "committed" | "incurred" | "paid";

export interface PreDevCost {
  id: string;
  deal_id: string;
  category: string;
  description: string;
  vendor: string | null;
  amount: number;
  status: PreDevCostStatus;
  incurred_date: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const PREDEV_COST_STATUS_CONFIG: Record<PreDevCostStatus, { label: string; color: string }> = {
  estimated: { label: "Estimated", color: "bg-zinc-500/20 text-zinc-300" },
  committed: { label: "Committed", color: "bg-blue-500/20 text-blue-300" },
  incurred: { label: "Incurred", color: "bg-amber-500/20 text-amber-300" },
  paid: { label: "Paid", color: "bg-emerald-500/20 text-emerald-300" },
};

// Standard pre-development cost categories
export const PREDEV_CATEGORIES = [
  "Legal & Title",
  "Environmental",
  "Survey & Civil",
  "Architectural & Design",
  "Engineering",
  "Entitlements & Permits",
  "Market Studies",
  "Financial Consulting",
  "Insurance & Bonds",
  "Travel & Site Visits",
  "Other",
] as const;

// Default approval thresholds — cumulative spend levels that trigger approval gates
// Users can override per-deal but these are sensible defaults
export const DEFAULT_PREDEV_THRESHOLDS: Array<{ amount: number; label: string }> = [
  { amount: 25000, label: "Initial Discretionary Spend" },
  { amount: 75000, label: "Director Approval" },
  { amount: 150000, label: "VP Approval" },
  { amount: 350000, label: "IC Approval" },
  { amount: 750000, label: "Full Committee Approval" },
];

// Pre-dev settings stored per-deal as JSON
export interface PreDevSettings {
  total_budget: number | null;
  thresholds: Array<{ amount: number; label: string }>;
}

// ─── Execution / Post-Closing Phases ──────────────────────────────────────

export type ExecutionPhase =
  | "preconstruction"
  | "construction"
  | "punch_list"
  | "lease_up"
  | "stabilization";

export const EXECUTION_PHASES: ExecutionPhase[] = [
  "preconstruction",
  "construction",
  "punch_list",
  "lease_up",
  "stabilization",
];

export const EXECUTION_PHASE_LABELS: Record<ExecutionPhase, string> = {
  preconstruction: "Pre-Construction",
  construction: "Construction",
  punch_list: "Punch List",
  lease_up: "Lease-Up",
  stabilization: "Stabilization",
};

export const EXECUTION_PHASE_CONFIG: Record<ExecutionPhase, { label: string; color: string }> = {
  preconstruction: { label: "Pre-Construction", color: "bg-blue-500/20 text-blue-300" },
  construction: { label: "Construction", color: "bg-amber-500/20 text-amber-300" },
  punch_list: { label: "Punch List", color: "bg-orange-500/20 text-orange-300" },
  lease_up: { label: "Lease-Up", color: "bg-purple-500/20 text-purple-300" },
  stabilization: { label: "Stabilization", color: "bg-emerald-500/20 text-emerald-300" },
};

// ─── Hard Cost Budget Tracker ─────────────────────────────────────────────

export type HardCostStatus = "estimated" | "committed" | "incurred" | "paid";

export interface HardCostItem {
  id: string;
  deal_id: string;
  category: string;
  description: string;
  vendor: string | null;
  amount: number;
  status: HardCostStatus;
  incurred_date: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const HARDCOST_STATUS_CONFIG: Record<HardCostStatus, { label: string; color: string }> = {
  estimated: { label: "Estimated", color: "bg-zinc-500/20 text-zinc-300" },
  committed: { label: "Committed", color: "bg-blue-500/20 text-blue-300" },
  incurred: { label: "Incurred", color: "bg-amber-500/20 text-amber-300" },
  paid: { label: "Paid", color: "bg-emerald-500/20 text-emerald-300" },
};

export const HARDCOST_CATEGORIES = [
  "General Conditions",
  "Sitework",
  "Foundation",
  "Structure",
  "Envelope",
  "MEP",
  "Interior Finishes",
  "FF&E",
  "Landscaping",
  "Contingency",
  "Other",
] as const;

export const DEFAULT_HARDCOST_THRESHOLDS: Array<{ amount: number; label: string }> = [
  { amount: 100000, label: "Initial Discretionary Spend" },
  { amount: 500000, label: "Director Approval" },
  { amount: 1500000, label: "VP Approval" },
  { amount: 5000000, label: "IC Approval" },
  { amount: 15000000, label: "Full Committee Approval" },
];

export interface HardCostSettings {
  total_budget: number | null;
  thresholds: Array<{ amount: number; label: string }>;
}

// ─── Draw Schedule ────────────────────────────────────────────────────────

export type DrawStatus = "draft" | "submitted" | "approved" | "funded" | "rejected";

export interface Draw {
  id: string;
  deal_id: string;
  draw_number: number;
  title: string;
  status: DrawStatus;
  submitted_date: string | null;
  approved_date: string | null;
  funded_date: string | null;
  amount_requested: number;
  amount_approved: number | null;
  retainage_held: number;
  pct_complete_claimed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrawItem {
  id: string;
  draw_id: string;
  hardcost_item_id: string | null;
  description: string;
  amount_requested: number;
  amount_approved: number | null;
  sort_order: number;
}

export const DRAW_STATUS_CONFIG: Record<DrawStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-zinc-500/20 text-zinc-300" },
  submitted: { label: "Submitted", color: "bg-blue-500/20 text-blue-300" },
  approved: { label: "Approved", color: "bg-amber-500/20 text-amber-300" },
  funded: { label: "Funded", color: "bg-emerald-500/20 text-emerald-300" },
  rejected: { label: "Rejected", color: "bg-red-500/20 text-red-300" },
};

// ─── Permit & Approval Tracker ────────────────────────────────────────────

export type PermitStatus = "not_submitted" | "submitted" | "in_review" | "approved" | "denied" | "expired";

export interface Permit {
  id: string;
  deal_id: string;
  permit_type: string;
  jurisdiction: string;
  description: string;
  submitted_date: string | null;
  expected_date: string | null;
  actual_date: string | null;
  fee: number;
  status: PermitStatus;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const PERMIT_STATUS_CONFIG: Record<PermitStatus, { label: string; color: string }> = {
  not_submitted: { label: "Not Submitted", color: "bg-zinc-500/20 text-zinc-300" },
  submitted: { label: "Submitted", color: "bg-blue-500/20 text-blue-300" },
  in_review: { label: "In Review", color: "bg-amber-500/20 text-amber-300" },
  approved: { label: "Approved", color: "bg-emerald-500/20 text-emerald-300" },
  denied: { label: "Denied", color: "bg-red-500/20 text-red-300" },
  expired: { label: "Expired", color: "bg-orange-500/20 text-orange-300" },
};

export const PERMIT_TYPES = [
  "Building Permit",
  "Demolition Permit",
  "Grading Permit",
  "Electrical Permit",
  "Plumbing Permit",
  "Mechanical Permit",
  "Fire Permit",
  "Zoning Variance",
  "Special Use Permit",
  "Certificate of Occupancy",
  "Environmental Permit",
  "Stormwater Permit",
  "Other",
] as const;

// ─── Vendor / Contractor Directory ────────────────────────────────────────

export type VendorStatus = "prospective" | "engaged" | "under_contract" | "active" | "inactive";

export interface Vendor {
  id: string;
  deal_id: string;
  name: string;
  role: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: VendorStatus;
  engagement_date: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const VENDOR_STATUS_CONFIG: Record<VendorStatus, { label: string; color: string }> = {
  prospective: { label: "Prospective", color: "bg-zinc-500/20 text-zinc-300" },
  engaged: { label: "Engaged", color: "bg-blue-500/20 text-blue-300" },
  under_contract: { label: "Under Contract", color: "bg-amber-500/20 text-amber-300" },
  active: { label: "Active", color: "bg-emerald-500/20 text-emerald-300" },
  inactive: { label: "Inactive", color: "bg-red-500/20 text-red-300" },
};

export const VENDOR_ROLES = [
  "General Contractor",
  "Architect",
  "Civil Engineer",
  "Structural Engineer",
  "MEP Engineer",
  "Geotechnical Engineer",
  "Environmental Consultant",
  "Surveyor",
  "Attorney",
  "Title Company",
  "Lender",
  "Insurance Broker",
  "Interior Designer",
  "Landscape Architect",
  "Subcontractor",
  "Other",
] as const;

// ─── Progress Reports ─────────────────────────────────────────────────────

export type ReportType = "weekly" | "monthly";
export type ReportStatus = "draft" | "submitted" | "reviewed" | "published";

export interface ProgressReport {
  id: string;
  deal_id: string;
  report_type: ReportType;
  title: string;
  period_start: string;
  period_end: string;
  status: ReportStatus;
  // Contractor-submitted fields
  summary: string | null;
  work_completed: string | null;
  work_planned: string | null;
  issues: string | null;
  weather_delays: number | null;
  pct_complete: number | null;
  // AI-generated fields
  ai_executive_summary: string | null;
  ai_budget_narrative: string | null;
  ai_schedule_narrative: string | null;
  ai_risk_narrative: string | null;
  // Sharing
  contractor_invite_id: string | null;
  submitted_by_email: string | null;
  submitted_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressReportPhoto {
  id: string;
  report_id: string;
  deal_id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  caption: string | null;
  category: string | null;
  uploaded_at: string;
}

export const REPORT_STATUS_CONFIG: Record<ReportStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-zinc-500/20 text-zinc-300" },
  submitted: { label: "Submitted", color: "bg-blue-500/20 text-blue-300" },
  reviewed: { label: "Reviewed", color: "bg-amber-500/20 text-amber-300" },
  published: { label: "Published", color: "bg-emerald-500/20 text-emerald-300" },
};

export const REPORT_PHOTO_CATEGORIES = [
  "General Progress",
  "Foundation",
  "Framing",
  "MEP Rough-In",
  "Exterior",
  "Interior",
  "Site Work",
  "Safety / Issue",
  "Other",
] as const;

// ─── Change Orders ────────────────────────────────────────────────────────

export type ChangeOrderStatus = "draft" | "submitted" | "approved" | "rejected" | "voided";

export interface ChangeOrder {
  id: string;
  deal_id: string;
  co_number: number;
  title: string;
  description: string;
  submitted_by: string | null;
  cost_impact: number;
  schedule_impact_days: number;
  status: ChangeOrderStatus;
  submitted_date: string | null;
  decided_date: string | null;
  hardcost_category: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const CHANGE_ORDER_STATUS_CONFIG: Record<ChangeOrderStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-zinc-500/20 text-zinc-300" },
  submitted: { label: "Submitted", color: "bg-blue-500/20 text-blue-300" },
  approved: { label: "Approved", color: "bg-emerald-500/20 text-emerald-300" },
  rejected: { label: "Rejected", color: "bg-red-500/20 text-red-300" },
  voided: { label: "Voided", color: "bg-zinc-500/20 text-zinc-400" },
};

// ─── Chat ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  deal_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ─── Development Budget (Ground-Up) ───────────────────────────────────────

export interface DevBudgetLineItem {
  id: string;
  label: string;
  category: "hard" | "soft";
  subcategory: string;
  amount: number;
  quantity: number;
  unit_cost: number;
  unit_label: string;  // "SF", "space", "unit", "lump sum", "% of hard"
  is_pct: boolean;
  pct_basis: "hard_costs" | "total_project" | "none";
  pct_value: number;
  notes: string;
  // When set, the quantity is live-computed from the massing on every
  // render instead of relying on the (possibly stale) saved value.
  // Supported sources mirror seedDevBudget: land_sf / max_gsf /
  // max_nrsf / parking_spaces / total_units / frontage_length_ft.
  auto_qty_source?: string;
  // For per-building fanout. When set, the live quantity is pulled
  // from the matching scenario in building_program, so each building
  // can carry its own GSF/NRSF/parking-space count.
  site_plan_building_id?: string | null;
}

export const DEFAULT_DEV_BUDGET_HARD: Array<{ label: string; subcategory: string; unit_label: string; auto_qty_source: string }> = [
  { label: "Site Work", subcategory: "site_work", unit_label: "SF", auto_qty_source: "land_sf" },
  { label: "Off-Sites", subcategory: "off_sites", unit_label: "Linear SF", auto_qty_source: "frontage_length_ft" },
  { label: "Vertical Construction (Shell & Core)", subcategory: "vertical", unit_label: "GSF", auto_qty_source: "max_gsf" },
  { label: "Parking Structure", subcategory: "parking_structure", unit_label: "space", auto_qty_source: "parking_spaces" },
  { label: "FF&E / Amenities", subcategory: "ffe_amenities", unit_label: "NRSF", auto_qty_source: "max_nrsf" },
  { label: "General Conditions", subcategory: "general_conditions", unit_label: "% of hard", auto_qty_source: "pct" },
  { label: "Contractor Fee & Overhead", subcategory: "contractor_fee", unit_label: "% of hard", auto_qty_source: "pct" },
  { label: "Contingency", subcategory: "contingency", unit_label: "% of hard", auto_qty_source: "pct" },
];

export const DEFAULT_DEV_BUDGET_SOFT: Array<{ label: string; subcategory: string; unit_label: string; auto_qty_source: string }> = [
  { label: "Architecture & Engineering", subcategory: "a_and_e", unit_label: "% of hard", auto_qty_source: "pct" },
  { label: "Permits & Impact Fees", subcategory: "permits", unit_label: "per unit", auto_qty_source: "total_units" },
  { label: "Legal", subcategory: "legal", unit_label: "lump sum", auto_qty_source: "manual" },
  { label: "Development Fee", subcategory: "dev_fee", unit_label: "% of hard", auto_qty_source: "pct" },
  { label: "Construction Interest Carry", subcategory: "interest_carry", unit_label: "lump sum", auto_qty_source: "computed" },
  { label: "Marketing / Lease-Up", subcategory: "marketing_leaseup", unit_label: "per unit", auto_qty_source: "total_units" },
  { label: "Insurance", subcategory: "insurance", unit_label: "lump sum", auto_qty_source: "manual" },
  { label: "Accounting / Consulting", subcategory: "accounting", unit_label: "lump sum", auto_qty_source: "manual" },
];

// ─── Parking Configuration ────────────────────────────────────────────────

export type ParkingType = "surface" | "structured" | "underground" | "tuck_under";

export const PARKING_TYPE_LABELS: Record<ParkingType, string> = {
  surface: "Surface",
  structured: "Structured / Podium",
  underground: "Underground",
  tuck_under: "Tuck-Under",
};

export const PARKING_COST_DEFAULTS: Record<ParkingType, number> = {
  surface: 10000,
  structured: 35000,
  underground: 55000,
  tuck_under: 25000,
};

export interface ParkingEntry {
  id: string;
  type: ParkingType;
  spaces: number;
  cost_per_space: number;
  // Revenue
  reserved_residential_spaces: number;
  reserved_monthly_rate: number;
  unreserved_spaces: number;
  unreserved_monthly_rate: number;
  guest_visitor_spaces: number;
  retail_shared_spaces: number;
  retail_shared_monthly_rate: number;
}

export interface ParkingConfig {
  entries: ParkingEntry[];
  zoning_required_ratio_residential: number;  // spaces per unit
  zoning_required_ratio_commercial: number;   // spaces per 1,000 SF
  // ── Shared Parking / Peak Offset Analysis ──
  shared_parking_enabled: boolean;
  shared_parking_study_completed: boolean;
  shared_parking_study_date: string | null;
  shared_parking_study_firm: string;
  // Peak demand by use (% of total spaces needed at peak hour)
  // Office peaks weekdays ~10am-2pm; Residential peaks evenings/weekends
  // Retail peaks evenings/Saturdays. The offset allows fewer total spaces.
  peak_demand_residential_weekday_pct: number;   // e.g. 60% — many residents at work
  peak_demand_residential_evening_pct: number;   // e.g. 95%
  peak_demand_residential_weekend_pct: number;   // e.g. 85%
  peak_demand_office_weekday_pct: number;        // e.g. 90%
  peak_demand_office_evening_pct: number;        // e.g. 10%
  peak_demand_office_weekend_pct: number;        // e.g. 5%
  peak_demand_retail_weekday_pct: number;        // e.g. 60%
  peak_demand_retail_evening_pct: number;        // e.g. 80%
  peak_demand_retail_weekend_pct: number;        // e.g. 100%
  // Spaces by use (before shared parking reduction)
  spaces_needed_residential: number;
  spaces_needed_office: number;
  spaces_needed_retail: number;
  // Shared reduction — computed or manual override
  shared_parking_reduction_pct: number;  // % reduction from non-shared total
}

// ─── Absorption / Lease-Up ────────────────────────────────────────────────

export interface LeaseUpConfig {
  construction_months: number;
  absorption_units_per_month: number;
  concession_free_months: number;
  concession_per_unit: number;
  stabilization_occupancy_pct: number;  // target, e.g. 93
}

// ─── Construction Loan ────────────────────────────────────────────────────

export interface ConstructionDrawPeriod {
  month: number;
  cumulative_pct: number;  // cumulative % of budget drawn at this month
}

export interface ConstructionLoanConfig {
  ltc_pct: number;
  rate: number;
  term_months: number;
  // Draw curve shape — "s_curve" generates a bell-curve (Gaussian) draw
  // profile: slow start, ramp up in the middle, slow tail. Its cumulative
  // form is an S-curve, which is how real construction draws look.
  // "linear" draws equal monthly tranches. "custom" uses draw_schedule.
  draw_curve?: "s_curve" | "linear" | "custom";
  // Standard deviation (in months) of the bell curve. Lower = more
  // concentrated draws in the middle (steep ramp). Higher = flatter /
  // more spread out. Typical: term_months / 4.
  draw_std_dev_months?: number;
  draw_schedule: ConstructionDrawPeriod[];
}

// ─── Mixed-Use Components ─────────────────────────────────────────────────

export type MixedUseComponentType = "residential" | "retail" | "office" | "parking" | "other";

export const MIXED_USE_COMPONENT_LABELS: Record<MixedUseComponentType, string> = {
  residential: "Residential",
  retail: "Retail",
  office: "Office",
  parking: "Parking",
  other: "Other",
};

export interface MixedUseComponent {
  id: string;
  component_type: MixedUseComponentType;
  label: string;
  sf_allocation: number;
  unit_groups: UnitGroup[];
  // OpEx allocation
  opex_mode: "own" | "shared";
  opex_allocation_pct: number;
  // Component-level valuation
  cap_rate: number;
  // Retail-specific
  ti_allowance_per_sf: number;
  leasing_commission_pct: number;
  free_rent_months: number;
  rent_escalation_pct: number;
}

export interface MixedUseConfig {
  enabled: boolean;
  total_gfa: number;
  components: MixedUseComponent[];
  common_area_sf: number;
}

// ─── Redevelopment Overlay ────────────────────────────────────────────────

export interface RedevelopmentConfig {
  enabled: boolean;
  existing_use: string;
  existing_sf: number;
  existing_noi: number;
  existing_occupancy_pct: number;
  // Transition timeline
  vacancy_period_months: number;
  demolition_period_months: number;
  construction_period_months: number;
  // Costs
  demolition_items: DevBudgetLineItem[];
  // Phased redevelopment
  is_phased: boolean;
  phase_1_label: string;
  phase_1_sf: number;
  phase_1_timeline_months: number;
  phase_2_label: string;
  phase_2_sf: number;
  phase_2_timeline_months: number;
  // Parking conversion
  existing_parking_spaces: number;
  parking_spaces_converted: number;
  new_parking_spaces_built: number;
}

// ─── CEQA Process Tracker ─────────────────────────────────────────────────

export type CEQAPathway =
  | "exempt_categorical"
  | "exempt_statutory"
  | "exempt_common_sense"
  | "exempt_class_32_infill"
  | "negative_declaration"
  | "mitigated_neg_dec"
  | "eir"
  | "streamlined_sb35"
  | "streamlined_sb423"
  | "not_applicable";

export const CEQA_PATHWAY_LABELS: Record<CEQAPathway, string> = {
  exempt_categorical: "Categorical Exemption",
  exempt_statutory: "Statutory Exemption",
  exempt_common_sense: "Common Sense Exemption",
  exempt_class_32_infill: "Class 32 — Infill Development",
  negative_declaration: "Negative Declaration (ND)",
  mitigated_neg_dec: "Mitigated Negative Declaration (MND)",
  eir: "Environmental Impact Report (EIR)",
  streamlined_sb35: "SB 35 Streamlining",
  streamlined_sb423: "SB 423 (Builder's Remedy)",
  not_applicable: "Not Applicable (Non-CA)",
};

export type CEQAStepStatus = "not_started" | "in_progress" | "complete" | "blocked" | "na";

export const CEQA_STEP_STATUS_CONFIG: Record<CEQAStepStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "bg-zinc-500/20 text-zinc-300" },
  in_progress: { label: "In Progress", color: "bg-blue-500/20 text-blue-300" },
  complete: { label: "Complete", color: "bg-emerald-500/20 text-emerald-300" },
  blocked: { label: "Blocked", color: "bg-red-500/20 text-red-300" },
  na: { label: "N/A", color: "bg-muted text-muted-foreground" },
};

export interface CEQAStep {
  id: string;
  label: string;
  status: CEQAStepStatus;
  due_date: string | null;
  completed_date: string | null;
  notes: string | null;
  sort_order: number;
}

export interface CEQAMitigation {
  id: string;
  category: string;       // e.g., "Traffic", "Noise", "Air Quality", "Biological"
  measure: string;        // description of the mitigation
  estimated_cost: number;
  status: CEQAStepStatus;
  responsible_party: string;
  notes: string | null;
  sort_order: number;
}

export interface CEQAHearing {
  id: string;
  hearing_type: string;  // e.g., "Planning Commission", "City Council", "Public Comment"
  date: string | null;
  location: string;
  status: CEQAStepStatus;
  outcome: string | null;
  notes: string | null;
}

export interface CEQAData {
  pathway: CEQAPathway;
  steps: CEQAStep[];
  mitigations: CEQAMitigation[];
  hearings: CEQAHearing[];
  consultant_name: string;
  consultant_contact: string;
  estimated_total_cost: number;
  estimated_duration_months: number;
  notes: string;
}

// Default CEQA steps by pathway — auto-populated when pathway is selected
export const CEQA_PATHWAY_STEPS: Record<CEQAPathway, string[]> = {
  exempt_categorical: [
    "Identify applicable exemption category",
    "Prepare Notice of Exemption (NOE)",
    "File NOE with County Clerk",
    "Post NOE (35-day statute of limitations begins)",
  ],
  exempt_statutory: [
    "Identify statutory exemption basis",
    "Prepare Notice of Exemption (NOE)",
    "File NOE with County Clerk",
  ],
  exempt_common_sense: [
    "Document no significant environmental impact",
    "Prepare Common Sense Exemption memo",
    "Agency approval of exemption finding",
    "File Notice of Exemption",
  ],
  exempt_class_32_infill: [
    "Confirm site is in urbanized area",
    "Confirm project is consistent with General Plan & zoning",
    "Confirm no significant traffic, noise, air quality, or water quality impacts",
    "Confirm site has no value as habitat for endangered species",
    "Confirm adequate utilities and public services available",
    "Prepare Class 32 Exemption analysis",
    "File Notice of Exemption (NOE)",
  ],
  negative_declaration: [
    "Prepare Initial Study (IS)",
    "Circulate IS/ND for 30-day public review",
    "Respond to public comments",
    "Adopt Negative Declaration",
    "File Notice of Determination (NOD)",
  ],
  mitigated_neg_dec: [
    "Prepare Initial Study (IS)",
    "Identify potentially significant impacts",
    "Develop mitigation measures",
    "Prepare IS/MND document",
    "Circulate IS/MND for 30-day public review",
    "Respond to public comments",
    "Adopt Mitigation Monitoring & Reporting Program (MMRP)",
    "Adopt Mitigated Negative Declaration",
    "File Notice of Determination (NOD)",
  ],
  eir: [
    "Prepare & circulate Notice of Preparation (NOP)",
    "Conduct scoping meeting",
    "Prepare Draft EIR",
    "Circulate Draft EIR for 45-day public review",
    "Prepare responses to comments",
    "Prepare Final EIR",
    "Certify Final EIR",
    "Adopt Findings of Fact & Statement of Overriding Considerations",
    "Adopt Mitigation Monitoring & Reporting Program (MMRP)",
    "File Notice of Determination (NOD)",
  ],
  streamlined_sb35: [
    "Confirm site eligibility (zoning, location, labor standards)",
    "Confirm project meets objective planning standards",
    "Submit SB 35 application to jurisdiction",
    "Jurisdiction 60/90-day review period",
    "Receive ministerial approval (no CEQA required)",
  ],
  streamlined_sb423: [
    "Confirm jurisdiction is non-compliant with RHNA housing element",
    "Confirm project meets objective zoning standards",
    "Submit Builder's Remedy application",
    "Jurisdiction review period",
    "Receive project approval",
  ],
  not_applicable: [],
};

export const CEQA_MITIGATION_CATEGORIES = [
  "Traffic & Transportation",
  "Noise & Vibration",
  "Air Quality",
  "Greenhouse Gas Emissions",
  "Biological Resources",
  "Cultural & Tribal Resources",
  "Hazards & Hazardous Materials",
  "Hydrology & Water Quality",
  "Land Use & Planning",
  "Aesthetics & Visual",
  "Public Services",
  "Utilities & Service Systems",
  "Recreation",
  "Other",
] as const;

// ─── API Response ───────────────────────────────────────────────────────────

// ─── Building Program / Massing ──────────────────────────────────────────────

export type FloorUseType =
  | "parking"
  | "retail"
  | "lobby_amenity"
  | "residential"
  | "mechanical"
  | "office";

export const FLOOR_USE_TYPE_LABELS: Record<FloorUseType, string> = {
  parking: "Parking",
  retail: "Retail",
  lobby_amenity: "Lobby / Amenity",
  residential: "Residential",
  mechanical: "Mechanical / Rooftop",
  office: "Office",
};

export const FLOOR_USE_COLORS: Record<FloorUseType, { fill: string; bg: string; text: string }> = {
  parking:       { fill: "#6b7280", bg: "bg-gray-500/20",    text: "text-gray-400" },
  retail:        { fill: "#f59e0b", bg: "bg-amber-500/20",   text: "text-amber-400" },
  lobby_amenity: { fill: "#8b5cf6", bg: "bg-violet-500/20",  text: "text-violet-400" },
  residential:   { fill: "#3b82f6", bg: "bg-blue-500/20",    text: "text-blue-400" },
  mechanical:    { fill: "#ef4444", bg: "bg-red-500/20",     text: "text-red-400" },
  office:        { fill: "#10b981", bg: "bg-emerald-500/20", text: "text-emerald-400" },
};

export const FLOOR_HEIGHT_DEFAULTS: Record<FloorUseType, number> = {
  parking: 10,
  retail: 14,
  lobby_amenity: 12,
  residential: 9.5,
  mechanical: 8,
  office: 12,
};

export const PARKING_ABOVE_GRADE_HEIGHT = 11;

export interface FloorAdditionalUse {
  id: string;
  use_type: FloorUseType;
  sf: number;
}

export interface BuildingFloor {
  id: string;
  use_type: FloorUseType;  // primary use
  label: string;
  floor_plate_sf: number;  // TOTAL plate SF (primary + all additional uses)
  floor_to_floor_ft: number;
  is_below_grade: boolean;
  units_on_floor: number;
  efficiency_pct: number;
  sort_order: number;
  // Multi-use floor support (N uses). Each additional use carves its own
  // SF out of the plate; the PRIMARY use gets the remainder
  // (floor_plate_sf − Σ additional_uses.sf). Legacy rows may still have
  // the deprecated secondary_use/secondary_sf fields — they are
  // normalized into this array on load via normalizeFloor().
  additional_uses?: FloorAdditionalUse[];
  /** @deprecated use additional_uses[] instead */
  secondary_use?: FloorUseType | null;
  /** @deprecated use additional_uses[] instead */
  secondary_sf?: number;
}

export interface UnitMixEntry {
  id: string;
  type_label: string;        // e.g. "Studio", "1-Br", "2-Br", "3-Br"
  allocation_pct: number;    // % of total units (should sum to 100)
  avg_sf: number;            // average SF per unit of this type
  // Computed (not stored, derived at render):
  // unit_count, total_sf
}

export const DEFAULT_UNIT_MIX: Array<{ type_label: string; allocation_pct: number; avg_sf: number }> = [
  { type_label: "Studio", allocation_pct: 15, avg_sf: 420 },
  { type_label: "1-Br", allocation_pct: 50, avg_sf: 562 },
  { type_label: "2-Br", allocation_pct: 28, avg_sf: 716 },
  { type_label: "3-Br", allocation_pct: 7, avg_sf: 900 },
];

export interface MassingScenario {
  id: string;
  name: string;
  floors: BuildingFloor[];
  footprint_sf: number;
  density_bonus_applied: string | null;
  density_bonus_far_increase: number;
  density_bonus_height_increase_ft: number;
  notes: string;
  created_at: string;
  is_baseline: boolean;
  linked_uw_scenario_id: string | null;
  unit_mix: UnitMixEntry[];
  parking_sf_per_space: number;  // legacy single rate; kept for backwards compat
  // Per-parking-type SF/space rates. Above-grade parking uses the
  // structured rate; below-grade uses the underground rate; surface is
  // carried for reference / future site-plan integrations.
  parking_surface_sf_per_space?: number;
  parking_structured_sf_per_space?: number;
  parking_underground_sf_per_space?: number;
  // Optional link to a building drawn on the site plan. When set, the
  // scenario's footprint_sf is sourced from that building's area_sf. When
  // null, the scenario uses its own typed footprint (legacy behaviour).
  site_plan_building_id?: string | null;
  // Optional link to the site-plan scenario (Massing) this stack
  // belongs to. Combined with site_plan_building_id this uniquely
  // identifies a (massing, building) pair: one MassingScenario per
  // building per massing. Lets Programming render
  // tabs(massing) > tabs(building) > one floor stack per cell.
  site_plan_scenario_id?: string | null;
  // Label of the AI-generated template that produced the current floor
  // stack ("Podium 5-over-1", etc). Cleared when the user manually
  // re-orders or re-edits floors. Used to decorate the AI Generate
  // button with the most-recently-used preset name.
  ai_template_label?: string | null;
}

export interface BuildingProgram {
  scenarios: MassingScenario[];
  active_scenario_id: string;
}

// ─── Site Plan (parcel + building footprint(s) on satellite) ─────────────────
//
// Stored under underwriting.data.site_plan. Used by the Site & Zoning page to
// let analysts trace the parcel, draw one or more building footprints, and
// preview setbacks on a to-scale satellite map. Each drawn building can be
// linked to a Programming-page massing scenario via site_plan_building_id so
// multi-phase / multi-structure projects get a per-building floor stack.
//
// Backwards compatibility: earlier versions stored a single building as
// `building_points` / `building_area_sf`. Those fields are kept on the type
// for read-time migration — the site-zoning page hydrates legacy data into
// `buildings[0]` when loading. They are no longer written by the UI.
export interface SitePlanPoint {
  lat: number;
  lng: number;
}

// A cutout is a labeled void inside a building — typically a Texas-
// donut style courtyard. It's attached to the building, not the
// massing, so it travels with the footprint. Cutouts are subtracted
// from the floors above the podium in per-floor SF math; for now we
// just store them + their computed area so the analyst can do the
// math on the massing side.
export interface SitePlanCutout {
  id: string;
  label: string;          // "Cutout 1" (editable)
  points: SitePlanPoint[];
  area_sf: number;
}

export interface SitePlanBuilding {
  id: string;
  label: string;          // "Building A", "Tower 1", etc.
  points: SitePlanPoint[];
  area_sf: number;
  // Optional cutouts — courtyards / light wells / other voids.
  // Rendered as holes in the building polygon. Kept optional so
  // legacy buildings without this field continue to work.
  cutouts?: SitePlanCutout[];
}

// A site-plan scenario — also the unit of "Massing" in the rest of the
// app. Each one owns its own parcel polygon + buildings list. The user-
// visible label everywhere is "Massing N" (Site Plan, Programming, and
// Underwriting all align on this term so analysts see one concept end-
// to-end). The interface is still named SitePlanScenario in code to
// keep the legacy field name compatible.
export interface SitePlanScenario {
  id: string;
  name: string;
  notes?: string;
  parcel_points: SitePlanPoint[];
  parcel_area_sf: number;
  buildings: SitePlanBuilding[];
  active_building_id: string | null;
  created_at: string;
  // Star one massing as the project's "base case". Used by Programming
  // + Underwriting as the default when nothing else is explicitly
  // selected. Only one massing per site plan should carry the flag;
  // the setter on the site-zoning + programming pages clears it on
  // siblings before flipping this one on.
  is_base_case?: boolean;
  // Optional frontage polyline (open, multi-segment) — used to feed
  // linear-SF of frontage into dev-budget line items that price by
  // curb cut / sidewalk / street improvements. Stored per massing so
  // alternative massings can have different frontage treatments.
  frontage_points?: SitePlanPoint[];
  frontage_length_ft?: number;
}

export interface SitePlan {
  // Map view saved between sessions (shared across scenarios)
  center_lat: number | null;
  center_lng: number | null;
  zoom: number;
  map_style: "satellite" | "streets" | "dark" | "light";

  // Scenarios — each owns its own parcel + buildings. The active one is
  // what the generator draws; the others persist alongside for toggling.
  scenarios: SitePlanScenario[];
  active_scenario_id: string | null;

  // Setback visualization (shared across scenarios — they use the same
  // zoning setback values)
  show_setbacks: boolean;

  // Snapping options (shared across scenarios)
  snap_right_angle: boolean;
  snap_vertex: boolean;
  snap_grid_ft: number;

  updated_at: string;

  // ── Legacy (read-only migration) ────────────────────────────────────────
  // Prior versions stored a single parcel + buildings list at the top
  // level; even earlier ones used { building_points, building_area_sf }.
  // The site-zoning page migrates these into scenarios[0] on load, and
  // the UI never writes them again. Typing them as optional here keeps
  // the JSON blob readable without a schema version bump.
  parcel_points?: SitePlanPoint[];
  parcel_area_sf?: number;
  buildings?: SitePlanBuilding[];
  active_building_id?: string | null;
  building_points?: SitePlanPoint[];
  building_area_sf?: number;
}

export const DEFAULT_SITE_PLAN: SitePlan = {
  center_lat: null,
  center_lng: null,
  zoom: 20,
  map_style: "satellite",
  scenarios: [],
  active_scenario_id: null,
  show_setbacks: true,
  snap_right_angle: true,
  snap_vertex: true,
  snap_grid_ft: 0,
  updated_at: "",
};

// ─── Saved Underwriting Scenarios ────────────────────────────────────────
//
// A UWScenario is a named snapshot of the key underwriting inputs at the
// moment the analyst "pushes" it — meant for comparing alternatives
// (e.g. "Base Case", "With 35% density bonus", "Hybrid tower") without
// losing the current working set. Stored under
// underwriting.data.uw_scenarios[] and loadable back into live state.
//
// We deliberately snapshot only the fields that drive the numbers the
// analyst is comparing; we don't snapshot zoning/site info since those
// usually don't vary between alternatives. Fields stored are opaque so
// the shape stays flexible if the BuildingProgram schema evolves.
export interface UWScenario {
  id: string;
  name: string;
  notes?: string;
  created_at: string;
  // Foreign-key back to the site-plan scenario that was active when the
  // snapshot was taken (null if no site plan was drawn).
  site_plan_scenario_id: string | null;
  // Opaque snapshots of the relevant state.
  building_program: unknown;
  unit_groups: unknown[];
  other_income_items?: unknown[];
  commercial_tenants?: unknown[];
  // Lightweight display summary for the saved-scenarios list so we don't
  // have to recompute it on every render. All optional since some of
  // these may not apply to every project type.
  summary?: {
    total_gsf?: number;
    total_nrsf?: number;
    total_units?: number;
    total_parking_spaces_est?: number;
    buildings_count?: number;
  };
}

// Factory for a fresh, empty scenario.
export function newSitePlanScenario(name: string): SitePlanScenario {
  return {
    id:
      (typeof crypto !== "undefined" && typeof (crypto as { randomUUID?: () => string }).randomUUID === "function"
        ? (crypto as { randomUUID: () => string }).randomUUID()
        : `sps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name,
    parcel_points: [],
    parcel_area_sf: 0,
    buildings: [],
    active_building_id: null,
    created_at: new Date().toISOString(),
  };
}

export interface MassingSummary {
  total_gsf: number;
  total_nrsf: number;
  total_height_ft: number;
  total_below_grade_ft: number;
  above_grade_floors: number;
  below_grade_floors: number;
  total_units: number;
  total_parking_sf: number;
  total_parking_spaces_est: number;
  gsf_by_use: Partial<Record<FloorUseType, number>>;
  nrsf_by_use: Partial<Record<FloorUseType, number>>;
  effective_far: number;
  effective_lot_coverage_pct: number;
  height_compliant: boolean;
  far_compliant: boolean;
  lot_coverage_compliant: boolean;
  max_allowed_far: number;
  max_allowed_height_ft: number;
}

// ─── Other Income (Dynamic Line Items) ────────────────────────────────────

export interface OtherIncomeItem {
  id: string;
  label: string;              // e.g., "RUBS", "Pet Rent", "Storage", "Parking"
  amount: number;             // $ amount
  basis: "per_unit" | "per_property" | "per_space";  // how it's charged
  unit_type_filter: string;   // "" = all units, or specific type label to filter
  notes: string;
}

export const COMMON_OTHER_INCOME = [
  { label: "RUBS (Utility Reimbursement)", basis: "per_unit" as const, amount: 50 },
  { label: "Parking — Reserved", basis: "per_space" as const, amount: 200 },
  { label: "Parking — Unreserved", basis: "per_space" as const, amount: 100 },
  { label: "Pet Rent", basis: "per_unit" as const, amount: 35 },
  { label: "Storage Units", basis: "per_property" as const, amount: 0 },
  { label: "Laundry", basis: "per_property" as const, amount: 0 },
  { label: "Application Fees", basis: "per_property" as const, amount: 0 },
  { label: "Cable / Internet", basis: "per_unit" as const, amount: 0 },
  { label: "Vending", basis: "per_property" as const, amount: 0 },
  { label: "Late Fees", basis: "per_property" as const, amount: 0 },
];

// ─── Commercial Tenants ──────────────────────────────────────────────────

export type CommercialLeaseType = "NNN" | "MG" | "Gross" | "Modified Gross";

export interface CommercialTenant {
  id: string;
  tenant_name: string;
  suite: string;
  use_type: "retail" | "office" | "restaurant" | "other";
  sf: number;
  rent_per_sf: number;        // annual $/SF
  lease_type: CommercialLeaseType;
  cam_reimbursement_pct: number;  // % of CAM pool reimbursed
  ti_allowance_per_sf: number;
  lc_pct: number;             // leasing commission % of year 1 rent
  free_rent_months: number;
  rent_escalation_pct: number;  // annual escalation %
  lease_start: string;
  lease_term_years: number;
  notes: string;
}

// ─── API Response ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
