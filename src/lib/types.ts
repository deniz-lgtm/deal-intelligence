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
  status: DealStatus;
  starred: boolean;
  asking_price: number | null;
  square_footage: number | null;
  units: number | null;
  bedrooms: number | null;
  year_built: number | null;
  notes: string | null;
  loi_executed: boolean;
  psa_executed: boolean;
  business_plan_id: string | null;
  created_at: string;
  updated_at: string;
}

export type NewDeal = Omit<Deal, "id" | "created_at" | "updated_at">;

// ─── Deal Notes ───────────────────────────────────────────────────────────

export type DealNoteCategory = "context" | "thesis" | "risk" | "review";

export const DEAL_NOTE_CATEGORIES: Record<DealNoteCategory, { label: string; description: string; inMemory: boolean }> = {
  context: { label: "Deal Context", description: "Broker intel, seller motivation, market conditions", inMemory: true },
  thesis: { label: "Investment Thesis", description: "Investment rationale, strategy notes", inMemory: true },
  risk: { label: "Key Risk", description: "Red flags, concerns, issues to watch", inMemory: true },
  review: { label: "Team Review", description: "Notes for IC/team discussion", inMemory: false },
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
  uploaded_at: string;
}

// ─── Underwriting ────────────────────────────────────────────────────────────

export interface UnitGroup {
  id: string;
  label: string;             // e.g., "3BR/2BA" or "Flex Bay — Suite 101"
  unit_count: number;
  will_renovate: boolean;
  renovation_cost_per_unit: number;
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

// ─── LOI ────────────────────────────────────────────────────────────────────

export interface LOIData {
  // Parties
  buyer_entity: string;
  buyer_contact: string;
  buyer_address: string;
  seller_name: string;
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
  // Other
  as_is: boolean;
  broker_name: string;
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
];

// ─── Chat ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  deal_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ─── API Response ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
