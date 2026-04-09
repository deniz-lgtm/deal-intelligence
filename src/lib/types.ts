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
  is_key: boolean;
  // Document Intelligence Pipeline: version chain within the same deal
  parent_document_id: string | null;
  version: number;
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
