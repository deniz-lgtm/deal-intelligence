"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash2, Save, Loader2, TrendingUp, DollarSign,
  Calculator, ChevronDown, ChevronUp, RefreshCw, Hammer, Sparkles, X, Check, FileText, Eye, PanelRightClose, GripVertical, BarChart3, Target, Pencil, GitCompare,
  Car, Building2, Layers, Construction, ArrowDownUp,
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import DealNotes from "@/components/DealNotes";
import { useSetPageContext } from "@/lib/page-context";
import AffordabilityPlanner, { type AffordabilityConfig } from "@/components/AffordabilityPlanner";
import AmiReference from "@/components/AmiReference";
import { splitUnitGroupsByAffordability } from "@/lib/affordability-split";
import type {
  DevBudgetLineItem, ParkingConfig, ParkingEntry, ParkingType,
  LeaseUpConfig, ConstructionLoanConfig, ConstructionDrawPeriod,
  MixedUseConfig, MixedUseComponent, MixedUseComponentType,
  RedevelopmentConfig,
  UWScenario as UWScenarioType,
} from "@/lib/types";
import {
  DEFAULT_DEV_BUDGET_HARD, DEFAULT_DEV_BUDGET_SOFT,
  PARKING_TYPE_LABELS, PARKING_COST_DEFAULTS,
  MIXED_USE_COMPONENT_LABELS,
} from "@/lib/types";
import { useViewMode } from "@/lib/use-view-mode";
import ViewModeToggle from "@/components/ViewModeToggle";

type LeaseType = "NNN" | "MG" | "Gross" | "Modified Gross";

interface UnitGroup {
  id: string; label: string; unit_count: number;
  renovation_count: number; renovation_cost_per_unit: number;
  unit_change: "none" | "add" | "remove"; unit_change_count: number;
  // Shared
  bedrooms: number; bathrooms: number; sf_per_unit: number;
  // Commercial (SF-based)
  current_rent_per_sf: number; market_rent_per_sf: number;
  lease_type: LeaseType; expense_reimbursement_per_sf: number;
  // Multifamily (unit-based, monthly)
  current_rent_per_unit: number; market_rent_per_unit: number;
  // Student Housing (bed-based, monthly)
  beds_per_unit: number; current_rent_per_bed: number; market_rent_per_bed: number;
  // Optional notes (AI-generated or analyst-entered) displayed in the
  // Revenue table. Used by "AI Generate Rents" to explain its source.
  notes?: string;
}

interface CapexItem { id: string; label: string; quantity: number; cost_per_unit: number; linked_unit_group_id?: string; }

interface RentComp {
  name: string; address: string; distance_mi: number; year_built: number;
  units?: number; total_sf?: number; occupancy_pct: number;
  unit_types?: Array<{ type: string; sf: number; rent: number }>;
  rent_per_sf?: number; lease_type?: string; tenant_type?: string;
  amenities?: string; notes?: string;
}

type DCFYear = {
  year: number;
  gpr: number;
  vacancyLoss: number;
  egi: number;
  otherIncome: number;
  reimbursements: number;
  totalOpEx: number;
  leasingCommissions: number;
  noi: number;
  debtService: number;
  debtLabel: string;
  cashFlow: number;
  coc: number;
  refiProceeds: number;
};

type ScenarioType = "custom" | "land_residual" | "rent_target" | "exit_cap";
interface Scenario {
  id: string;
  name: string;
  type: ScenarioType;
  description: string;
  overrides: Partial<UWData>;
}

// Target-return metrics available to the scenario goal-seek wizard.
// Each maps 1:1 to a field returned by calc(). They all share the property
// that a higher purchase_price / lower rents / higher exit cap DECREASES them,
// so the existing bisection logic in solveScenario works uniformly.
type WizardMetric = "em" | "coc" | "stabilizedCoC" | "irr" | "dscr" | "stabilizedDSCR" | "capRate" | "yoc";

interface WizardMetricMeta {
  key: WizardMetric;
  label: string;
  suffix: "x" | "%";
  // Which scenario types this metric is meaningful for. exit_cap only affects
  // exit-dependent metrics (em / irr); the rest are unchanged by exit cap.
  scenarios: ScenarioType[];
  // Pull a default target from the deal's business plan if one is set
  bpKey?: "target_equity_multiple_min" | "target_irr_min";
}

const WIZARD_METRICS: WizardMetricMeta[] = [
  { key: "em", label: "Equity Multiple", suffix: "x", scenarios: ["land_residual", "rent_target", "exit_cap"], bpKey: "target_equity_multiple_min" },
  { key: "irr", label: "IRR", suffix: "%", scenarios: ["land_residual", "rent_target", "exit_cap"], bpKey: "target_irr_min" },
  { key: "coc", label: "Cash-on-Cash (Yr 1)", suffix: "%", scenarios: ["land_residual", "rent_target"] },
  { key: "stabilizedCoC", label: "Stabilized CoC", suffix: "%", scenarios: ["land_residual", "rent_target"] },
  { key: "dscr", label: "DSCR", suffix: "x", scenarios: ["land_residual", "rent_target"] },
  { key: "stabilizedDSCR", label: "Stabilized DSCR", suffix: "x", scenarios: ["land_residual", "rent_target"] },
  { key: "capRate", label: "Cap Rate (Proforma)", suffix: "%", scenarios: ["land_residual", "rent_target"] },
  { key: "yoc", label: "Yield on Cost", suffix: "%", scenarios: ["land_residual", "rent_target"] },
];

const SCENARIO_TYPES: Array<{ type: ScenarioType; label: string; description: string; icon: string }> = [
  { type: "land_residual", label: "Max Purchase Price", description: "Find the maximum purchase price to hit your return targets", icon: "🏷️" },
  { type: "rent_target", label: "Required Rents", description: "Find the minimum rents needed to hit your return targets", icon: "📈" },
  { type: "exit_cap", label: "Exit Cap Sensitivity", description: "Find what exit cap rate is needed to hit your return targets", icon: "🎯" },
  { type: "custom", label: "Custom What-If", description: "Start from baseline and manually adjust any assumptions", icon: "✏️" },
];

interface ZoningData {
  far?: number; max_height?: number; lot_coverage?: number;
  setbacks?: { front?: number; side?: number; rear?: number };
  overlays?: string[]; density_bonuses?: string[];
}

interface CustomOpexRow {
  id: string;
  label: string;
  ip_annual: number;
  pf_annual: number;
  cam: boolean;
}

interface UWData {
  purchase_price: number; closing_costs_pct: number;
  unit_groups: UnitGroup[]; capex_items: CapexItem[];
  custom_opex: CustomOpexRow[];
  vacancy_rate: number; in_place_vacancy_rate: number; management_fee_pct: number;
  taxes_annual: number; insurance_annual: number; repairs_annual: number;
  utilities_annual: number; other_expenses_annual: number;
  ga_annual: number; marketing_annual: number; reserves_annual: number;
  // In-place opex overrides (annual)
  ip_mgmt_annual: number; ip_taxes_annual: number; ip_insurance_annual: number;
  ip_repairs_annual: number; ip_utilities_annual: number; ip_other_annual: number;
  ip_ga_annual: number; ip_marketing_annual: number; ip_reserves_annual: number;
  has_financing: boolean; acq_ltc: number; acq_interest_rate: number;
  acq_pp_ltv: number; acq_capex_ltv: number;
  acq_amort_years: number; acq_io_years: number;
  acq_loan_narrative: string;
  has_refi: boolean; refi_year: number; refi_ltv: number;
  refi_rate: number; refi_amort_years: number;
  refi_loan_narrative: string;
  // Other income (monthly, property-level)
  rubs_per_unit_monthly: number; parking_monthly: number; laundry_monthly: number;
  // Per-space parking revenue
  parking_reserved_spaces: number;
  parking_reserved_rate: number;       // $/space/month
  parking_unreserved_spaces: number;
  parking_unreserved_rate: number;     // $/space/month
  rent_growth_pct: number; expense_growth_pct: number;
  exit_cap_rate: number; hold_period_years: number; notes: string;
  scenarios: Scenario[];
  rent_comps: RentComp[];
  rent_comp_unit_types: string[];
  selected_comp_ids: number[];
  // Ground-up development fields
  development_mode: boolean;
  land_cost: number;
  hard_cost_per_sf: number;
  soft_cost_pct: number;  // % of hard costs
  // Site & building calc
  lot_coverage_pct: number;
  far: number;
  height_limit_stories: number;
  max_gsf: number;
  efficiency_pct: number;
  max_nrsf: number;
  // CAM (Common Area Maintenance) flags — which OpEx categories are reimbursable
  cam_taxes: boolean; cam_insurance: boolean; cam_repairs: boolean;
  cam_utilities: boolean; cam_ga: boolean; cam_marketing: boolean;
  cam_reserves: boolean; cam_other: boolean; cam_management: boolean;
  // Leasing commissions
  lc_new_pct: number;       // % of first-year rent for new leases
  lc_renewal_pct: number;   // % of first-year rent for renewals
  lc_renewal_prob: number;  // assumed % of tenants that renew
  // Zoning
  zoning_designation: string;
  zoning_data: ZoningData | null;
  // ── Ground-Up Development Budget (itemized) ──
  dev_budget_items: DevBudgetLineItem[];
  // ── Parking Configuration ──
  parking: ParkingConfig | null;
  // ── Absorption / Lease-Up ──
  lease_up: LeaseUpConfig | null;
  // ── Construction Loan ──
  construction_loan: ConstructionLoanConfig | null;
  // ── Mixed-Use Components ──
  mixed_use: MixedUseConfig | null;
  // ── Redevelopment Overlay ──
  redevelopment: RedevelopmentConfig | null;
  // Programming page data (read-only on UW page)
  building_program: any;
  commercial_tenants: any[];
  other_income_items: any[];
  // Site data (from site-zoning page)
  site_info: any;
  // AI estimate narratives
  opex_narrative: string;
  loan_narrative: string;
  // Affordability config (set from Programming page or the in-page
  // AffordabilityPlanner). The shape is owned by AffordabilityPlanner — see
  // src/components/AffordabilityPlanner.tsx.
  affordability_config: AffordabilityConfig | null;
}

const DEFAULT: UWData = {
  purchase_price: 0, closing_costs_pct: 2,
  unit_groups: [], capex_items: [],
  custom_opex: [
    { id: "default-contracts", label: "Contracts", ip_annual: 0, pf_annual: 0, cam: false },
    { id: "default-staff", label: "Staff", ip_annual: 0, pf_annual: 0, cam: false },
  ],
  vacancy_rate: 5, in_place_vacancy_rate: 5, management_fee_pct: 4,
  taxes_annual: 0, insurance_annual: 0, repairs_annual: 0,
  utilities_annual: 0, other_expenses_annual: 0,
  ga_annual: 0, marketing_annual: 0, reserves_annual: 0,
  ip_mgmt_annual: 0, ip_taxes_annual: 0, ip_insurance_annual: 0,
  ip_repairs_annual: 0, ip_utilities_annual: 0, ip_other_annual: 0,
  ip_ga_annual: 0, ip_marketing_annual: 0, ip_reserves_annual: 0,
  rubs_per_unit_monthly: 0, parking_monthly: 0, laundry_monthly: 0,
  parking_reserved_spaces: 0, parking_reserved_rate: 0,
  parking_unreserved_spaces: 0, parking_unreserved_rate: 0,
  has_financing: true, acq_ltc: 65, acq_interest_rate: 6.5,
  acq_pp_ltv: 70, acq_capex_ltv: 100,
  acq_amort_years: 25, acq_io_years: 0,
  acq_loan_narrative: "",
  has_refi: false, refi_year: 3, refi_ltv: 70,
  refi_rate: 6.0, refi_amort_years: 25,
  refi_loan_narrative: "",
  rent_growth_pct: 3, expense_growth_pct: 3,
  exit_cap_rate: 5.5, hold_period_years: 5, notes: "",
  scenarios: [],
  rent_comps: [],
  rent_comp_unit_types: [],
  selected_comp_ids: [],
  // Ground-up development defaults
  development_mode: false,
  land_cost: 0,
  hard_cost_per_sf: 0,
  soft_cost_pct: 0,
  lot_coverage_pct: 40,
  far: 0,
  height_limit_stories: 0,
  max_gsf: 0,
  efficiency_pct: 100,
  max_nrsf: 0,
  // CAM defaults — for NNN, taxes/insurance/repairs/utilities are typically reimbursable
  cam_taxes: true, cam_insurance: true, cam_repairs: true,
  cam_utilities: true, cam_ga: false, cam_marketing: false,
  cam_reserves: false, cam_other: false, cam_management: false,
  // Leasing commissions
  lc_new_pct: 6, lc_renewal_pct: 3, lc_renewal_prob: 60,
  zoning_designation: "",
  zoning_data: null,
  // Ground-up development budget (itemized)
  dev_budget_items: [],
  // Parking
  parking: null,
  // Lease-up
  lease_up: null,
  // Construction loan
  construction_loan: null,
  // Mixed-use
  mixed_use: null,
  // Redevelopment
  redevelopment: null,
  // Programming page data
  building_program: null,
  commercial_tenants: [],
  other_income_items: [],
  site_info: null,
  opex_narrative: "",
  loan_narrative: "",
  affordability_config: null,
};

// Property-type-aware defaults — overrides the generic DEFAULT based on deal.property_type
const PROPERTY_OVERRIDES: Record<string, Partial<UWData>> = {
  multifamily: {
    vacancy_rate: 5, management_fee_pct: 4, exit_cap_rate: 5.5,
    rent_growth_pct: 3, expense_growth_pct: 3, lc_new_pct: 0, lc_renewal_pct: 0,
  },
  sfr: {
    vacancy_rate: 6, management_fee_pct: 8, exit_cap_rate: 5.5,
    rent_growth_pct: 3, expense_growth_pct: 3, lc_new_pct: 0, lc_renewal_pct: 0,
  },
  student_housing: {
    vacancy_rate: 7, management_fee_pct: 4, exit_cap_rate: 6.0,
    rent_growth_pct: 3, expense_growth_pct: 3, lc_new_pct: 0, lc_renewal_pct: 0,
  },
  office: {
    vacancy_rate: 10, management_fee_pct: 3, exit_cap_rate: 7.0,
    rent_growth_pct: 2.5, expense_growth_pct: 3, lc_new_pct: 5, lc_renewal_pct: 2.5,
    cam_taxes: true, cam_insurance: true, cam_repairs: true, cam_utilities: true,
  },
  retail: {
    vacancy_rate: 7, management_fee_pct: 2.5, exit_cap_rate: 6.5,
    rent_growth_pct: 2, expense_growth_pct: 3, lc_new_pct: 6, lc_renewal_pct: 3,
    cam_taxes: true, cam_insurance: true, cam_repairs: true, cam_utilities: true,
  },
  industrial: {
    vacancy_rate: 5, management_fee_pct: 2.5, exit_cap_rate: 6.0,
    rent_growth_pct: 3.5, expense_growth_pct: 3, lc_new_pct: 4, lc_renewal_pct: 2,
    cam_taxes: true, cam_insurance: true, cam_repairs: true, cam_utilities: true,
  },
  mixed_use: {
    vacancy_rate: 7, management_fee_pct: 3.5, exit_cap_rate: 6.0,
    rent_growth_pct: 2.5, expense_growth_pct: 3, lc_new_pct: 6, lc_renewal_pct: 3,
  },
  hospitality: {
    vacancy_rate: 30, management_fee_pct: 4, exit_cap_rate: 8.0,
    rent_growth_pct: 2, expense_growth_pct: 3, lc_new_pct: 0, lc_renewal_pct: 0,
  },
};

function getDefaultsForPropertyType(propertyType: string | undefined): UWData {
  const overrides = PROPERTY_OVERRIDES[propertyType || ""] || {};
  return { ...DEFAULT, ...overrides };
}

const EFFICIENCY_DEFAULTS: Record<string, number> = {
  industrial: 98, multifamily: 80, sfr: 95, student_housing: 78,
  office: 87, retail: 95, mixed_use: 85, other: 90,
};

const newGroup = (): UnitGroup => ({
  id: uuidv4(), label: "", unit_count: 1,
  renovation_count: 0, renovation_cost_per_unit: 0,
  unit_change: "none" as const, unit_change_count: 0,
  bedrooms: 1, bathrooms: 1, sf_per_unit: 0,
  // Commercial defaults
  current_rent_per_sf: 0, market_rent_per_sf: 0,
  lease_type: "NNN", expense_reimbursement_per_sf: 0,
  // MF defaults (monthly per unit)
  current_rent_per_unit: 0, market_rent_per_unit: 0,
  // Student Housing defaults (monthly per bed)
  beds_per_unit: 1, current_rent_per_bed: 0, market_rent_per_bed: 0,
});

const newCapex = (): CapexItem => ({ id: uuidv4(), label: "CapEx Item", quantity: 1, cost_per_unit: 0 });

// ── Factory helpers for new feature types ────────────────────────────────
function newDevBudgetItem(label: string, category: "hard" | "soft", subcategory: string, unit_label: string): DevBudgetLineItem {
  const isPct = unit_label === "% of hard";
  return { id: uuidv4(), label, category, subcategory, amount: 0, quantity: 0, unit_cost: 0, unit_label, is_pct: isPct, pct_basis: isPct ? "hard_costs" : "none", pct_value: isPct ? (subcategory === "contingency" ? 5 : subcategory === "general_conditions" || subcategory === "contractor_fee" ? 4 : subcategory === "dev_fee" ? 4 : subcategory === "a_and_e" ? 8 : 0) : 0, notes: "" };
}

function seedDevBudget(d?: UWData): DevBudgetLineItem[] {
  // Auto-populate quantities from programming/massing data
  const landSF = d?.site_info?.land_sf || 0;
  const gsf = d?.max_gsf || 0;
  const nrsf = d?.max_nrsf || 0;
  const totalUnits = d?.unit_groups?.reduce((s: number, g: any) => s + (g.unit_count || 0), 0) || 0;
  const parkingSpaces = d?.parking?.entries?.reduce((s: number, e: any) => s + (e.spaces || 0), 0) || 0;

  const autoQty = (source: string): number => {
    if (source === "land_sf") return landSF;
    if (source === "max_gsf") return gsf;
    if (source === "max_nrsf") return nrsf;
    if (source === "parking_spaces") return parkingSpaces;
    if (source === "total_units") return totalUnits;
    return 0;
  };

  return [
    ...DEFAULT_DEV_BUDGET_HARD.map(h => {
      const item = newDevBudgetItem(h.label, "hard", h.subcategory, h.unit_label);
      if (h.auto_qty_source !== "pct" && h.auto_qty_source !== "manual") item.quantity = autoQty(h.auto_qty_source);
      return item;
    }),
    ...DEFAULT_DEV_BUDGET_SOFT.map(s => {
      const item = newDevBudgetItem(s.label, "soft", s.subcategory, s.unit_label);
      if (s.auto_qty_source !== "pct" && s.auto_qty_source !== "manual" && s.auto_qty_source !== "computed") item.quantity = autoQty(s.auto_qty_source);
      return item;
    }),
  ];
}

function newParkingEntry(type: ParkingType = "surface"): ParkingEntry {
  return { id: uuidv4(), type, spaces: 0, cost_per_space: PARKING_COST_DEFAULTS[type], reserved_residential_spaces: 0, reserved_monthly_rate: 0, unreserved_spaces: 0, unreserved_monthly_rate: 0, guest_visitor_spaces: 0, retail_shared_spaces: 0, retail_shared_monthly_rate: 0 };
}

function defaultParkingConfig(): ParkingConfig {
  return {
    entries: [], zoning_required_ratio_residential: 1.5, zoning_required_ratio_commercial: 4.0,
    shared_parking_enabled: false, shared_parking_study_completed: false,
    shared_parking_study_date: null, shared_parking_study_firm: "",
    peak_demand_residential_weekday_pct: 60, peak_demand_residential_evening_pct: 95, peak_demand_residential_weekend_pct: 85,
    peak_demand_office_weekday_pct: 90, peak_demand_office_evening_pct: 10, peak_demand_office_weekend_pct: 5,
    peak_demand_retail_weekday_pct: 60, peak_demand_retail_evening_pct: 80, peak_demand_retail_weekend_pct: 100,
    spaces_needed_residential: 0, spaces_needed_office: 0, spaces_needed_retail: 0,
    shared_parking_reduction_pct: 0,
  };
}

function defaultLeaseUp(): LeaseUpConfig {
  return { construction_months: 18, absorption_units_per_month: 15, concession_free_months: 1, concession_per_unit: 0, stabilization_occupancy_pct: 93 };
}

function defaultConstructionLoan(): ConstructionLoanConfig {
  return { ltc_pct: 65, rate: 7.5, term_months: 24, draw_schedule: [] };
}

function newMixedUseComponent(type: MixedUseComponentType): MixedUseComponent {
  return { id: uuidv4(), component_type: type, label: MIXED_USE_COMPONENT_LABELS[type], sf_allocation: 0, unit_groups: [], opex_mode: "shared", opex_allocation_pct: type === "residential" ? 70 : 30, cap_rate: type === "residential" ? 5.0 : 6.5, ti_allowance_per_sf: 0, leasing_commission_pct: type === "retail" ? 6 : 0, free_rent_months: 0, rent_escalation_pct: 3 };
}

function defaultMixedUseConfig(): MixedUseConfig {
  return { enabled: false, total_gfa: 0, components: [], common_area_sf: 0 };
}

/**
 * Seed `mixed_use.components` from the active massing scenario's
 * `nrsf_by_use` when the config is empty — so the per-component inputs on
 * the OpEx / Exit / Lease-Up sections have something to render for
 * mixed-use deals without the analyst having to hand-build the list.
 *
 * Idempotent:
 *   • Preserves existing components + their settings (only adds missing
 *     component_types, never overwrites).
 *   • No-op for non-mixed-use deals unless the scenario already has
 *     multiple use types (e.g. commercial property_type with a residential
 *     massing floor).
 *   • Updates each preserved component's sf_allocation to the latest
 *     nrsf_by_use so Programming changes carry through.
 */
function seedMixedUseFromProgram(
  existing: MixedUseConfig | null | undefined,
  buildingProgram: unknown,
  propertyType: string | undefined
): MixedUseConfig | null {
  const bp = buildingProgram as {
    scenarios?: Array<{ id: string; is_baseline?: boolean; floors?: unknown[] }>;
    active_scenario_id?: string;
  } | null | undefined;
  if (!bp || !bp.scenarios || bp.scenarios.length === 0) return existing ?? null;

  const activeScenario =
    bp.scenarios.find((s) => s.is_baseline) ||
    bp.scenarios.find((s) => s.id === bp.active_scenario_id) ||
    bp.scenarios[0];
  if (!activeScenario || !activeScenario.floors) return existing ?? null;

  // Tally NRSF per use type from the floors directly (keeps this function
  // dependency-free — we don't import massing-utils here). Handles both
  // the current multi-use shape (additional_uses[]) and the legacy
  // secondary_use/secondary_sf shape.
  const nrsfByUse: Record<string, number> = {};
  let totalGsf = 0;
  const effFor = (t?: string) =>
    t === "retail" ? 0.95
      : t === "office" ? 0.87
      : t === "parking" ? 0.98
      : t === "lobby_amenity" ? 0.60
      : t === "mechanical" ? 0
      : 0.80;
  for (const fRaw of activeScenario.floors) {
    const f = fRaw as {
      use_type?: string;
      secondary_use?: string;
      floor_plate_sf?: number;
      secondary_sf?: number;
      efficiency_pct?: number;
      additional_uses?: Array<{ use_type?: string; sf?: number }>;
    };
    const plate = Number(f.floor_plate_sf || 0);
    totalGsf += plate;
    const eff = Number(f.efficiency_pct || 80) / 100;

    // Normalize additional uses (with legacy secondary fallback)
    const additional: Array<{ use_type: string; sf: number }> = [];
    if (Array.isArray(f.additional_uses)) {
      for (const u of f.additional_uses) {
        if (u?.use_type && Number(u.sf || 0) > 0) additional.push({ use_type: u.use_type, sf: Number(u.sf) });
      }
    }
    if (additional.length === 0 && f.secondary_use && Number(f.secondary_sf || 0) > 0) {
      additional.push({ use_type: f.secondary_use, sf: Number(f.secondary_sf) });
    }

    const additionalTotal = additional.reduce((s, u) => s + u.sf, 0);
    const primarySf = Math.max(0, plate - additionalTotal);

    if (f.use_type) {
      nrsfByUse[f.use_type] = (nrsfByUse[f.use_type] || 0) + Math.round(primarySf * eff);
    }
    for (const u of additional) {
      nrsfByUse[u.use_type] = (nrsfByUse[u.use_type] || 0) + Math.round(u.sf * effFor(u.use_type));
    }
  }

  const relevantTypes = (["residential", "retail", "office"] as MixedUseComponentType[])
    .filter((t) => (nrsfByUse[t] || 0) > 0);

  // Detection: is this a mixed-use deal? Either property_type says so or
  // the massing has more than one revenue-producing use type.
  const isMixed = propertyType === "mixed_use" || relevantTypes.length > 1;
  if (!isMixed) return existing ?? null;

  const base = existing ?? defaultMixedUseConfig();
  const next: MixedUseConfig = { ...base, total_gfa: totalGsf, enabled: true };
  // Preserve existing components but refresh sf_allocation + add any new
  // use types that have appeared in the massing.
  const byType = new Map(next.components.map((c) => [c.component_type, c]));
  const updated: MixedUseComponent[] = [];
  for (const t of relevantTypes) {
    const existing_c = byType.get(t);
    if (existing_c) {
      updated.push({ ...existing_c, sf_allocation: nrsfByUse[t] || 0 });
    } else {
      updated.push({ ...newMixedUseComponent(t), sf_allocation: nrsfByUse[t] || 0 });
    }
  }
  next.components = updated;
  return next;
}

function defaultRedevelopment(): RedevelopmentConfig {
  return { enabled: false, existing_use: "", existing_sf: 0, existing_noi: 0, existing_occupancy_pct: 0, vacancy_period_months: 3, demolition_period_months: 3, construction_period_months: 18, demolition_items: [], is_phased: false, phase_1_label: "Phase 1 — Parking Lot", phase_1_sf: 0, phase_1_timeline_months: 18, phase_2_label: "Phase 2 — Main Building", phase_2_sf: 0, phase_2_timeline_months: 24, existing_parking_spaces: 0, parking_spaces_converted: 0, new_parking_spaces_built: 0 };
}

/** Use in-place value if it has been entered (> 0), otherwise fall back to pro forma. */
/** Return the in-place value as-is (0 means not entered → stays 0). */
function ipOr(ip: number, _pf: number): number { return ip || 0; }

function annualPayment(principal: number, rate: number, years: number): number {
  if (principal <= 0) return 0;
  if (years <= 0) return 0;       // IO / bullet loan — no amortizing payment
  if (rate === 0) return principal / years;  // 0% interest: straight principal paydown
  const r = rate / 100 / 12, n = years * 12;
  return (principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)) * 12;
}

/**
 * Remaining loan balance after `yearsPaid` years of a fully-amortizing loan.
 * Returns `principal` for IO / bullet loans (amortYears <= 0).
 */
function remainingBalance(principal: number, annualRate: number, amortYears: number, yearsPaid: number): number {
  if (principal <= 0) return 0;
  if (amortYears <= 0 || annualRate === 0) return principal; // IO: no paydown
  const r = annualRate / 100 / 12;
  const n = amortYears * 12;
  const p = Math.min(yearsPaid * 12, n); // can't pay beyond term
  return principal * (Math.pow(1 + r, n) - Math.pow(1 + r, p)) / (Math.pow(1 + r, n) - 1);
}

/**
 * Newton-Raphson XIRR (assumes end-of-year cash flows at integer year offsets).
 * `cashFlows[0]` is the initial equity outflow (negative), subsequent entries are
 * annual cash flows plus exit proceeds at the final year.
 * Returns the annual rate as a percentage, or 0 if it cannot converge.
 */
function xirr(cashFlows: number[]): number {
  if (cashFlows.length < 2) return 0;
  let rate = 0.1;
  for (let i = 0; i < 200; i++) {
    let npv = 0, dNpv = 0;
    for (let j = 0; j < cashFlows.length; j++) {
      const denom = Math.pow(1 + rate, j);
      npv  += cashFlows[j] / denom;
      dNpv -= j * cashFlows[j] / (denom * (1 + rate));
    }
    if (Math.abs(dNpv) < 1e-12) break;
    const delta = npv / dNpv;
    rate -= delta;
    if (Math.abs(delta) < 1e-8) break;
  }
  if (!isFinite(rate) || rate <= -1) return 0;
  return rate * 100;
}

function effectiveUnits(g: UnitGroup): number {
  const delta = (g.unit_change_count || 0);
  if (g.unit_change === "add") return g.unit_count + delta;
  if (g.unit_change === "remove") return Math.max(0, g.unit_count - delta);
  return g.unit_count;
}

function calc(d: UWData, mode: "commercial" | "multifamily" | "student_housing") {
  const totalUnits = d.unit_groups.reduce((s, g) => s + effectiveUnits(g), 0);
  const ipTotalUnits = d.unit_groups.reduce((s, g) => s + g.unit_count, 0);
  const ipTotalSF = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit, 0) : 0;
  const ipTotalBeds = mode === "student_housing" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.beds_per_unit, 0) : 0;
  const totalSF = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.sf_per_unit, 0) : 0;
  const totalBeds = mode === "student_housing" ? d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.beds_per_unit, 0) : 0;

  // ── Revenue (market uses effective units at market rent, in-place uses current) ──
  const gpr = mode === "student_housing"
    ? d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.beds_per_unit * g.market_rent_per_bed * 12, 0)
    : mode === "multifamily"
    ? d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.market_rent_per_unit * 12, 0)
    : d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.sf_per_unit * g.market_rent_per_sf, 0);
  const inPlaceGPR = mode === "student_housing"
    ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.beds_per_unit * g.current_rent_per_bed * 12, 0)
    : mode === "multifamily"
    ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.current_rent_per_unit * 12, 0)
    : d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit * g.current_rent_per_sf, 0);

  // ── Proforma GPR — blended rent reflecting renovation count ─────────────────
  // Ground-up: proforma = market (all units at market rent, no in-place)
  // Value-add: renovation_count units at market rent, remaining at in-place
  const proformaGPR = d.development_mode ? gpr : d.unit_groups.reduce((s, g) => {
    const eu = effectiveUnits(g);
    const renoUnits = Math.min(g.renovation_count || 0, eu);
    const unrenoUnits = eu - renoUnits;
    if (mode === "student_housing") {
      return s + (renoUnits * g.beds_per_unit * g.market_rent_per_bed + unrenoUnits * g.beds_per_unit * g.current_rent_per_bed) * 12;
    } else if (mode === "multifamily") {
      return s + (renoUnits * g.market_rent_per_unit + unrenoUnits * g.current_rent_per_unit) * 12;
    } else {
      return s + (renoUnits * g.sf_per_unit * g.market_rent_per_sf + unrenoUnits * g.sf_per_unit * g.current_rent_per_sf);
    }
  }, 0);

  // ── Other Income (RUBS, Parking, Laundry) ──────────────────────────────────
  const otherIncomeRUBS = (d.rubs_per_unit_monthly || 0) * totalUnits * 12;
  // Parking revenue: per-space pricing → parking config entries → legacy flat monthly
  const parkingEntries = d.parking?.entries || [];
  const perSpaceParkingMonthly = (d.parking_reserved_spaces || 0) * (d.parking_reserved_rate || 0)
    + (d.parking_unreserved_spaces || 0) * (d.parking_unreserved_rate || 0);
  const otherIncomeParking = perSpaceParkingMonthly > 0
    ? perSpaceParkingMonthly * 12
    : parkingEntries.length > 0
      ? parkingEntries.reduce((s, e) => s
          + (e.reserved_residential_spaces * e.reserved_monthly_rate)
          + (e.unreserved_spaces * e.unreserved_monthly_rate)
          + (e.retail_shared_spaces * e.retail_shared_monthly_rate), 0) * 12
      : (d.parking_monthly || 0) * 12;
  const otherIncomeLaundry = (d.laundry_monthly || 0) * 12;
  const totalOtherIncome = otherIncomeRUBS + otherIncomeParking + otherIncomeLaundry;

  const ipVacRate = d.in_place_vacancy_rate ?? d.vacancy_rate;
  const vacancyLoss = gpr * (d.vacancy_rate / 100);
  const inPlaceVacancyLoss = inPlaceGPR * (ipVacRate / 100);
  const proformaVacancyLoss = proformaGPR * (d.vacancy_rate / 100);
  const egi = gpr - vacancyLoss;
  const inPlaceEGI = inPlaceGPR - inPlaceVacancyLoss;
  const proformaEGI = proformaGPR - proformaVacancyLoss;

  // ── Operating Expenses ──────────────────────────────────────────────────────
  // Management fee applies to all collected revenue including other income (RUBS, parking, laundry)
  const mgmtFee = (egi + totalOtherIncome) * (d.management_fee_pct / 100);
  const proformaMgmtFee = (proformaEGI + totalOtherIncome) * (d.management_fee_pct / 100);
  const inPlaceMgmtFee = d.ip_mgmt_annual; // Hard-coded dollar amount, not derived from %
  const customOpex = d.custom_opex || [];
  const customPfTotal = customOpex.reduce((s, r) => s + (r.pf_annual || 0), 0);
  const customIpTotal = customOpex.reduce((s, r) => s + ipOr(r.ip_annual || 0, r.pf_annual || 0), 0);
  const fixedOpEx = d.taxes_annual + d.insurance_annual + d.repairs_annual + d.utilities_annual + d.other_expenses_annual + (d.ga_annual || 0) + (d.marketing_annual || 0) + (d.reserves_annual || 0) + customPfTotal;
  const totalOpEx = mgmtFee + fixedOpEx;
  const proformaTotalOpEx = proformaMgmtFee + fixedOpEx;
  const ipFixedOpEx = ipOr(d.ip_taxes_annual, d.taxes_annual) + ipOr(d.ip_insurance_annual, d.insurance_annual) + ipOr(d.ip_repairs_annual, d.repairs_annual) + ipOr(d.ip_utilities_annual, d.utilities_annual) + ipOr(d.ip_other_annual, d.other_expenses_annual) + ipOr(d.ip_ga_annual, d.ga_annual || 0) + ipOr(d.ip_marketing_annual, d.marketing_annual || 0) + ipOr(d.ip_reserves_annual, d.reserves_annual || 0) + customIpTotal;
  const inPlaceTotalOpEx = inPlaceMgmtFee + ipFixedOpEx;

  // ── CAM Reimbursements (commercial only) ────────────────────────────────────
  // Sum all OpEx categories flagged as CAM → this is the reimbursable pool
  const camPool = (d.cam_taxes ? d.taxes_annual : 0) + (d.cam_insurance ? d.insurance_annual : 0)
    + (d.cam_repairs ? d.repairs_annual : 0) + (d.cam_utilities ? d.utilities_annual : 0)
    + (d.cam_ga ? (d.ga_annual || 0) : 0) + (d.cam_marketing ? (d.marketing_annual || 0) : 0)
    + (d.cam_reserves ? (d.reserves_annual || 0) : 0) + (d.cam_other ? (d.other_expenses_annual || 0) : 0)
    + (d.cam_management ? proformaMgmtFee : 0)
    + customOpex.reduce((s, r) => s + (r.cam ? (r.pf_annual || 0) : 0), 0);
  const ipCamPool = (d.cam_taxes ? ipOr(d.ip_taxes_annual, d.taxes_annual) : 0)
    + (d.cam_insurance ? ipOr(d.ip_insurance_annual, d.insurance_annual) : 0)
    + (d.cam_repairs ? ipOr(d.ip_repairs_annual, d.repairs_annual) : 0)
    + (d.cam_utilities ? ipOr(d.ip_utilities_annual, d.utilities_annual) : 0)
    + (d.cam_ga ? ipOr(d.ip_ga_annual, d.ga_annual || 0) : 0) + (d.cam_marketing ? ipOr(d.ip_marketing_annual, d.marketing_annual || 0) : 0)
    + (d.cam_reserves ? ipOr(d.ip_reserves_annual, d.reserves_annual || 0) : 0)
    + (d.cam_other ? ipOr(d.ip_other_annual, d.other_expenses_annual || 0) : 0)
    + (d.cam_management ? inPlaceMgmtFee : 0)
    + customOpex.reduce((s, r) => s + (r.cam ? ipOr(r.ip_annual || 0, r.pf_annual || 0) : 0), 0);
  // Each unit group reimburses its pro-rata share based on lease type
  // NNN → 100% of CAM pool pro-rata; MG → 100% pro-rata; Gross → 0%
  let reimbursements = 0;
  let ipReimbursements = 0;
  if (mode === "commercial" && totalSF > 0) {
    // Only occupied SF pays CAM — apply occupancy factor to each group's share
    const occupancyFactor = 1 - (d.vacancy_rate / 100);
    const ipOccFactor = 1 - (ipVacRate / 100);
    for (const g of d.unit_groups) {
      const occupiedSF = effectiveUnits(g) * g.sf_per_unit * occupancyFactor;
      const share = occupiedSF / totalSF;
      const ipOccupiedSF = g.unit_count * g.sf_per_unit * ipOccFactor;
      const ipShare = ipTotalSF > 0 ? ipOccupiedSF / ipTotalSF : 0;
      if (g.lease_type === "NNN" || g.lease_type === "MG" || g.lease_type === "Modified Gross") {
        reimbursements += camPool * share;
        ipReimbursements += ipCamPool * ipShare;
      }
      // Gross leases: no reimbursement
    }
  }
  const effectiveRevenue = egi + reimbursements;
  const inPlaceEffectiveRevenue = inPlaceEGI + ipReimbursements;
  const proformaEffectiveRevenue = proformaEGI + reimbursements + totalOtherIncome;

  // ── Leasing Commissions (annualized) ─────────────────────────────────────────
  // Blended LC rate: renewal_prob * renewal_pct + (1 - renewal_prob) * new_pct
  const lcBlendedPct = mode === "commercial"
    ? ((d.lc_renewal_prob / 100) * (d.lc_renewal_pct / 100) + (1 - d.lc_renewal_prob / 100) * (d.lc_new_pct / 100))
    : 0;
  const leasingCommissions = proformaEGI * lcBlendedPct;
  const ipLeasingCommissions = inPlaceEGI * lcBlendedPct;

  // ── NOI ─────────────────────────────────────────────────────────────────────
  const noi = effectiveRevenue - totalOpEx - leasingCommissions;
  const inPlaceNOI = inPlaceEffectiveRevenue - inPlaceTotalOpEx - ipLeasingCommissions;
  const proformaNOI = proformaEffectiveRevenue - proformaTotalOpEx - leasingCommissions;

  // ── Cost Basis ──────────────────────────────────────────────────────────────
  const capexTotal = d.capex_items.reduce((s, c) => s + c.quantity * c.cost_per_unit, 0);

  // Development budget: use itemized line items if populated, else fall back to legacy
  const devBudgetItems = d.dev_budget_items || [];
  const hasItemizedBudget = d.development_mode && devBudgetItems.length > 0 && devBudgetItems.some(i => i.amount > 0);

  // Compute itemized hard/soft costs with % items resolving against non-% hard total
  let itemizedHardBase = 0, itemizedSoftBase = 0;
  if (hasItemizedBudget) {
    // First pass: sum non-percentage items
    for (const item of devBudgetItems) {
      if (!item.is_pct && item.category === "hard") itemizedHardBase += item.amount;
      if (!item.is_pct && item.category === "soft") itemizedSoftBase += item.amount;
    }
    // Second pass: resolve percentage items against the base
    for (const item of devBudgetItems) {
      if (item.is_pct && item.pct_basis === "hard_costs") {
        const resolved = itemizedHardBase * (item.pct_value / 100);
        if (item.category === "hard") itemizedHardBase += resolved;
        else itemizedSoftBase += resolved;
      }
    }
  }

  // Parking total cost from parking config
  const totalParkingCost = parkingEntries.reduce((s, e) => s + e.spaces * e.cost_per_space, 0);

  const totalHardCosts = d.development_mode
    ? (hasItemizedBudget ? itemizedHardBase : d.hard_cost_per_sf * (d.max_gsf || 0))
    : 0;
  const softCostsTotal = d.development_mode
    ? (hasItemizedBudget ? itemizedSoftBase : totalHardCosts * (d.soft_cost_pct / 100))
    : 0;

  // Construction interest carry
  let capitalizedInterest = 0;
  const cl = d.construction_loan;
  if (d.development_mode && cl && cl.rate > 0 && cl.term_months > 0) {
    const totalBudget = totalHardCosts + softCostsTotal + (d.development_mode ? totalParkingCost : 0);
    const loanAmount = totalBudget * (cl.ltc_pct / 100);
    const monthlyRate = cl.rate / 100 / 12;
    if (cl.draw_schedule.length > 0) {
      // Use explicit draw schedule
      for (let m = 1; m <= cl.term_months; m++) {
        const draw = cl.draw_schedule.find(dp => dp.month === m);
        const cumPct = draw ? draw.cumulative_pct / 100 : (cl.draw_schedule.filter(dp => dp.month <= m).pop()?.cumulative_pct || 0) / 100;
        capitalizedInterest += loanAmount * cumPct * monthlyRate;
      }
    } else {
      // Linear draw: average 50% outstanding
      capitalizedInterest = loanAmount * 0.5 * monthlyRate * cl.term_months;
    }
  }

  // Redevelopment costs
  const redev = d.redevelopment;
  const demolitionCosts = redev?.enabled ? (redev.demolition_items || []).reduce((s, i) => s + i.amount, 0) : 0;
  const lostIncome = redev?.enabled ? redev.existing_noi * (redev.vacancy_period_months + redev.demolition_period_months) / 12 : 0;

  let closingCosts: number, totalCost: number;
  if (d.development_mode) {
    closingCosts = d.land_cost * (d.closing_costs_pct / 100);
    totalCost = d.land_cost + totalHardCosts + softCostsTotal + totalParkingCost + capitalizedInterest + closingCosts + demolitionCosts;
  } else {
    closingCosts = d.purchase_price * (d.closing_costs_pct / 100);
    totalCost = d.purchase_price + closingCosts + capexTotal;
  }

  // ── Cap Rates ───────────────────────────────────────────────────────────────
  const costBasis = d.development_mode ? totalCost : d.purchase_price;
  const inPlaceCapRate = costBasis > 0 ? (inPlaceNOI / costBasis) * 100 : 0;
  const marketCapRate = costBasis > 0 ? (noi / costBasis) * 100 : 0;
  const proformaCapRate = costBasis > 0 ? (proformaNOI / costBasis) * 100 : 0;
  const yoc = totalCost > 0 ? ((d.development_mode ? noi : proformaNOI) / totalCost) * 100 : 0;

  // ── Per-Unit Metrics ────────────────────────────────────────────────────────
  const basisForPerUnit = d.development_mode ? totalCost : d.purchase_price;
  const pricePerSF = mode === "commercial" && totalSF > 0 ? basisForPerUnit / totalSF : 0;
  const pricePerBed = mode === "student_housing" && totalBeds > 0 ? basisForPerUnit / totalBeds : 0;
  const pricePerUnit = totalUnits > 0 ? basisForPerUnit / totalUnits : 0;

  // ── Acquisition Financing ───────────────────────────────────────────────────
  let acqLoan = 0, acqDebt = 0, acqDebtIO = 0, blendedLtc = 0;
  if (d.has_financing && totalCost > 0) {
    if (d.development_mode) {
      // Ground-up: construction loan as % of total development cost (LTC)
      const ltc = d.acq_ltc ?? d.acq_pp_ltv ?? 0;
      acqLoan = totalCost * (ltc / 100);
    } else {
      // Split leverage: separate % for purchase price and capex
      const ppLtv = d.acq_pp_ltv ?? d.acq_ltc ?? 0;
      const capexLtv = d.acq_capex_ltv ?? d.acq_ltc ?? 0;
      const purchasePlusCosing = d.purchase_price + closingCosts;
      const ppLoan = purchasePlusCosing * (ppLtv / 100);
      const capexLoan = capexTotal * (capexLtv / 100);
      acqLoan = ppLoan + capexLoan;
    }
    blendedLtc = totalCost > 0 ? (acqLoan / totalCost) * 100 : 0;
    const isIOOnly = d.acq_amort_years <= 0;
    if (isIOOnly) {
      // Pure interest-only / bullet loan — no amortization at all
      acqDebt = acqLoan * (d.acq_interest_rate / 100);
    } else {
      // Amortizing loan (may have an IO period, but DSCR should reflect the amortizing payment)
      acqDebt = annualPayment(acqLoan, d.acq_interest_rate, d.acq_amort_years);
    }
    // IO payment used for cash flow during IO years
    acqDebtIO = d.acq_io_years > 0 ? acqLoan * (d.acq_interest_rate / 100) : acqDebt;
  }
  const equity = totalCost - acqLoan;
  // Cash flow uses IO payment during IO period for Year 1 snapshot
  const yr1Debt = d.acq_io_years > 0 ? acqDebtIO : acqDebt;
  const cashFlow = proformaNOI - yr1Debt;
  const coc = equity > 0 ? (cashFlow / equity) * 100 : 0;
  // DSCR always uses amortizing debt service (worst-case obligation)
  const dscr = acqDebt > 0 ? proformaNOI / acqDebt : 0;

  // ── Year-by-Year DCF growth rates ────────────────────────────────────────────
  const rg = (d.rent_growth_pct || 0) / 100;
  const eg = (d.expense_growth_pct || 0) / 100;

  // ── Refinance ───────────────────────────────────────────────────────────────
  let refiProceeds = 0, refiDebt = 0, refiLoan = 0;
  if (d.has_refi && d.has_financing && d.exit_cap_rate > 0) {
    // Size refi against NOI projected to the refi year (not year-0 stabilized NOI)
    const noiAtRefi = proformaNOI * Math.pow(1 + rg, d.refi_year || 3);
    refiLoan = (noiAtRefi / (d.exit_cap_rate / 100)) * (d.refi_ltv / 100);
    refiProceeds = refiLoan - acqLoan;
    refiDebt = annualPayment(refiLoan, d.refi_rate, d.refi_amort_years);
  }

  // ── Stabilized Returns (post-refi if refinance is modeled) ──────────────────
  // "Stabilized" returns reflect the deal once it's reached its proforma state.
  // When a refinance is planned, the truly stabilized state is post-refi, so
  // debt service reflects refinance terms rather than acquisition debt.
  const stabilizedDebtCF = d.has_refi && d.has_financing ? refiDebt : yr1Debt;
  const stabilizedDebtAmort = d.has_refi && d.has_financing ? refiDebt : acqDebt;
  const stabilizedCashFlow = proformaNOI - stabilizedDebtCF;
  const stabilizedCoC = equity > 0 ? (stabilizedCashFlow / equity) * 100 : 0;
  const stabilizedDSCR = stabilizedDebtAmort > 0 ? proformaNOI / stabilizedDebtAmort : 0;

  // ── Year-by-Year DCF ─────────────────────────────────────────────────────────
  const yearlyDCF: DCFYear[] = [];

  // Lease-up ramp for ground-up: Year 1 gets partial income
  const lu = d.lease_up;
  const constructionMonths = lu?.construction_months || 0;
  const absUnitsPerMo = lu?.absorption_units_per_month || 0;
  const stabOccPct = lu?.stabilization_occupancy_pct || 93;
  const monthsToStab = absUnitsPerMo > 0 ? Math.ceil((totalUnits * stabOccPct / 100) / absUnitsPerMo) : 0;
  // Lease-up occupancy factor for Year 1: average occupancy during first 12 months post-construction
  let yr1LeaseUpFactor = 1; // default: fully stabilized
  if (d.development_mode && lu && absUnitsPerMo > 0 && totalUnits > 0) {
    // Months of lease-up in Year 1 (construction may eat into Year 1)
    const leaseUpStartMonth = Math.max(0, 12 - constructionMonths); // months of Year 1 with income
    if (leaseUpStartMonth < 12) {
      let totalOccupancyMonths = 0;
      for (let m = 1; m <= 12; m++) {
        if (m <= (12 - leaseUpStartMonth)) { totalOccupancyMonths += 0; continue; } // still in construction
        const leaseUpMonth = m - (12 - leaseUpStartMonth);
        const occupied = Math.min(leaseUpMonth * absUnitsPerMo, totalUnits);
        totalOccupancyMonths += occupied / totalUnits;
      }
      yr1LeaseUpFactor = totalOccupancyMonths / 12;
    }
  }

  for (let yr = 1; yr <= 5; yr++) {
    const rentMult = Math.pow(1 + rg, yr);
    const expMult = Math.pow(1 + eg, yr);
    const leaseUpFactor = yr === 1 ? yr1LeaseUpFactor : (yr === 2 && yr1LeaseUpFactor < 0.8) ? Math.min(1, yr1LeaseUpFactor + 0.5) : 1;
    const yrGPR = proformaGPR * rentMult * leaseUpFactor;
    const yrVacLoss = yrGPR * (d.vacancy_rate / 100);
    const yrEGI = yrGPR - yrVacLoss;
    const yrOtherIncome = totalOtherIncome * rentMult;
    const yrReimb = reimbursements * rentMult;
    const yrMgmt = yrEGI * (d.management_fee_pct / 100);
    const yrFixedOpEx = (fixedOpEx) * expMult;
    const yrTotalOpEx = yrMgmt + yrFixedOpEx;
    const yrLC = leasingCommissions * rentMult;
    const yrEffRev = yrEGI + yrReimb + yrOtherIncome;
    const yrNOI = yrEffRev - yrTotalOpEx - yrLC;

    let ds = 0;
    let label = "—";
    if (d.has_financing) {
      if (d.has_refi && yr > d.refi_year) {
        ds = refiDebt;
        label = "Refi";
      } else if (yr <= (d.acq_io_years || 0)) {
        ds = acqDebtIO;
        label = "IO";
      } else {
        ds = acqDebt;
        label = "Amort";
      }
    }
    const yrRefiProceeds = (d.has_refi && d.has_financing && yr === d.refi_year) ? refiProceeds : 0;
    const cf = yrNOI - ds + yrRefiProceeds;
    yearlyDCF.push({
      year: yr,
      gpr: yrGPR,
      vacancyLoss: yrVacLoss,
      egi: yrEGI,
      otherIncome: yrOtherIncome,
      reimbursements: yrReimb,
      totalOpEx: yrTotalOpEx,
      leasingCommissions: yrLC,
      noi: yrNOI,
      debtService: ds,
      debtLabel: label,
      cashFlow: cf,
      coc: equity > 0 ? (cf / equity) * 100 : 0,
      refiProceeds: yrRefiProceeds,
    });
  }
  const inPlaceDCF = {
    debtService: yr1Debt,
    debtLabel: d.has_financing ? (d.acq_io_years > 0 ? "IO" : "Amort") : "—",
  };

  // ── Exit & Returns (uses terminal-year NOI with growth) ──────────────────────
  const holdYrs = d.hold_period_years || 5;
  // Terminal NOI: grow revenue and expenses separately at their respective rates
  const terminalRevenue = proformaEffectiveRevenue * Math.pow(1 + rg, holdYrs);
  const terminalMgmt    = (proformaEGI + totalOtherIncome) * Math.pow(1 + rg, holdYrs) * (d.management_fee_pct / 100);
  const terminalFixed   = fixedOpEx * Math.pow(1 + eg, holdYrs);
  const terminalLC      = leasingCommissions * Math.pow(1 + rg, holdYrs);
  const terminalNOI     = terminalRevenue - terminalMgmt - terminalFixed - terminalLC;
  const exitValue = d.exit_cap_rate > 0 ? terminalNOI / (d.exit_cap_rate / 100) : 0;
  // Exit loan balance = remaining principal of the loan in force at exit (not a fresh refi)
  const exitLoanBalance = d.has_refi && d.has_financing
    ? remainingBalance(refiLoan, d.refi_rate, d.refi_amort_years, holdYrs - (d.refi_year || 3))
    : d.has_financing
    ? remainingBalance(acqLoan, d.acq_interest_rate, d.acq_amort_years, holdYrs)
    : 0;
  const exitEquity = exitValue - exitLoanBalance;

  // Equity multiple: sum actual per-year cash flows from DCF (handles IO, amort, refi, and growth)
  let totalCashFlows = 0;
  // Use yearlyDCF for years within the 5-year window, extrapolate beyond if hold > 5
  for (let yr = 1; yr <= holdYrs; yr++) {
    if (yr <= 5) {
      totalCashFlows += yearlyDCF[yr - 1].cashFlow;
    } else {
      // Extrapolate beyond year 5: grow revenue and expenses separately from their year-0 bases
      const yrGPR    = proformaGPR * Math.pow(1 + rg, yr);
      const yrEGI    = yrGPR * (1 - d.vacancy_rate / 100);
      const yrOther  = totalOtherIncome * Math.pow(1 + rg, yr);
      const yrReimb  = reimbursements * Math.pow(1 + rg, yr);
      const yrMgmt   = (yrEGI + yrOther) * (d.management_fee_pct / 100);
      const yrFixed  = fixedOpEx * Math.pow(1 + eg, yr);
      const yrLC     = leasingCommissions * Math.pow(1 + rg, yr);
      const yrNOI    = (yrEGI + yrOther + yrReimb) - yrMgmt - yrFixed - yrLC;
      let ds = 0;
      if (d.has_financing) {
        if (d.has_refi && yr > d.refi_year) ds = refiDebt;
        else if (yr <= (d.acq_io_years || 0)) ds = acqDebtIO;
        else ds = acqDebt;
      }
      totalCashFlows += yrNOI - ds;
    }
  }
  const em = equity > 0 ? (exitEquity + totalCashFlows) / equity : 0;

  // ── GRM + In-Place metrics ────────────────────────────────────────────────
  // Use totalCost (purchase price + closing costs + capex) for all-in GRM
  const grm = totalCost > 0 && gpr > 0 ? totalCost / gpr : 0;
  const proformaGRM = totalCost > 0 && proformaGPR > 0 ? totalCost / proformaGPR : 0;
  const inPlaceGRM = totalCost > 0 && inPlaceGPR > 0 ? totalCost / inPlaceGPR : 0;
  const inPlaceCashFlow = inPlaceNOI - yr1Debt;
  const inPlaceCoC = equity > 0 ? (inPlaceCashFlow / equity) * 100 : 0;
  const inPlaceDSCR = acqDebt > 0 ? inPlaceNOI / acqDebt : 0;

  // ── Exit Per-Unit ─────────────────────────────────────────────────────────
  const exitPricePerUnit = totalUnits > 0 && exitValue > 0 ? exitValue / totalUnits : 0;
  const exitPricePerBed = mode === "student_housing" && totalBeds > 0 && exitValue > 0 ? exitValue / totalBeds : 0;
  const exitPricePerSF = mode === "commercial" && totalSF > 0 && exitValue > 0 ? exitValue / totalSF : 0;

  // ── CapEx per-unit metrics ──────────────────────────────────────────────────
  const capexPerSF = mode === "commercial" && totalSF > 0 ? capexTotal / totalSF : 0;
  const capexPerUnit = totalUnits > 0 ? capexTotal / totalUnits : 0;
  const capexPerBed = mode === "student_housing" && totalBeds > 0 ? capexTotal / totalBeds : 0;

  return {
    totalSF, totalBeds, totalUnits, ipTotalUnits, ipTotalSF, ipTotalBeds,
    gpr, inPlaceGPR, proformaGPR, vacancyLoss, inPlaceVacancyLoss, proformaVacancyLoss, egi, inPlaceEGI, proformaEGI,
    reimbursements, ipReimbursements, camPool, ipCamPool, effectiveRevenue, inPlaceEffectiveRevenue, proformaEffectiveRevenue,
    leasingCommissions, ipLeasingCommissions,
    totalOtherIncome, otherIncomeRUBS, otherIncomeParking, otherIncomeLaundry,
    mgmtFee, proformaMgmtFee, inPlaceMgmtFee, totalOpEx, proformaTotalOpEx, inPlaceTotalOpEx,
    noi, inPlaceNOI, proformaNOI,
    grm, proformaGRM, inPlaceGRM, inPlaceCashFlow, inPlaceCoC, inPlaceDSCR,
    proformaCapRate,
    exitPricePerUnit, exitPricePerBed, exitPricePerSF,
    capexTotal, capexPerSF, capexPerUnit, capexPerBed, closingCosts, totalCost, totalHardCosts, softCostsTotal, totalParkingCost, capitalizedInterest, demolitionCosts, lostIncome,
    inPlaceCapRate, marketCapRate, yoc,
    pricePerSF, pricePerBed, pricePerUnit,
    acqLoan, acqDebt, acqDebtIO, yr1Debt, equity, cashFlow, coc, dscr, blendedLtc,
    stabilizedCashFlow, stabilizedCoC, stabilizedDSCR,
    refiProceeds, refiDebt, exitValue, exitEquity, totalCashFlows, em,
    yearlyDCF, inPlaceDCF,
  };
}

const fc = (n: number) => n || n === 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";
const fn = (n: number) => n || n === 0 ? Math.round(n).toLocaleString("en-US") : "—";

function NumInput({ label, value, onChange, prefix, suffix, decimals = 0, className = "" }: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; decimals?: number; className?: string;
}) {
  const fmt = (v: number) => v === 0 ? "" : v.toLocaleString("en-US", { maximumFractionDigits: decimals });
  const [raw, setRaw] = useState(fmt(value));
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Only sync from parent when the input is not focused (don't clobber in-progress edits)
    if (document.activeElement !== inputRef.current) {
      setRaw(fmt(value));
    }
  }, [value]);
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center border rounded-md bg-background overflow-hidden">
        {prefix && <span className="px-2 text-sm text-muted-foreground bg-muted border-r">{prefix}</span>}
        <input ref={inputRef} type="text" inputMode="decimal" value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => { const v = parseFloat(raw.replace(/,/g, "")) || 0; onChange(v); setRaw(fmt(v)); }}
          className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent text-blue-300" placeholder="0" />
        {suffix && <span className="px-2 text-sm text-muted-foreground bg-muted border-l">{suffix}</span>}
      </div>
    </div>
  );
}

function CellInput({ value, onChange, decimals = 0, prefix, suffix, align = "right", placeholder = "0", className = "" }: {
  value: number; onChange: (v: number) => void; decimals?: number; prefix?: string; suffix?: string; align?: "left" | "right"; placeholder?: string; className?: string;
}) {
  const v0 = value ?? 0;
  const fmt = (v: number) => !v ? "" : v.toLocaleString("en-US", { maximumFractionDigits: decimals });
  const [raw, setRaw] = useState(fmt(v0));
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Only sync from parent when the input is not focused (don't clobber in-progress edits)
    if (document.activeElement !== inputRef.current) {
      setRaw(fmt(v0));
    }
  }, [v0]);
  return (
    <div className={`flex items-center ${className}`}>
      {prefix && <span className="text-xs text-muted-foreground mr-0.5 shrink-0">{prefix}</span>}
      <input ref={inputRef} type="text" inputMode="decimal" value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => { const v = parseFloat(raw.replace(/,/g, "")) || 0; onChange(v); setRaw(fmt(v)); }}
        className={`w-full bg-transparent text-sm outline-none tabular-nums text-blue-300 ${align === "right" ? "text-right" : "text-left"}`}
        placeholder={placeholder} />
      {suffix && <span className="text-xs text-muted-foreground ml-0.5 shrink-0">{suffix}</span>}
    </div>
  );
}

function CellText({ value, onChange, placeholder = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-transparent text-sm outline-none text-blue-300" placeholder={placeholder} />
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="border-b hover:bg-muted/20 group"
    >
      <td className="px-1 py-1.5 w-[28px]">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </td>
      {children}
    </tr>
  );
}

function MBox({ label, value, sub, hi, warn }: { label: string; value: string; sub?: string; hi?: boolean; warn?: boolean; }) {
  return (
    <div className={`p-4 rounded-xl border ${hi ? "border-primary/50 bg-primary/5" : warn ? "border-yellow-400/50 bg-yellow-50/50" : "bg-card"}`}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold ${hi ? "text-primary" : warn ? "text-yellow-400" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Section({ title, icon, children, open: defaultOpen = true }: { title: string; icon: React.ReactNode; children: React.ReactNode; open?: boolean; }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <button className="w-full flex items-center justify-between p-4 hover:bg-accent/30 transition-colors" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2 font-semibold text-sm">{icon}{title}</div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="p-4 pt-0 border-t">{children}</div>}
    </div>
  );
}

function ISRow({ label, ip, pf, proforma, muted, bold, hi, hideIp }: { label: string; ip: number; pf: number; proforma?: number; muted?: boolean; bold?: boolean; hi?: boolean; hideIp?: boolean; }) {
  const fmtVal = (v: number) => { const neg = v < 0; return neg ? `(${fc(Math.abs(v))})` : fc(Math.abs(v)); };
  return (
    <tr className={`${bold ? "font-semibold" : ""} ${hi ? "bg-primary/5" : "hover:bg-muted/20"}`}>
      <td className={`px-4 py-1.5 ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{label}</td>
      {!hideIp && <td className={`px-4 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{fmtVal(ip)}</td>}
      <td className={`px-4 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{proforma !== undefined ? fmtVal(proforma) : fmtVal(pf)}</td>
      {!hideIp && <td className={`px-4 py-1.5 text-right tabular-nums text-muted-foreground/50`}>{fmtVal(pf)}</td>}
    </tr>
  );
}

function DCFRow({ label, yr0, yr1to5, muted, bold, hi, isPct }: {
  label: string; yr0: number; yr1to5: number[];
  muted?: boolean; bold?: boolean; hi?: boolean; isPct?: boolean;
}) {
  const fmt = (v: number) => {
    if (isPct) return v !== 0 ? `${v.toFixed(2)}%` : "—";
    const neg = v < 0;
    return neg ? `(${fc(Math.abs(v))})` : fc(Math.abs(v));
  };
  return (
    <tr className={`${bold ? "font-semibold" : ""} ${hi ? "bg-primary/5" : "hover:bg-muted/20"}`}>
      <td className={`px-4 py-1.5 ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{label}</td>
      <td className={`px-4 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{fmt(yr0)}</td>
      {yr1to5.map((v, i) => (
        <td key={i} className={`px-4 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{fmt(v)}</td>
      ))}
    </tr>
  );
}

export default function UnderwritingPage({ params }: { params: { id: string } }) {
  const [viewMode, setViewMode] = useViewMode();
  const isBasic = viewMode === "basic";
  const [data, setData] = useState<UWData>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [capexEstimating, setCapexEstimating] = useState(false);
  // Site-plan building labels keyed by id. Populated from
  // underwriting.data.site_plan on mount so the unit-groups table can
  // insert per-building header rows when unit_groups carry a
  // site_plan_building_id tag (set by Programming's pushToUW). Empty
  // map (no site plan / all untagged) = flat table like before.
  const [sitePlanBuildingLabels, setSitePlanBuildingLabels] = useState<Record<string, string>>({});
  // Map from site_plan scenario id → { name, is_base_case, buildingIds }
  const [sitePlanScenarioMeta, setSitePlanScenarioMeta] = useState<Record<string, { name: string; is_base_case?: boolean; buildingIds: string[] }>>({});
  // Saved Underwriting Scenarios — named snapshots the analyst took via
  // "Save as UW Scenario" from the Site Plan section. We keep this as
  // its own state (rather than inside `data`) so it's cheap to
  // manipulate independently of the main underwriting form.
  const [uwScenarios, setUwScenarios] = useState<UWScenarioType[]>([]);
  const [capexPreview, setCapexPreview] = useState<Array<{ label: string; quantity: number; unit: string; cost_per_unit: number; basis: string; selected: boolean }> | null>(null);
  const [opexEstimating, setOpexEstimating] = useState(false);
  const [rentEstimating, setRentEstimating] = useState(false);
  const [loanSizing, setLoanSizing] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [docs, setDocs] = useState<Array<{ id: string; original_name: string; mime_type?: string }>>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [docViewerOpen, setDocViewerOpen] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [deal, setDeal] = useState<{ name: string; property_type?: string; business_plan_id?: string; investment_strategy?: string } | null>(null);
  const [businessPlan, setBusinessPlan] = useState<{ target_irr_min?: number; target_irr_max?: number; target_equity_multiple_min?: number; target_equity_multiple_max?: number; hold_period_min?: number; hold_period_max?: number } | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null); // null = baseline
  const [activeMassingScenarioId, setActiveMassingScenarioId] = useState<string | null>(null); // site_plan_scenario_id — which massing to view
  const [activeMassingBuildingId, setActiveMassingBuildingId] = useState<string | null>(null); // building within that massing
  const [showScenarioWizard, setShowScenarioWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardType, setWizardType] = useState<ScenarioType>("custom");
  const [wizardMetric, setWizardMetric] = useState<WizardMetric>("em");
  const [wizardTarget, setWizardTarget] = useState<number>(0);
  const [wizardResult, setWizardResult] = useState<{ value: number; label: string; scenarioOverrides: Partial<UWData> } | null>(null);
  const [wizardSolving, setWizardSolving] = useState(false);
  const [renamingScenarioId, setRenamingScenarioId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareSelection, setCompareSelection] = useState<Set<string>>(new Set());
  const [dealScores, setDealScores] = useState<{ om_score: number | null; om_reasoning: string | null; uw_score: number | null; uw_score_reasoning: string | null }>({ om_score: null, om_reasoning: null, uw_score: null, uw_score_reasoning: null });
  const [scoringUW, setScoringUW] = useState(false);
  // Rent comps editing UI lives on the Comps page now — see
  // src/app/deals/[id]/comps/page.tsx. The underlying data still lives in
  // this blob (rent_comps / rent_comp_unit_types / selected_comp_ids) so the
  // investment-package generator keeps reading it.
  const isSH = deal?.property_type === "student_housing";
  const isMixedUseWithRes = deal?.property_type === "mixed_use" && (data.mixed_use?.components || []).some(c => c.component_type === "residential");
  // Detect residential development on a land deal by checking if the massing
  // scenario has residential use or if existing unit_groups are bed/rent-per-unit shaped.
  const detectionScenario = (data.building_program?.scenarios || []).find((s: { id: string }) => s.id === data.building_program?.active_scenario_id);
  const massingHasResidential = detectionScenario?.floors?.some((f: { use_type: string }) => f.use_type === "residential");
  const unitGroupsLookResidential = (data.unit_groups || []).some((g: { market_rent_per_unit?: number; current_rent_per_unit?: number; beds_per_unit?: number }) =>
    (g.market_rent_per_unit ?? 0) > 0 || (g.current_rent_per_unit ?? 0) > 0 || (g.beds_per_unit ?? 0) > 0
  );
  const isLandDevResidential = (deal?.property_type === "land" || deal?.property_type === "other") &&
    (data.development_mode || deal?.investment_strategy === "ground_up") &&
    (massingHasResidential || unitGroupsLookResidential);
  const isMF = deal?.property_type === "multifamily" || deal?.property_type === "sfr" || isSH || isMixedUseWithRes || isLandDevResidential;
  const calcMode = isSH ? "student_housing" as const : isMF ? "multifamily" as const : "commercial" as const;
  const isGroundUp = deal?.investment_strategy === "ground_up";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleReorderUnits = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setData(prev => {
        const oldIdx = prev.unit_groups.findIndex(g => g.id === active.id);
        const newIdx = prev.unit_groups.findIndex(g => g.id === over.id);
        return { ...prev, unit_groups: arrayMove(prev.unit_groups, oldIdx, newIdx) };
      });
    }
  };
  const handleReorderCapex = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setData(prev => {
        const oldIdx = prev.capex_items.findIndex(c => c.id === active.id);
        const newIdx = prev.capex_items.findIndex(c => c.id === over.id);
        return { ...prev, capex_items: arrayMove(prev.capex_items, oldIdx, newIdx) };
      });
    }
  };
  // Renovation ↔ CapEx sync — driven by renovation_count on each unit group
  const syncLinkedCapex = (groupId: string, updates: Partial<UnitGroup>) => {
    setData(prev => {
      const updatedGroups = prev.unit_groups.map(g => g.id === groupId ? { ...g, ...updates } : g);
      const group = updatedGroups.find(g => g.id === groupId)!;
      const renoCount = group.renovation_count || 0;
      // Remove ALL existing linked capex for this group first (prevents duplicates from legacy data)
      let updatedCapex = prev.capex_items.filter(c => c.linked_unit_group_id !== groupId);
      if (renoCount > 0) {
        // Find the first old linked item to preserve its id and cost_per_unit
        const existing = prev.capex_items.find(c => c.linked_unit_group_id === groupId);
        updatedCapex.push({
          id: existing?.id || uuidv4(),
          label: `${group.label || "Unit"} Renovation`,
          quantity: renoCount,
          cost_per_unit: group.renovation_cost_per_unit || existing?.cost_per_unit || 0,
          linked_unit_group_id: groupId,
        });
      }
      return { ...prev, unit_groups: updatedGroups, capex_items: updatedCapex };
    });
  };

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
      fetch(`/api/deals/${params.id}/deal-score`).then(r => r.json()).catch(() => null),
    ]).then(async ([dr, ur, scoresJson]) => {
      setDeal(dr.data);
      if (scoresJson?.data) setDealScores(scoresJson.data);
      // Load business plan if linked
      if (dr.data?.business_plan_id) {
        try {
          const bpRes = await fetch(`/api/business-plans/${dr.data.business_plan_id}`);
          const bpJson = await bpRes.json();
          if (bpJson.data) setBusinessPlan(bpJson.data);
        } catch { /* ignore */ }
      }
      if (ur.data?.data) {
        const raw = ur.data.data;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

        // Extract site-plan building labels so the unit-groups table
        // can surface per-building header rows. Handles THREE shapes in
        // priority order:
        //   1. Current: `site_plan.scenarios[].buildings[]`
        //   2. Flat multi-building: `site_plan.buildings[]`
        //   3. Legacy single-building: `site_plan.building_points[]`
        // (Matches the migration chain in Site & Zoning's load effect.)
        const rawSp = parsed.site_plan as {
          scenarios?: Array<{ id?: string; name?: string; is_base_case?: boolean; buildings?: Array<{ id: string; label: string }> }>;
          buildings?: Array<{ id: string; label: string }>;
          building_points?: unknown;
          active_scenario_id?: string;
        } | undefined;
        const labels: Record<string, string> = {};
        const scenarioMeta: Record<string, { name: string; is_base_case?: boolean; buildingIds: string[] }> = {};
        if (rawSp?.scenarios && Array.isArray(rawSp.scenarios) && rawSp.scenarios.length > 0) {
          for (const sp of rawSp.scenarios) {
            const spId = (sp as any).id || "";
            const buildingIds: string[] = [];
            for (const b of sp.buildings || []) {
              if (b?.id && b?.label) {
                labels[b.id] = b.label;
                buildingIds.push(b.id);
              }
            }
            if (spId) {
              scenarioMeta[spId] = {
                name: (sp as any).name || (sp as any).label || `Massing ${Object.keys(scenarioMeta).length + 1}`,
                is_base_case: (sp as any).is_base_case,
                buildingIds,
              };
            }
          }
        } else if (rawSp?.buildings && Array.isArray(rawSp.buildings)) {
          for (const b of rawSp.buildings) {
            if (b?.id && b?.label) labels[b.id] = b.label;
          }
        } else if (rawSp && Array.isArray(rawSp.building_points) && rawSp.building_points.length >= 3) {
          labels["legacy"] = "Building 1";
        }
        setSitePlanBuildingLabels(labels);
        setSitePlanScenarioMeta(scenarioMeta);

        // Saved Underwriting Scenarios — named snapshots.
        if (Array.isArray(parsed.uw_scenarios)) {
          setUwScenarios(parsed.uw_scenarios as UWScenarioType[]);
        }

        // Merge defaults into each unit_group and capex_item for backward compat
        if (Array.isArray(parsed.unit_groups)) {
          parsed.unit_groups = parsed.unit_groups.map((g: Partial<UnitGroup>) => ({ ...newGroup(), ...g }));
        }
        if (Array.isArray(parsed.capex_items)) {
          parsed.capex_items = parsed.capex_items.map((c: Record<string, unknown>) => ({
            ...newCapex(),
            ...c,
            // migrate old { cost } → { quantity: 1, cost_per_unit: cost }
            quantity: c.quantity ?? 1,
            cost_per_unit: c.cost_per_unit ?? c.cost ?? 0,
          }));
        }
        const typeDefaults = getDefaultsForPropertyType(dr.data?.property_type);
        const merged = { ...typeDefaults, ...parsed };
        // Migrate legacy soft_costs (lump sum) → soft_cost_pct (% of hard costs)
        if (typeof (parsed as Record<string, unknown>).soft_costs === "number" && parsed.soft_cost_pct == null) {
          const legacySoft = (parsed as Record<string, unknown>).soft_costs as number;
          const hc = (merged.hard_cost_per_sf || 0) * (merged.max_gsf || 0);
          merged.soft_cost_pct = hc > 0 ? (legacySoft / hc) * 100 : 25;
        }
        // Auto-set development_mode for ground-up deals
        if (dr.data?.investment_strategy === "ground_up" && !parsed.development_mode) {
          merged.development_mode = true;
          // Set efficiency default by property type if not already set
          if (merged.efficiency_pct === 100 && dr.data?.property_type) {
            merged.efficiency_pct = EFFICIENCY_DEFAULTS[dr.data.property_type] ?? 100;
          }
        }
        // Auto-seed mixed_use.components from the active massing scenario's
        // nrsf_by_use when a mixed-use deal has no components yet. This is
        // what powers the per-component inputs that now live in OpEx /
        // Exit / Lease-Up sections (the unified Mixed-Use Section was
        // removed). Idempotent: only runs when components is empty, so
        // existing deals' settings are preserved.
        merged.mixed_use = seedMixedUseFromProgram(
          merged.mixed_use,
          merged.building_program,
          dr.data?.property_type
        );
        setData(merged);
      }
      else if (dr.data?.asking_price) setData(p => ({ ...p, purchase_price: dr.data.asking_price }));
      setLoading(false);
    });
  }, [params.id]);

  const set = useCallback(<K extends keyof UWData>(k: K, v: UWData[K]) => {
    if (activeScenarioId) {
      // Update the scenario's overrides
      setData(p => ({
        ...p,
        scenarios: (p.scenarios || []).map(s =>
          s.id === activeScenarioId ? { ...s, overrides: { ...s.overrides, [k]: v } } : s
        ),
      }));
    } else {
      setData(p => ({ ...p, [k]: v }));
    }
  }, [activeScenarioId]);
  const upd = (id: string, u: Partial<UnitGroup>) => {
    if (activeScenarioId) {
      setData(p => {
        const scenario = (p.scenarios || []).find(s => s.id === activeScenarioId);
        const baseGroups = scenario?.overrides.unit_groups || p.unit_groups;
        const updated = baseGroups.map(g => g.id === id ? { ...g, ...u } : g);
        return { ...p, scenarios: (p.scenarios || []).map(s => s.id === activeScenarioId ? { ...s, overrides: { ...s.overrides, unit_groups: updated } } : s) };
      });
    } else {
      setData(p => ({ ...p, unit_groups: p.unit_groups.map(g => g.id === id ? { ...g, ...u } : g) }));
    }
  };
  const del = (id: string) => setData(p => ({ ...p, unit_groups: p.unit_groups.filter(g => g.id !== id) }));
  const updC = (id: string, u: Partial<CapexItem>) => setData(p => ({ ...p, capex_items: p.capex_items.map(c => c.id === id ? { ...c, ...u } : c) }));
  const delC = (id: string) => setData(p => ({ ...p, capex_items: p.capex_items.filter(c => c.id !== id) }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/underwriting", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: params.id, data }) });
      if (res.ok) toast.success("Underwriting saved"); else toast.error("Failed to save");
    } catch { toast.error("Failed to save"); } finally { setSaving(false); }
  };

  const estimateCapex = async () => {
    setCapexEstimating(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/capex-estimate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || "Estimation failed"); return; }
      if (isGroundUp && json.hard_cost_per_sf != null) {
        // Ground-up: AI returns hard_cost_per_sf and soft_cost_pct directly
        setData(p => ({
          ...p,
          hard_cost_per_sf: json.hard_cost_per_sf,
          soft_cost_pct: json.soft_cost_pct ?? 25,
        }));
        toast.success(`Dev budget set: $${json.hard_cost_per_sf}/GSF hard costs, ${json.soft_cost_pct ?? 25}% soft costs`);
      } else {
        // Value-add: show preview modal for capex line items
        const hasLinkedRenos = data.capex_items.some(c => c.linked_unit_group_id);
        const renoKeywords = /\breno(vat|v)|unit (upgrade|improve|rehab)|interior (upgrade|improve)/i;
        const items = (json.data as Array<{ label: string; quantity: number; unit: string; cost_per_unit: number; basis: string }>)
          .map(item => ({ ...item, selected: hasLinkedRenos && renoKeywords.test(item.label) ? false : true }));
        setCapexPreview(items);
      }
    } catch { toast.error("CapEx estimation failed"); } finally { setCapexEstimating(false); }
  };

  const applyCapexEstimates = () => {
    if (!capexPreview) return;
    const selected = capexPreview.filter(i => i.selected);
    const newItems: CapexItem[] = selected.map(i => ({
      id: uuidv4(), label: i.label, quantity: i.quantity, cost_per_unit: i.cost_per_unit,
    }));
    setData(p => ({ ...p, capex_items: [...p.capex_items, ...newItems] }));
    toast.success(`${selected.length} CapEx item${selected.length !== 1 ? "s" : ""} added`);
    setCapexPreview(null);
  };

  const estimateOpex = async () => {
    setOpexEstimating(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/opex-estimate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || "OpEx estimation failed"); return; }
      const est = json.data;
      setData(p => ({
        ...p,
        vacancy_rate: est.vacancy_rate ?? p.vacancy_rate,
        management_fee_pct: est.management_fee_pct ?? p.management_fee_pct,
        taxes_annual: est.taxes_annual ?? p.taxes_annual,
        insurance_annual: est.insurance_annual ?? p.insurance_annual,
        repairs_annual: est.repairs_annual ?? p.repairs_annual,
        utilities_annual: est.utilities_annual ?? p.utilities_annual,
        ga_annual: est.ga_annual ?? p.ga_annual,
        marketing_annual: est.marketing_annual ?? p.marketing_annual,
        reserves_annual: est.reserves_annual ?? p.reserves_annual,
        other_expenses_annual: est.other_expenses_annual ?? p.other_expenses_annual,
        opex_narrative: est.basis || est.narrative || "",
      }));
      toast.success(est.basis ? `OpEx estimated — ${est.basis}` : "Operating expenses estimated");
    } catch { toast.error("OpEx estimation failed"); }
    finally { setOpexEstimating(false); }
  };

  const estimateLoan = async () => {
    setLoanSizing(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/loan-size`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || "Loan sizing failed"); return; }
      const est = json.data;
      setData(p => ({
        ...p,
        has_financing: true,
        acq_pp_ltv: est.acq_pp_ltv ?? p.acq_pp_ltv,
        acq_capex_ltv: est.acq_capex_ltv ?? p.acq_capex_ltv,
        acq_interest_rate: est.acq_interest_rate ?? p.acq_interest_rate,
        acq_amort_years: est.acq_amort_years ?? p.acq_amort_years,
        acq_io_years: est.acq_io_years ?? p.acq_io_years,
        acq_loan_narrative: est.acq_narrative ?? p.acq_loan_narrative,
        has_refi: est.has_refi ?? p.has_refi,
        refi_year: est.refi_year ?? p.refi_year,
        refi_ltv: est.refi_ltv ?? p.refi_ltv,
        refi_rate: est.refi_rate ?? p.refi_rate,
        refi_amort_years: est.refi_amort_years ?? p.refi_amort_years,
        refi_loan_narrative: est.refi_narrative ?? p.refi_loan_narrative,
        exit_cap_rate: est.exit_cap_rate ?? p.exit_cap_rate,
        hold_period_years: est.hold_period_years ?? p.hold_period_years,
      }));
      toast.success("Acquisition and refinance loans sized");
    } catch { toast.error("Loan sizing failed"); }
    finally { setLoanSizing(false); }
  };

  const loadDocs = async () => {
    try {
      const res = await fetch(`/api/deals/${params.id}/documents`);
      const json = await res.json();
      if (json.data) setDocs(json.data);
    } catch {}
  };

  const openDocPicker = async () => {
    await loadDocs();
    setSelectedDocIds([]);
    setShowDocPicker(true);
  };

  const openDocViewer = async () => {
    try {
      const res = await fetch(`/api/deals/${params.id}/documents`);
      const json = await res.json();
      if (json.data) {
        setDocs(json.data);
        if (!viewingDocId && json.data.length > 0) setViewingDocId(json.data[0].id);
      }
    } catch {}
    setDocViewerOpen(true);
  };

  const autofillWithDocs = async () => {
    setShowDocPicker(false);
    const hasGroups = data.unit_groups.length > 0;
    if (hasGroups && !confirm("Replace existing unit groups with data extracted from documents?")) return;
    setAutofilling(true);
    try {
      const body = selectedDocIds.length > 0 ? { doc_ids: selectedDocIds } : {};
      const res = await fetch(`/api/deals/${params.id}/uw-autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || "Autofill failed"); return; }
      const d = json.data;
      const sources: string[] = json.sources ?? [];
      setData(prev => ({
        ...prev,
        purchase_price: d.purchase_price ?? prev.purchase_price,
        unit_groups: Array.isArray(d.unit_groups) && d.unit_groups.length > 0
          ? d.unit_groups.map((g: Record<string, unknown>) => ({
              ...newGroup(),
              label: String(g.label ?? "Unit Group"),
              unit_count: Number(g.unit_count ?? 1),
              ...(isSH ? {
                beds_per_unit: Number(g.beds_per_unit ?? 1),
                current_rent_per_bed: Number(g.current_rent_per_bed ?? 0),
                market_rent_per_bed: Number(g.market_rent_per_bed ?? 0),
              } : isMF ? {
                current_rent_per_unit: Number(g.current_rent_per_bed ?? g.current_rent_per_unit ?? 0),
                market_rent_per_unit: Number(g.market_rent_per_bed ?? g.market_rent_per_unit ?? 0),
              } : {
                sf_per_unit: Number(g.sf_per_unit ?? 0),
                current_rent_per_sf: Number(g.current_rent_per_sf ?? 0),
                market_rent_per_sf: Number(g.market_rent_per_sf ?? 0),
                lease_type: (g.lease_type as LeaseType) ?? "NNN",
                expense_reimbursement_per_sf: Number(g.expense_reimbursement_per_sf ?? 0),
              }),
            }))
          : prev.unit_groups,
        vacancy_rate: d.vacancy_rate ?? prev.vacancy_rate,
        taxes_annual: d.taxes_annual ?? prev.taxes_annual,
        insurance_annual: d.insurance_annual ?? prev.insurance_annual,
        repairs_annual: d.repairs_annual ?? prev.repairs_annual,
        utilities_annual: d.utilities_annual ?? prev.utilities_annual,
        other_expenses_annual: d.other_expenses_annual ?? prev.other_expenses_annual,
        exit_cap_rate: d.exit_cap_rate ?? prev.exit_cap_rate,
      }));
      const groupCount = Array.isArray(d.unit_groups) ? d.unit_groups.length : 0;
      const srcLabel = sources.length > 0 ? ` from ${sources.slice(0, 2).join(", ")}${sources.length > 2 ? ` +${sources.length - 2} more` : ""}` : "";
      toast.success(`${groupCount} unit group${groupCount !== 1 ? "s" : ""} loaded${srcLabel}`);
    } catch { toast.error("Autofill failed"); } finally { setAutofilling(false); }
  };

  // ── Scenario helpers ──────────────────────────────────────────────────────
  const activeScenario = activeScenarioId ? (data.scenarios || []).find(s => s.id === activeScenarioId) : null;
  const effectiveData: UWData = activeScenario
    ? { ...data, ...activeScenario.overrides, scenarios: data.scenarios }
    : data;

  const solveScenario = useCallback((type: ScenarioType, metric: WizardMetric, target: number) => {
    // Bisection goal-seek: find the input value that makes the metric match target
    const getMetric = (d: UWData) => {
      const r = calc(d, calcMode);
      switch (metric) {
        case "em": return r.em;
        case "coc": return r.coc;
        case "stabilizedCoC": return r.stabilizedCoC;
        case "dscr": return r.dscr;
        case "stabilizedDSCR": return r.stabilizedDSCR;
        case "capRate": return r.proformaCapRate;
        case "yoc": return r.yoc;
        case "irr": {
          // True XIRR using DCF cash flows
          if (r.equity <= 0 || r.yearlyDCF.length === 0) return 0;
          return xirr([-r.equity, ...r.yearlyDCF.map((yr, i) =>
            i === r.yearlyDCF.length - 1 ? yr.cashFlow + r.exitEquity : yr.cashFlow
          )]);
        }
      }
    };

    if (type === "land_residual") {
      // Solve for purchase_price: search 0 to 10x current price
      let lo = 0, hi = Math.max(data.purchase_price * 10, 50_000_000);
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const v = getMetric({ ...data, purchase_price: mid });
        if (v > target) lo = mid; else hi = mid;
      }
      return { value: Math.round((lo + hi) / 2), label: "Max Purchase Price", scenarioOverrides: { purchase_price: Math.round((lo + hi) / 2) } as Partial<UWData> };
    }
    if (type === "rent_target") {
      // Solve for a rent multiplier on all market rents
      let lo = 0, hi = 10; // 0x to 10x current rents
      const baseGroups = data.unit_groups;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const scaledGroups = baseGroups.map(g => ({
          ...g,
          market_rent_per_sf: g.market_rent_per_sf * mid,
          market_rent_per_unit: g.market_rent_per_unit * mid,
          market_rent_per_bed: g.market_rent_per_bed * mid,
        }));
        const v = getMetric({ ...data, unit_groups: scaledGroups });
        if (v < target) lo = mid; else hi = mid;
      }
      const mult = (lo + hi) / 2;
      const scaledGroups = baseGroups.map(g => ({
        ...g,
        market_rent_per_sf: Math.round(g.market_rent_per_sf * mult * 100) / 100,
        market_rent_per_unit: Math.round(g.market_rent_per_unit * mult),
        market_rent_per_bed: Math.round(g.market_rent_per_bed * mult),
      }));
      return { value: mult, label: `Rents at ${(mult * 100).toFixed(0)}% of current market`, scenarioOverrides: { unit_groups: scaledGroups } as Partial<UWData> };
    }
    if (type === "exit_cap") {
      // Solve for exit_cap_rate: lower cap = higher exit value
      let lo = 0.5, hi = 20;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const v = getMetric({ ...data, exit_cap_rate: mid });
        if (v < target) hi = mid; else lo = mid;
      }
      const cap = Math.round((lo + hi) / 2 * 100) / 100;
      return { value: cap, label: `Exit Cap at ${cap.toFixed(2)}%`, scenarioOverrides: { exit_cap_rate: cap } as Partial<UWData> };
    }
    return null;
  }, [data, calcMode]);

  const runWizardSolve = useCallback(() => {
    if (wizardType === "custom") return;
    setWizardSolving(true);
    // Run in next tick to allow UI update
    setTimeout(() => {
      const result = solveScenario(wizardType, wizardMetric, wizardTarget);
      setWizardResult(result);
      setWizardSolving(false);
    }, 50);
  }, [wizardType, wizardMetric, wizardTarget, solveScenario]);

  const createScenario = (name: string, type: ScenarioType, description: string, overrides: Partial<UWData>) => {
    const scenario: Scenario = { id: uuidv4(), name, type, description, overrides };
    setData(prev => ({ ...prev, scenarios: [...(prev.scenarios || []), scenario] }));
    setActiveScenarioId(scenario.id);
    setShowScenarioWizard(false);
    // Reset wizard
    setWizardStep(0);
    setWizardType("custom");
    setWizardResult(null);
  };

  const deleteScenario = (id: string) => {
    setData(prev => ({ ...prev, scenarios: (prev.scenarios || []).filter(s => s.id !== id) }));
    if (activeScenarioId === id) setActiveScenarioId(null);
  };

  const promoteToBaseline = (id: string) => {
    const scenario = (data.scenarios || []).find(s => s.id === id);
    if (!scenario) return;
    // Merge the scenario overrides into the base data
    setData(prev => {
      const merged = { ...prev, ...scenario.overrides };
      // Remove the promoted scenario from the list
      merged.scenarios = (prev.scenarios || []).filter(s => s.id !== id);
      return merged;
    });
    setActiveScenarioId(null);
    toast.success(`"${scenario.name}" promoted to baseline`);
  };

  const renameScenario = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setData(prev => ({
      ...prev,
      scenarios: (prev.scenarios || []).map(s => s.id === id ? { ...s, name: trimmed } : s),
    }));
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingScenarioId(id);
    setRenameValue(currentName);
  };

  const commitRename = () => {
    if (renamingScenarioId) renameScenario(renamingScenarioId, renameValue);
    setRenamingScenarioId(null);
    setRenameValue("");
  };

  const openCompareModal = () => {
    // Pre-select baseline and all scenarios
    const initial = new Set<string>(["baseline", ...(data.scenarios || []).map(s => s.id)]);
    setCompareSelection(initial);
    setShowCompareModal(true);
  };

  const toggleCompareSelection = (key: string) => {
    setCompareSelection(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Metrics + page context ─────────────────────────────────────────────
  // Compute metrics and publish the page context to the universal chatbot
  // BEFORE the `if (loading) return` guard so useSetPageContext runs on
  // every render. Hooks declared after the guard crash with React error
  // #310 the moment loading flips false ("Rendered more hooks than during
  // the previous render"). calc() is a top-level pure function so calling
  // it during the loading phase is harmless — effectiveData just starts
  // as the default UWData shape.
  const m = calc(effectiveData, calcMode);
  const baselineM = activeScenario ? calc(data, calcMode) : m;
  // d = display data — use this for all input bindings so scenarios work
  const d = effectiveData;

  useSetPageContext(
    {
      dealId: params.id,
      dealName: deal?.name || null,
      route: "underwriting",
      screenSummary: `Underwriting — Purchase: $${(d.purchase_price || 0).toLocaleString()}, Vacancy: ${d.vacancy_rate || 0}%, Exit Cap: ${d.exit_cap_rate || 0}%, Hold: ${d.hold_period_years || 0}y`,
      underwriting: {
        uwData: d as unknown as Record<string, unknown>,
        metrics: m as unknown as Record<string, unknown>,
        onApplyPatch: (patch) => {
          setData((prev) => ({ ...prev, ...(patch as Partial<typeof d>) }));
          toast.success("Applied to model — remember to Save");
        },
      },
    },
    [params.id, deal?.name, d.purchase_price, d.vacancy_rate, d.exit_cap_rate, d.hold_period_years]
  );

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className={`flex gap-4 ${docViewerOpen ? "" : ""}`}>
    <div className={`space-y-5 min-w-0 ${docViewerOpen ? "flex-1" : "w-full"}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Underwriting</h2>
          <p className="text-sm text-muted-foreground">{deal?.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          <Button variant="outline" size="sm" onClick={openDocViewer}>
            <Eye className="h-4 w-4 mr-2" />Docs
          </Button>
          <Button variant="outline" size="sm" onClick={openDocPicker} disabled={autofilling || saving}>
            {autofilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Autofill
          </Button>
          <Button size="sm" onClick={save} disabled={saving || autofilling}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
        </div>
      </div>

      {/* ── Scenario Tabs ── */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto bg-muted/20">
          <button
            onClick={() => setActiveScenarioId(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              !activeScenarioId
                ? "bg-foreground/10 text-foreground border border-foreground/20 shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <BarChart3 className="h-3 w-3" />
            Baseline
          </button>
          {(data.scenarios || []).map(s => {
            const isActive = activeScenarioId === s.id;
            const isRenaming = renamingScenarioId === s.id;
            return (
              <div key={s.id} className="flex items-center">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      else if (e.key === "Escape") { e.preventDefault(); setRenamingScenarioId(null); setRenameValue(""); }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap outline-none border border-primary bg-background text-foreground"
                    style={{ width: `${Math.max(renameValue.length + 2, 10)}ch` }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      if (isActive) startRename(s.id, s.name);
                      else setActiveScenarioId(s.id);
                    }}
                    onDoubleClick={() => startRename(s.id, s.name)}
                    title={isActive ? "Click to rename" : "Click to view"}
                    className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? "bg-primary/15 text-primary border border-primary/40 shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <span>{s.name}</span>
                    {isActive && <Pencil className="h-2.5 w-2.5 opacity-50" />}
                    {isActive && (
                      <button
                        onClick={(e) => { e.stopPropagation(); promoteToBaseline(s.id); }}
                        className="ml-0.5 rounded p-0.5 transition-colors text-primary/50 hover:text-emerald-400 hover:bg-emerald-500/10"
                        title="Set as new baseline (merge into base model)"
                      >
                        <Check className="h-2.5 w-2.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteScenario(s.id); }}
                      className={`ml-0.5 rounded p-0.5 transition-colors ${
                        isActive
                          ? "text-primary/50 hover:text-red-400 hover:bg-red-500/10"
                          : "text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10"
                      }`}
                      title="Delete scenario"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={() => { setShowScenarioWizard(true); setWizardStep(0); setWizardType("custom"); setWizardResult(null); setWizardTarget(businessPlan?.target_equity_multiple_min || 2); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap border border-dashed border-border"
          >
            <Plus className="h-3 w-3" />
            Scenario
          </button>
          {(data.scenarios || []).length > 0 && (
            <button
              onClick={openCompareModal}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors whitespace-nowrap border border-primary/40"
              title="Compare scenarios"
            >
              <GitCompare className="h-3 w-3" />
              Compare
            </button>
          )}
        </div>
        {activeScenario && (
          <div className="px-4 py-2 border-t bg-amber-500/10 border-amber-500/30 flex items-center gap-2">
            <span className="text-xs font-semibold text-amber-300">Scenario:</span>
            <span className="text-xs text-amber-200">{activeScenario.description || activeScenario.name}</span>
            <button
              onClick={() => startRename(activeScenario.id, activeScenario.name)}
              className="text-amber-300/70 hover:text-amber-200 transition-colors"
              title="Rename scenario"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {activeScenario.type !== "custom" && (
              <span className="ml-auto text-2xs text-amber-300/80">Changes from baseline highlighted</span>
            )}
          </div>
        )}
      </div>

      {/* Returns — Before (In-Place) vs After (Pro Forma) */}
      <div className={`border rounded-xl bg-card overflow-hidden ${activeScenario ? "ring-2 ring-amber-300/50" : ""}`}>
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <h3 className="font-semibold text-sm">{isGroundUp ? "Returns — Stabilized" : "Returns — In-Place vs Proforma"}{d.has_refi && d.has_financing ? " (Post-Refi)" : ""}</h3>
          {activeScenario && (
            <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{activeScenario.name}</span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border">
          {([
            { label: "NOI", ip: fc(m.inPlaceNOI), pf: fc(m.proformaNOI) },
            { label: "Cap Rate", ip: m.inPlaceCapRate > 0 ? `${m.inPlaceCapRate.toFixed(2)}%` : "—", pf: m.proformaCapRate > 0 ? `${m.proformaCapRate.toFixed(2)}%` : "—" },
            { label: "Cash-on-Cash", ip: m.inPlaceCoC !== 0 ? `${m.inPlaceCoC.toFixed(2)}%` : "—", pf: m.stabilizedCoC !== 0 ? `${m.stabilizedCoC.toFixed(2)}%` : "—" },
            { label: "DSCR", ip: m.inPlaceDSCR > 0 ? `${m.inPlaceDSCR.toFixed(2)}x` : "—", pf: m.stabilizedDSCR > 0 ? `${m.stabilizedDSCR.toFixed(2)}x` : "—" },
            { label: "GRM", ip: m.inPlaceGRM > 0 ? m.inPlaceGRM.toFixed(2) : "—", pf: m.proformaGRM > 0 ? m.proformaGRM.toFixed(2) : "—" },
            { label: "Yield on Cost", ip: "—", pf: m.yoc > 0 ? `${m.yoc.toFixed(2)}%` : "—" },
          ] as const).map(metric => (
            <div key={metric.label} className="bg-card p-3">
              <p className="text-xs text-muted-foreground mb-2">{metric.label}</p>
              {isGroundUp ? (
                <p className="text-lg font-bold tabular-nums text-primary">{metric.pf}</p>
              ) : (
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground/70 uppercase">In-Place</p>
                    <p className="text-sm font-semibold tabular-nums">{metric.ip}</p>
                  </div>
                  <span className="text-muted-foreground/40 text-xs">→</span>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground/70 uppercase">Proforma</p>
                    <p className="text-sm font-semibold tabular-nums text-primary">{metric.pf}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border border-t">
          {/* Total Units with arrow */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-2">{isSH ? "Total Beds" : isMF ? "Total Units" : "Total SF"}</p>
            {isGroundUp ? (
              <p className="text-lg font-bold tabular-nums text-primary">{fn(isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF)}</p>
            ) : (
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground/70 uppercase">In-Place</p>
                  <p className="text-sm font-semibold tabular-nums">{fn(isSH ? m.ipTotalBeds : isMF ? m.ipTotalUnits : m.ipTotalSF)}</p>
                </div>
                <span className="text-muted-foreground/40 text-xs">→</span>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground/70 uppercase">Pro Forma</p>
                  <p className="text-sm font-semibold tabular-nums text-primary">{fn(isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF)}</p>
                </div>
              </div>
            )}
          </div>
          {/* Price / Unit|SF|Bed: purchase → sale */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-2">{isSH ? "Price / Bed" : isMF ? "Price / Unit" : "Price / SF"}</p>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground/70 uppercase">Purchase</p>
                <p className="text-sm font-semibold tabular-nums">{isSH ? (m.pricePerBed > 0 ? fc(m.pricePerBed) : "—") : isMF ? (m.pricePerUnit > 0 ? fc(m.pricePerUnit) : "—") : m.pricePerSF > 0 ? fc(m.pricePerSF) : "—"}</p>
              </div>
              <span className="text-muted-foreground/40 text-xs">→</span>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground/70 uppercase">Sale</p>
                <p className="text-sm font-semibold tabular-nums text-primary">{isSH ? (m.exitPricePerBed > 0 ? fc(m.exitPricePerBed) : "—") : isMF ? (m.exitPricePerUnit > 0 ? fc(m.exitPricePerUnit) : "—") : m.exitPricePerSF > 0 ? fc(m.exitPricePerSF) : "—"}</p>
              </div>
            </div>
          </div>
          {/* Equity Multiple */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-1">Equity Multiple</p>
            <p className="text-lg font-bold tabular-nums">{m.em > 0 ? `${m.em.toFixed(2)}x` : "—"}</p>
            {(() => {
              const irrVal = m.equity > 0 && m.yearlyDCF.length > 0
                ? xirr([-m.equity, ...m.yearlyDCF.map((yr, i) =>
                    i === m.yearlyDCF.length - 1 ? yr.cashFlow + m.exitEquity : yr.cashFlow
                  )])
                : 0;
              return irrVal > 0
                ? <p className="text-xs text-muted-foreground">IRR {irrVal.toFixed(1)}% · {d.hold_period_years}yr hold</p>
                : <p className="text-xs text-muted-foreground">{d.hold_period_years}yr hold</p>;
            })()}
          </div>
          {/* Debt */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-1">Debt</p>
            <p className="text-lg font-bold tabular-nums">{fc(m.acqLoan)}</p>
            <p className="text-xs text-muted-foreground/60">{d.acq_ltc}% LTC · {d.acq_interest_rate}% · {d.acq_amort_years}yr</p>
          </div>
          {/* Equity */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-1">Equity</p>
            <p className="text-lg font-bold tabular-nums">{fc(m.equity)}</p>
            <p className="text-xs text-muted-foreground/60">{m.totalCost > 0 ? ((m.equity / m.totalCost) * 100).toFixed(0) : 0}% of total</p>
          </div>
          {/* Total Investment */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-1">Total Investment</p>
            <p className="text-lg font-bold tabular-nums">{fc(m.totalCost)}</p>
            <p className="text-xs text-muted-foreground/60">{fc(m.capexTotal)} CapEx · {fc(m.closingCosts)} closing</p>
          </div>
        </div>
      </div>

      {/* ── Massing Panel — two-level tabbed header:
          Level 1: Site plan scenarios (massings) — lets the analyst flip
                   between "Base Case", "Alt 1", etc.
          Level 2: Buildings within the selected massing — each tab shows
                   that building's section cut and stats.
          Renders only for ground-up deals with pushed massing data. */}
      {isGroundUp && d.building_program?.scenarios?.length > 0 && (() => {
        const bp = d.building_program;
        const allScenarios: any[] = bp.scenarios || [];
        if (allScenarios.length === 0) return null;

        const MassingSectionCut = require("@/components/massing/MassingSectionCut").default;
        const { computeMassingSummary: cms2 } = require("@/components/massing/massing-utils");
        const landSF = d.site_info?.land_sf || (deal as any)?.land_acres * 43560 || 0;
        const zi = { land_sf: landSF, far: d.far || 0, lot_coverage_pct: d.lot_coverage_pct || 0, height_limit_ft: d.height_limit_stories * 10 || 0, height_limit_stories: d.height_limit_stories || 0 };

        // Group building_program.scenarios by site_plan_scenario_id
        const groups: Record<string, any[]> = {};
        for (const s of allScenarios) {
          const key = s.site_plan_scenario_id || "__default";
          if (!groups[key]) groups[key] = [];
          groups[key].push(s);
        }
        const massingIds = Object.keys(groups);

        // Selected massing (level 1)
        const selectedMassingId = activeMassingScenarioId && groups[activeMassingScenarioId]
          ? activeMassingScenarioId
          : massingIds[0];
        const buildingsInMassing = groups[selectedMassingId] || [];

        // Selected building (level 2)
        const selectedBuildingScenario = buildingsInMassing.find((s: any) =>
          s.site_plan_building_id === activeMassingBuildingId
        ) || buildingsInMassing[0];
        const ms = selectedBuildingScenario ? cms2(selectedBuildingScenario, zi) : null;

        const massingLabel = (mid: string) => {
          const meta = sitePlanScenarioMeta[mid];
          if (meta?.name) return meta.name;
          if (mid === "__default") return "Massing";
          return `Massing ${massingIds.indexOf(mid) + 1}`;
        };

        const buildingLabel = (s: any, i: number) => {
          if (s.site_plan_building_id && sitePlanBuildingLabels[s.site_plan_building_id]) {
            return sitePlanBuildingLabels[s.site_plan_building_id];
          }
          return s.name || `Building ${i + 1}`;
        };

        return (
          <div className="border rounded-xl bg-card shadow-card mb-4 overflow-hidden">
            {/* Level 1 — Massing selector */}
            <div className="flex items-center gap-0 border-b bg-muted/40 overflow-x-auto">
              <div className="flex items-center gap-1 px-3 py-1.5 shrink-0">
                <Layers className="h-4 w-4 text-blue-400" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Massing</span>
              </div>
              {massingIds.map(mid => {
                const isSelected = mid === selectedMassingId;
                const meta = sitePlanScenarioMeta[mid];
                return (
                  <button
                    key={mid}
                    onClick={() => { setActiveMassingScenarioId(mid); setActiveMassingBuildingId(null); }}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors shrink-0 ${
                      isSelected
                        ? "border-amber-400 text-amber-300 bg-amber-400/5"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                  >
                    {massingLabel(mid)}
                    {meta?.is_base_case && <span className="ml-1.5 text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded">★</span>}
                  </button>
                );
              })}
            </div>
            {/* Level 2 — Building tabs within the selected massing */}
            {buildingsInMassing.length > 1 && (
              <div className="flex items-center gap-0 border-b bg-muted/20 overflow-x-auto pl-6">
                {buildingsInMassing.map((s: any, i: number) => {
                  const isSelected = s === selectedBuildingScenario;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActiveMassingBuildingId(s.site_plan_building_id || s.id)}
                      className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors shrink-0 ${
                        isSelected
                          ? "border-blue-400 text-blue-400 bg-blue-400/5"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                      }`}
                    >
                      {buildingLabel(s, i)}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Selected building detail */}
            {selectedBuildingScenario && ms && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">{buildingLabel(selectedBuildingScenario, buildingsInMassing.indexOf(selectedBuildingScenario))}</h3>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>{fn(ms.total_gsf)} GSF</span>
                    <span>{fn(ms.total_nrsf)} NRSF</span>
                    <span>{fn(ms.total_units)} units</span>
                    <span>{Math.round(ms.total_height_ft).toLocaleString()} ft</span>
                    <span>{fn(ms.total_parking_spaces_est)} parking</span>
                  </div>
                </div>
                <div className="max-w-lg mx-auto">
                  <MassingSectionCut scenario={selectedBuildingScenario} summary={ms} />
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Saved Scenarios — named snapshots the analyst pushed from the
          Site Plan page via "Save as UW Scenario". Renders only when at
          least one is saved, so quiet for single-scenario deals.
          Loading a scenario overwrites building_program / unit_groups /
          revenue lists with the snapshot; it does NOT touch cost basis,
          loan sizing, or other inputs that the analyst typically tunes
          independently of building mix. */}
      {uwScenarios.length > 0 && (
        <Section title={`Saved Scenarios (${uwScenarios.length})`} icon={<Layers className="h-4 w-4 text-amber-400" />}>
          <div className="space-y-2">
            {uwScenarios.map((sc) => {
              const s = sc.summary || {};
              return (
                <div
                  key={sc.id}
                  className="flex items-start gap-3 p-3 border border-border/40 rounded-lg bg-muted/5 hover:border-border/80 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{sc.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(sc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                      {s.total_gsf ? <span>{s.total_gsf.toLocaleString()} GSF</span> : null}
                      {s.total_nrsf ? <span>{s.total_nrsf.toLocaleString()} NRSF</span> : null}
                      {s.total_units ? <span>{s.total_units.toLocaleString()} units</span> : null}
                      {s.total_parking_spaces_est ? <span>{s.total_parking_spaces_est.toLocaleString()} parking</span> : null}
                      {s.buildings_count && s.buildings_count > 1 ? (
                        <span>{s.buildings_count} buildings</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!window.confirm(
                          `Load "${sc.name}"? This replaces the current building program and unit mix with the snapshot.`
                        )) return;
                        setData((p) => ({
                          ...p,
                          ...(sc.building_program ? { building_program: sc.building_program as any } : {}),
                          unit_groups: Array.isArray(sc.unit_groups)
                            ? (sc.unit_groups.map((g: any) => ({ ...newGroup(), ...g })) as UnitGroup[])
                            : p.unit_groups,
                          ...(Array.isArray(sc.other_income_items)
                            ? { other_income_items: sc.other_income_items as any }
                            : {}),
                          ...(Array.isArray(sc.commercial_tenants)
                            ? { commercial_tenants: sc.commercial_tenants as any }
                            : {}),
                        }));
                        toast.success(`Loaded "${sc.name}"`);
                      }}
                      title="Replace current building program + unit mix with this snapshot"
                    >
                      Load
                    </Button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete scenario "${sc.name}"? This can't be undone.`)) return;
                        const next = uwScenarios.filter((x) => x.id !== sc.id);
                        setUwScenarios(next);
                        try {
                          const uwRes = await fetch(`/api/underwriting?deal_id=${params.id}`);
                          const uwJson = await uwRes.json();
                          const current = uwJson.data?.data
                            ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
                            : {};
                          await fetch("/api/underwriting", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              deal_id: params.id,
                              data: { ...current, uw_scenarios: next },
                            }),
                          });
                          toast.success(`Deleted "${sc.name}"`);
                        } catch {
                          toast.error("Failed to delete scenario");
                        }
                      }}
                      className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10"
                      title="Delete scenario"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title={isGroundUp ? "Development Cost Basis" : "Purchase & Cost Basis"} icon={<DollarSign className="h-4 w-4 text-green-400" />}>
        {isGroundUp ? (
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <NumInput label="Land Acquisition Cost" value={d.land_cost} onChange={v => set("land_cost", v)} prefix="$" />
              <NumInput label="Closing Costs" value={d.closing_costs_pct} onChange={v => set("closing_costs_pct", v)} suffix="%" decimals={1} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Total Hard Costs</p>
                <p className="text-sm font-semibold">{fc(m.totalHardCosts)}</p>
                <p className="text-[10px] text-muted-foreground/60">{fn(d.max_gsf || 0)} GSF × ${d.hard_cost_per_sf.toFixed(2)}/SF</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Soft Costs</p>
                <p className="text-sm font-semibold">{fc(m.softCostsTotal)}</p>
                <p className="text-[10px] text-muted-foreground/60">{d.soft_cost_pct.toFixed(1)}% of hard costs</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Closing Cost $</p>
                <p className="text-sm font-semibold">{fc(m.closingCosts)}</p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Total Development Cost</p>
                <p className="text-lg font-bold text-primary">{fc(m.totalCost)}</p>
                <p className="text-[10px] text-muted-foreground/60">Land + Hard + Soft + Closing</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
            <div>
              <NumInput label="Purchase Price" value={d.purchase_price} onChange={v => set("purchase_price", v)} prefix="$" />
              {d.purchase_price > 0 && (
                <p className="text-[10px] text-muted-foreground/60 mt-1 text-right tabular-nums">
                  {isSH ? (m.pricePerBed > 0 ? `${fc(m.pricePerBed)}/bed` : "") : isMF ? (m.pricePerUnit > 0 ? `${fc(m.pricePerUnit)}/unit` : "") : m.pricePerSF > 0 ? `${fc(m.pricePerSF)}/SF` : ""}
                </p>
              )}
            </div>
            <NumInput label="Closing Costs" value={d.closing_costs_pct} onChange={v => set("closing_costs_pct", v)} suffix="%" decimals={1} />
            <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Closing Cost $</p><p className="text-sm font-semibold">{fc(m.closingCosts)}</p></div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Total Cost {isSH ? "/ Bed" : isMF ? "/ Unit" : "/ SF"}</p>
              <p className="text-sm font-semibold">{isSH ? (m.totalBeds > 0 ? fc(m.totalCost / m.totalBeds) : "—") : isMF ? (m.totalUnits > 0 ? fc(m.totalCost / m.totalUnits) : "—") : m.totalSF > 0 ? fc(m.totalCost / m.totalSF) : "—"}</p>
              <p className="text-[10px] text-muted-foreground/60">PP + closing + CapEx</p>
            </div>
          </div>
        )}
      </Section>

      {/* Rent Comps live on the Comps page now — see
          src/app/deals/[id]/comps/page.tsx. Storage stays in this
          underwriting blob (rent_comps / rent_comp_unit_types /
          selected_comp_ids) so the investment-package generator at
          /api/deals/[id]/investment-package/generate-all keeps working
          unchanged. */}

      {/* Mixed-Use Components used to live here as a unified editor.
          Per-component inputs now live in their natural homes:
            • OpEx allocation %          → Operating Assumptions section
            • Cap rate per component     → Exit Analysis section
            • LC / TI / free rent /
              rent escalation            → Absorption / Lease-Up section
          Data still lives in d.mixed_use.components (seeded from
          building_program's nrsf_by_use when missing — see the load
          effect below). */}


      {/* ═══════════════════ REDEVELOPMENT OVERLAY ═══════════════════
          Hidden in Basic — only relevant for value-add / redevelopment
          plays where existing improvements are demolished or repositioned.
          Already collapsed by default in Advanced. */}
      {!isBasic && (
      <Section title="Redevelopment Overlay" icon={<Building2 className="h-4 w-4 text-rose-400" />}>
        <div className="mt-3">
          {(() => {
            const rd = d.redevelopment || defaultRedevelopment();
            const setRD = (upd: Partial<RedevelopmentConfig>) => setData(p => ({ ...p, redevelopment: { ...(p.redevelopment || defaultRedevelopment()), ...upd } }));
            const transitionMonths = rd.vacancy_period_months + rd.demolition_period_months + rd.construction_period_months;
            const calcLostIncome = rd.existing_noi * (rd.vacancy_period_months + rd.demolition_period_months) / 12;
            const demoCost = rd.demolition_items.reduce((s, i) => s + i.amount, 0);
            return (
              <>
                <label className="flex items-center gap-2 text-sm mb-4">
                  <input type="checkbox" checked={rd.enabled} onChange={e => setRD({ enabled: e.target.checked })} className="accent-primary" />
                  Enable Redevelopment Overlay (converting existing asset)
                </label>
                {rd.enabled && (
                  <>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Existing Asset</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Current Use</label>
                        <input type="text" value={rd.existing_use} onChange={e => setRD({ existing_use: e.target.value })} placeholder="e.g. Life Science, Office" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                      </div>
                      <NumInput label="Existing SF" value={rd.existing_sf} onChange={v => setRD({ existing_sf: v })} />
                      <NumInput label="Current NOI" value={rd.existing_noi} onChange={v => setRD({ existing_noi: v })} prefix="$" />
                      <NumInput label="Current Occupancy" value={rd.existing_occupancy_pct} onChange={v => setRD({ existing_occupancy_pct: v })} suffix="%" decimals={1} />
                    </div>

                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transition Timeline</h4>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <NumInput label="Vacancy Period (mo)" value={rd.vacancy_period_months} onChange={v => setRD({ vacancy_period_months: v })} />
                      <NumInput label="Demolition Period (mo)" value={rd.demolition_period_months} onChange={v => setRD({ demolition_period_months: v })} />
                      <NumInput label="Construction Period (mo)" value={rd.construction_period_months} onChange={v => setRD({ construction_period_months: v })} />
                    </div>

                    {/* Demolition line items */}
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Demolition / Abatement Costs</h4>
                    <table className="w-full text-sm border-collapse mb-2">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Description</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Amount</th>
                          <th className="w-[28px]" />
                        </tr>
                      </thead>
                      <tbody>
                        {rd.demolition_items.map(item => (
                          <tr key={item.id} className="border-b hover:bg-muted/10 group">
                            <td className="px-2 py-1.5"><input type="text" value={item.label} onChange={e => setRD({ demolition_items: rd.demolition_items.map(i => i.id === item.id ? { ...i, label: e.target.value } : i) })} className="w-full bg-transparent text-sm outline-none" /></td>
                            <td className="px-2 py-1.5"><CellInput value={item.amount} onChange={v => setRD({ demolition_items: rd.demolition_items.map(i => i.id === item.id ? { ...i, amount: v } : i) })} prefix="$" /></td>
                            <td className="px-1 py-1.5"><button onClick={() => setRD({ demolition_items: rd.demolition_items.filter(i => i.id !== item.id) })} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Button variant="ghost" size="sm" className="mb-4" onClick={() => setRD({ demolition_items: [...rd.demolition_items, newDevBudgetItem("Demo / Abatement", "hard", "demolition", "lump sum")] })}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                    </Button>

                    {/* Parking conversion */}
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Parking Conversion</h4>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <NumInput label="Existing Parking Spaces" value={rd.existing_parking_spaces} onChange={v => setRD({ existing_parking_spaces: v })} />
                      <NumInput label="Spaces Converted/Lost" value={rd.parking_spaces_converted} onChange={v => setRD({ parking_spaces_converted: v })} />
                      <NumInput label="New Spaces Built" value={rd.new_parking_spaces_built} onChange={v => setRD({ new_parking_spaces_built: v })} />
                    </div>

                    {/* Phased redevelopment */}
                    <label className="flex items-center gap-2 text-sm mb-3">
                      <input type="checkbox" checked={rd.is_phased} onChange={e => setRD({ is_phased: e.target.checked })} className="accent-primary" />
                      Phased Redevelopment
                    </label>
                    {rd.is_phased && (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="border rounded-md p-3 bg-muted/5">
                          <input type="text" value={rd.phase_1_label} onChange={e => setRD({ phase_1_label: e.target.value })} className="bg-transparent text-sm font-semibold outline-none mb-2 w-full" />
                          <div className="grid grid-cols-2 gap-2">
                            <NumInput label="SF" value={rd.phase_1_sf} onChange={v => setRD({ phase_1_sf: v })} />
                            <NumInput label="Timeline (mo)" value={rd.phase_1_timeline_months} onChange={v => setRD({ phase_1_timeline_months: v })} />
                          </div>
                        </div>
                        <div className="border rounded-md p-3 bg-muted/5">
                          <input type="text" value={rd.phase_2_label} onChange={e => setRD({ phase_2_label: e.target.value })} className="bg-transparent text-sm font-semibold outline-none mb-2 w-full" />
                          <div className="grid grid-cols-2 gap-2">
                            <NumInput label="SF" value={rd.phase_2_sf} onChange={v => setRD({ phase_2_sf: v })} />
                            <NumInput label="Timeline (mo)" value={rd.phase_2_timeline_months} onChange={v => setRD({ phase_2_timeline_months: v })} />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Summary */}
                    <div className="border rounded-md bg-muted/10 p-3 text-sm space-y-1">
                      <div className="flex justify-between"><span>Total Transition Timeline</span><span className="font-semibold tabular-nums">{transitionMonths} months</span></div>
                      <div className="flex justify-between"><span>Lost Income During Transition</span><span className="font-semibold tabular-nums text-red-400">{fc(calcLostIncome)}</span></div>
                      <div className="flex justify-between"><span>Total Demolition / Abatement</span><span className="font-semibold tabular-nums">{fc(demoCost)}</span></div>
                      <div className="flex justify-between"><span>Net Parking Impact</span><span className="font-semibold tabular-nums">{fn(rd.existing_parking_spaces - rd.parking_spaces_converted + rd.new_parking_spaces_built)} spaces (was {fn(rd.existing_parking_spaces)})</span></div>
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </Section>
      )}

      <Section title="Revenue — Unit / Space Mix" icon={<Calculator className="h-4 w-4 text-indigo-400" />}>
        {/* NRSF Budget — Ground-Up Only.
            Pass-through from Programming: uses the active massing scenario's
            GSF / NRSF directly (with max_gsf / max_nrsf as the fallback for
            deals whose massing hasn't been re-saved). The old logic treated
            max_nrsf as the target for residential-only unit allocation,
            which over-counted on mixed-use deals because max_nrsf on the UW
            blob is the TOTAL NRSF. We now split explicitly:
               • Rev NRSF  = residential + commercial (from nrsf_by_use)
               • Target    = residential NRSF (what the unit-mix table below
                             actually budgets against)
               • Non-Rev   = GSF − Rev NRSF (lobbies, circulation, mechanical,
                             common area, etc.) */}
        {isGroundUp && (() => {
          const bp = d.building_program;
          const activeS: { id?: string; is_baseline?: boolean; floors?: unknown[] } | undefined =
            bp?.scenarios?.find((s: { is_baseline?: boolean }) => s.is_baseline) ||
            bp?.scenarios?.find((s: { id?: string }) => s.id === bp.active_scenario_id) ||
            bp?.scenarios?.[0];
          let gsf = d.max_gsf || 0;
          let totalNrsf = d.max_nrsf || 0;
          let resNrsf = 0;
          let comNrsf = 0;
          if (activeS?.floors) {
            // Lazy-import to avoid a top-level cycle with massing-utils.
            const { computeMassingSummary } = require("@/components/massing/massing-utils");
            const landSF = d.site_info?.land_sf || (deal as { land_acres?: number })?.land_acres ?
              ((d.site_info?.land_sf || 0) || ((deal as { land_acres?: number }).land_acres! * 43560)) : 0;
            const zi = { land_sf: landSF, far: d.far || 0, lot_coverage_pct: d.lot_coverage_pct || 0, height_limit_ft: (d.height_limit_stories || 0) * 10, height_limit_stories: d.height_limit_stories || 0 };
            const summary = computeMassingSummary(activeS, zi);
            gsf = summary.total_gsf || gsf;
            totalNrsf = summary.total_nrsf || totalNrsf;
            resNrsf = summary.nrsf_by_use?.residential || 0;
            const retail = summary.nrsf_by_use?.retail || 0;
            const office = summary.nrsf_by_use?.office || 0;
            comNrsf = retail + office;
          }
          // If the massing didn't split by use (or there's no building_program
          // yet), fall back to treating all NRSF as residential for MF/SH so
          // the block still shows something useful.
          if (resNrsf === 0 && comNrsf === 0 && totalNrsf > 0) resNrsf = totalNrsf;
          if (gsf === 0 && totalNrsf === 0) return null;

          const target = resNrsf > 0 ? resNrsf : totalNrsf;
          const nonRev = Math.max(0, gsf - (resNrsf + comNrsf));
          // Scope the "allocated" tally to just the unit groups tied to
          // the active building. Without this, a 3-building massing would
          // show allocated = sum across all buildings vs target = one
          // building's residential NRSF, which always blew the budget.
          const activeBid = (activeS as any)?.site_plan_building_id || null;
          const buildingGroups = activeBid
            ? d.unit_groups.filter((g: any) => (g.site_plan_building_id || null) === activeBid)
            : d.unit_groups;
          const allocatedNRSF = buildingGroups.reduce(
            (s: number, g: UnitGroup) => s + effectiveUnits(g) * (g.sf_per_unit || 0),
            0
          );
          const remainingNRSF = target - allocatedNRSF;
          const pctUsed = target > 0 ? (allocatedNRSF / target) * 100 : 0;
          const barColor = pctUsed > 100 ? "bg-red-500" : pctUsed > 90 ? "bg-amber-500" : "bg-emerald-500";

          return (
            <div className="mt-3 mb-4 p-4 border border-primary/30 rounded-lg bg-primary/5">
              <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
                <div>
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">NRSF Budget from Building Massing</h4>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    All values carry over from Programming. Adjust unit sizes
                    or counts below so the residential NRSF target matches.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Residential NRSF Target</div>
                  <div className="text-lg font-bold text-primary tabular-nums">{fn(target)} <span className="text-xs text-muted-foreground">NRSF</span></div>
                </div>
              </div>

              {/* Compact GSF / NRSF / Non-Rev breakdown carried from massing */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-[11px]">
                <div className="px-2 py-1.5 rounded bg-background/60 border border-border/40">
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Total GSF</div>
                  <div className="tabular-nums font-semibold">{fn(gsf)}</div>
                </div>
                <div className="px-2 py-1.5 rounded bg-background/60 border border-border/40">
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Residential NRSF</div>
                  <div className="tabular-nums font-semibold">{fn(resNrsf)}</div>
                </div>
                <div className="px-2 py-1.5 rounded bg-background/60 border border-border/40">
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Commercial NRSF</div>
                  <div className="tabular-nums font-semibold">{comNrsf > 0 ? fn(comNrsf) : "—"}</div>
                </div>
                <div className="px-2 py-1.5 rounded bg-background/60 border border-border/40">
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Non-Rev Space</div>
                  <div className="tabular-nums font-semibold">{fn(nonRev)}</div>
                  <div className="text-[9px] text-muted-foreground/80">GSF − NRSF</div>
                </div>
              </div>

              <div className="h-3 bg-muted rounded-full overflow-hidden relative">
                <div className={`h-full ${barColor} transition-all duration-300 rounded-full`} style={{ width: `${Math.min(pctUsed, 100)}%` }} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: "100%" }} />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-xs tabular-nums">
                <span className="text-muted-foreground">Allocated: <span className="font-semibold text-foreground">{fn(allocatedNRSF)}</span> NRSF ({pctUsed.toFixed(1)}%)</span>
                <span className={`font-semibold ${remainingNRSF < 0 ? "text-red-400" : remainingNRSF === 0 ? "text-emerald-400" : "text-amber-400"}`}>
                  {remainingNRSF > 0 ? `${fn(remainingNRSF)} NRSF remaining` : remainingNRSF === 0 ? "Matches target" : `${fn(Math.abs(remainingNRSF))} NRSF over`}
                </span>
              </div>
            </div>
          );
        })()}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="w-[28px]" />
                {isSH ? (<>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[160px]">Unit Type</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">#</th>
                  {!isGroundUp && <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">+/−</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">Beds</th>
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">In-Place/Bed</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">{isGroundUp ? "Rent/Bed" : "Market/Bed"}</th>
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">Reno #</th>}
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Proforma/Bed</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Annual Rev</th>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Notes</th>
                  <th className="w-[32px]" />
                </>) : isMF ? (<>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[140px]">Unit Type</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">#</th>
                  {!isGroundUp && <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">+/−</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[40px]">BD</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[40px]">BA</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">SF</th>
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">In-Place Rent</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">{isGroundUp ? "Rent/Unit" : "Market Rent"}</th>
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">Reno #</th>}
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Proforma</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Annual Rev</th>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Notes</th>
                  <th className="w-[32px]" />
                </>) : (<>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[140px]">Unit / Space</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">#</th>
                  {!isGroundUp && <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">+/−</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[65px]">SF/Unit</th>
                  <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[60px]">Lease</th>
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Curr $/SF</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">{isGroundUp ? "Rent $/SF" : "Mkt $/SF"}</th>
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">Reno #</th>}
                  {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Proforma</th>}
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Annual Rev</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">CAM $/SF</th>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Notes</th>
                  <th className="w-[32px]" />
                </>)}
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorderUnits}>
            <SortableContext items={d.unit_groups.map(g => g.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {d.unit_groups.map((g, i) => {
                // Insert a building header row whenever site_plan_building_id
                // transitions from the previous row. We render the header
                // inline (not a separate map) so React's key ordering and
                // the DndContext sortable ids stay aligned with the raw
                // unit_groups array. When no unit_groups carry a building
                // tag, the header never renders and the table looks
                // identical to before.
                const curBid = (g as { site_plan_building_id?: string }).site_plan_building_id || null;
                const prevBid = i > 0
                  ? ((d.unit_groups[i - 1] as { site_plan_building_id?: string }).site_plan_building_id || null)
                  : undefined; // `undefined` on first row forces a header render
                const showBuildingHeader = curBid && curBid !== prevBid;
                const buildingLabel = curBid ? (sitePlanBuildingLabels[curBid] || "Building") : null;
                const ipAnnual = isSH
                  ? g.unit_count * g.beds_per_unit * g.current_rent_per_bed * 12
                  : isMF
                  ? g.unit_count * g.current_rent_per_unit * 12
                  : g.unit_count * g.sf_per_unit * g.current_rent_per_sf;
                const pfAnnual = isSH
                  ? effectiveUnits(g) * g.beds_per_unit * g.market_rent_per_bed * 12
                  : isMF
                  ? effectiveUnits(g) * g.market_rent_per_unit * 12
                  : effectiveUnits(g) * g.sf_per_unit * g.market_rent_per_sf;
                const eu = effectiveUnits(g);
                const renoUnits = Math.min(g.renovation_count || 0, eu);
                const unrenoUnits = eu - renoUnits;
                const proformaAnnual = isSH
                  ? (renoUnits * g.beds_per_unit * g.market_rent_per_bed + unrenoUnits * g.beds_per_unit * g.current_rent_per_bed) * 12
                  : isMF
                  ? (renoUnits * g.market_rent_per_unit + unrenoUnits * g.current_rent_per_unit) * 12
                  : (renoUnits * g.sf_per_unit * g.market_rent_per_sf + unrenoUnits * g.sf_per_unit * g.current_rent_per_sf);
                const uc = g.unit_change || "none";
                const unitChangeCell = (
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <select
                        value={uc}
                        onChange={e => upd(g.id, { unit_change: e.target.value as UnitGroup["unit_change"], unit_change_count: uc === "none" ? 0 : g.unit_change_count || 0 })}
                        className="bg-transparent text-[11px] outline-none w-[38px] text-center"
                      >
                        <option value="none">—</option>
                        <option value="add">+</option>
                        <option value="remove">−</option>
                      </select>
                      {uc !== "none" && (
                        <CellInput value={g.unit_change_count || 0} onChange={v => upd(g.id, { unit_change_count: v })} className="w-[30px]" />
                      )}
                    </div>
                  </td>
                );
                const updFn = (id: string, updates: Partial<UnitGroup>) => {
                  if ("renovation_count" in updates || ((g.renovation_count || 0) > 0 && ("label" in updates || "renovation_cost_per_unit" in updates))) {
                    syncLinkedCapex(id, updates);
                  } else {
                    upd(id, updates);
                  }
                };
                return (
                  <React.Fragment key={g.id}>
                    {showBuildingHeader && (() => {
                      // Subtotal: sum annual rev for all unit groups with
                      // the same site_plan_building_id as this header.
                      const bid = curBid;
                      const groupsInBuilding = d.unit_groups.filter((gg: any) => (gg.site_plan_building_id || null) === bid);
                      const buildingUnits = groupsInBuilding.reduce((s: number, gg: UnitGroup) => s + effectiveUnits(gg), 0);
                      const buildingRev = groupsInBuilding.reduce((s: number, gg: UnitGroup) => {
                        const eu2 = effectiveUnits(gg);
                        return s + (isSH
                          ? eu2 * gg.beds_per_unit * gg.market_rent_per_bed * 12
                          : isMF
                          ? eu2 * gg.market_rent_per_unit * 12
                          : eu2 * gg.sf_per_unit * gg.market_rent_per_sf);
                      }, 0);
                      return (
                        <tr className="bg-primary/5 border-t border-primary/30">
                          <td colSpan={2} className="px-2 py-1.5 text-[10px] font-semibold text-primary/80 uppercase tracking-wide">
                            <Building2 className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                            {buildingLabel}
                          </td>
                          <td className="px-2 py-1.5 text-[10px] text-primary/60 tabular-nums">{buildingUnits} units</td>
                          <td colSpan={95} className="px-2 py-1.5 text-[10px] text-primary/60 tabular-nums text-right">
                            {buildingRev > 0 ? `${fc(buildingRev)}/yr` : ""}
                          </td>
                        </tr>
                      );
                    })()}
                  <SortableRow id={g.id}>
                    {isSH ? (<>
                      <td className="px-2 py-1"><CellText value={g.label} onChange={v => updFn(g.id, { label: v })} placeholder="e.g. 4BR/2BA" /></td>
                      <td className="px-2 py-1"><CellInput value={g.unit_count} onChange={v => updFn(g.id, { unit_count: v })} /></td>
                      {!isGroundUp && unitChangeCell}
                      <td className="px-2 py-1"><CellInput value={g.beds_per_unit} onChange={v => upd(g.id, { beds_per_unit: v })} /></td>
                      {!isGroundUp && (
                        <td className="px-2 py-1">
                          <CellInput value={g.current_rent_per_bed} onChange={v => upd(g.id, { current_rent_per_bed: v })} prefix="$" />
                          <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(ipAnnual)}/yr</p>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <CellInput value={g.market_rent_per_bed} onChange={v => upd(g.id, { market_rent_per_bed: v })} prefix="$" />
                      </td>
                      {!isGroundUp && <td className="px-2 py-1"><CellInput value={g.renovation_count || 0} onChange={v => updFn(g.id, { renovation_count: v })} /></td>}
                      {!isGroundUp && (
                        <td className="px-2 py-1">
                          <span className="block text-right text-sm tabular-nums font-medium">{eu > 0 && g.beds_per_unit > 0 ? fc(Math.round(proformaAnnual / eu / g.beds_per_unit / 12)) : "—"}</span>
                          <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(proformaAnnual)}/yr</p>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <p className="text-right text-sm tabular-nums font-medium">{fc(pfAnnual)}<span className="text-muted-foreground/60 text-[10px]">/yr</span></p>
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={g.notes || ""} onChange={e => upd(g.id, { notes: e.target.value } as Partial<UnitGroup>)}
                          placeholder="" className="w-full bg-transparent text-[10px] text-muted-foreground outline-none italic truncate max-w-[120px]" />
                      </td>
                    </>) : isMF ? (<>
                      <td className="px-2 py-1"><CellText value={g.label} onChange={v => updFn(g.id, { label: v })} placeholder="e.g. 1BR/1BA" /></td>
                      <td className="px-2 py-1"><CellInput value={g.unit_count} onChange={v => updFn(g.id, { unit_count: v })} /></td>
                      {!isGroundUp && unitChangeCell}
                      <td className="px-2 py-1"><CellInput value={g.bedrooms} onChange={v => upd(g.id, { bedrooms: v })} /></td>
                      <td className="px-2 py-1"><CellInput value={g.bathrooms} onChange={v => upd(g.id, { bathrooms: v })} /></td>
                      <td className="px-2 py-1"><CellInput value={g.sf_per_unit} onChange={v => upd(g.id, { sf_per_unit: v })} /></td>
                      {!isGroundUp && (
                        <td className="px-2 py-1">
                          <CellInput value={g.current_rent_per_unit} onChange={v => upd(g.id, { current_rent_per_unit: v })} prefix="$" />
                          <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(ipAnnual)}/yr</p>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <CellInput value={g.market_rent_per_unit} onChange={v => upd(g.id, { market_rent_per_unit: v })} prefix="$" />
                      </td>
                      {!isGroundUp && <td className="px-2 py-1"><CellInput value={g.renovation_count || 0} onChange={v => updFn(g.id, { renovation_count: v })} /></td>}
                      {!isGroundUp && (
                        <td className="px-2 py-1">
                          <span className="block text-right text-sm tabular-nums font-medium">{eu > 0 ? fc(Math.round(proformaAnnual / eu / 12)) : "—"}</span>
                          <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(proformaAnnual)}/yr</p>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <p className="text-right text-sm tabular-nums font-medium">{fc(pfAnnual)}<span className="text-muted-foreground/60 text-[10px]">/yr</span></p>
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={g.notes || ""} onChange={e => upd(g.id, { notes: e.target.value } as Partial<UnitGroup>)}
                          placeholder="" className="w-full bg-transparent text-[10px] text-muted-foreground outline-none italic truncate max-w-[120px]" />
                      </td>
                    </>) : (<>
                      <td className="px-2 py-1"><CellText value={g.label} onChange={v => updFn(g.id, { label: v })} placeholder="e.g. Suite A" /></td>
                      <td className="px-2 py-1"><CellInput value={g.unit_count} onChange={v => updFn(g.id, { unit_count: v })} /></td>
                      {!isGroundUp && unitChangeCell}
                      <td className="px-2 py-1"><CellInput value={g.sf_per_unit} onChange={v => upd(g.id, { sf_per_unit: v })} /></td>
                      <td className="px-1 py-1">
                        <select value={g.lease_type} onChange={e => upd(g.id, { lease_type: e.target.value as LeaseType })} className="w-full bg-muted/80 text-sm outline-none text-center text-blue-300 rounded px-1 py-0.5 border border-border/50 cursor-pointer appearance-auto">
                          <option value="NNN" className="bg-background text-foreground">NNN</option>
                          <option value="MG" className="bg-background text-foreground">MG</option>
                          <option value="Gross" className="bg-background text-foreground">Gross</option>
                          <option value="Modified Gross" className="bg-background text-foreground">Mod G</option>
                        </select>
                      </td>
                      {!isGroundUp && (
                        <td className="px-2 py-1">
                          <CellInput value={g.current_rent_per_sf} onChange={v => upd(g.id, { current_rent_per_sf: v })} prefix="$" decimals={2} />
                          <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{g.current_rent_per_sf > 0 ? `$${(g.current_rent_per_sf / 12).toFixed(2)}/mo` : ""}</p>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <CellInput value={g.market_rent_per_sf} onChange={v => upd(g.id, { market_rent_per_sf: v })} prefix="$" decimals={2} />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{g.market_rent_per_sf > 0 ? `$${(g.market_rent_per_sf / 12).toFixed(2)}/mo` : ""}</p>
                      </td>
                      {!isGroundUp && <td className="px-2 py-1"><CellInput value={g.renovation_count || 0} onChange={v => updFn(g.id, { renovation_count: v })} /></td>}
                      {!isGroundUp && (
                        <td className="px-2 py-1">
                          <span className="block text-right text-sm tabular-nums font-medium">{eu > 0 && g.sf_per_unit > 0 ? `$${(proformaAnnual / eu / g.sf_per_unit).toFixed(2)}` : "—"}</span>
                          <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{eu > 0 && g.sf_per_unit > 0 ? `$${(proformaAnnual / eu / g.sf_per_unit / 12).toFixed(2)}/mo` : ""}</p>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <p className="text-right text-sm tabular-nums font-medium">{fc(pfAnnual)}<span className="text-muted-foreground/60 text-[10px]">/yr</span></p>
                      </td>
                      <td className="px-2 py-1 text-right text-sm tabular-nums text-muted-foreground">
                        {(() => {
                          const sf = effectiveUnits(g) * g.sf_per_unit;
                          if (sf <= 0 || g.lease_type === "Gross") return "—";
                          const share = m.totalSF > 0 ? sf / m.totalSF : 0;
                          const camPerSF = share * m.camPool / sf;
                          if (camPerSF <= 0) return "—";
                          return <><span>${camPerSF.toFixed(2)}</span><p className="text-[10px] text-muted-foreground/60 tabular-nums">${(camPerSF / 12).toFixed(2)}/mo</p></>;
                        })()}
                      </td>
                      <td className="px-1 py-1">
                        <input type="text" value={g.notes || ""} onChange={e => upd(g.id, { notes: e.target.value } as Partial<UnitGroup>)}
                          placeholder="" className="w-full bg-transparent text-[10px] text-muted-foreground outline-none italic truncate max-w-[120px]" />
                      </td>
                    </>)}
                    <td className="px-1 py-1">
                      <button onClick={() => del(g.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </SortableRow>
                  </React.Fragment>
                );
              })}
              {d.unit_groups.length === 0 && (
                <tr><td colSpan={isSH ? 10 : isMF ? 12 : 12} className="px-2 py-4 text-sm text-muted-foreground text-center">No units added yet</td></tr>
              )}
            </tbody>
            </SortableContext>
            </DndContext>
            <tfoot>
              <tr className="border-t bg-muted/20 font-medium">
                <td />
                <td className="px-2 py-1.5 text-xs">Total</td>
                <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fn(m.ipTotalUnits)}{m.totalUnits !== m.ipTotalUnits ? ` → ${fn(m.totalUnits)}` : ""}</td>
                <td />
                {isSH ? (<>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fn(m.totalBeds)}</td>
                  {!isGroundUp && <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.inPlaceGPR)}<span className="text-muted-foreground/60">/yr</span></td>}
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                  {!isGroundUp && <td />}
                  {!isGroundUp && <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold text-primary">{fc(m.proformaGPR)}<span className="text-muted-foreground/60">/yr</span></td>}
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold text-primary">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                </>) : isMF ? (<>
                  <td colSpan={3} />
                  {!isGroundUp && <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.inPlaceGPR)}<span className="text-muted-foreground/60">/yr</span></td>}
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                  {!isGroundUp && <td />}
                  {!isGroundUp && <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold text-primary">{fc(m.proformaGPR)}<span className="text-muted-foreground/60">/yr</span></td>}
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold text-primary">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                </>) : (<>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fn(m.totalSF)}</td>
                  <td />
                  {!isGroundUp && <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.inPlaceGPR)}<span className="text-muted-foreground/60">/yr</span></td>}
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                  {!isGroundUp && <td />}
                  {!isGroundUp && <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold text-primary">{fc(m.proformaGPR)}<span className="text-muted-foreground/60">/yr</span></td>}
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold text-primary">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                  <td />
                </>)}
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setData(p => ({ ...p, unit_groups: [...p.unit_groups, newGroup()] }))}>
              <Plus className="h-4 w-4 mr-2" /> Add Row
            </Button>
            {d.unit_groups.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={rentEstimating}
                className="border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                onClick={async () => {
                  setRentEstimating(true);
                  try {
                    // Post the CURRENT unit groups (post-scenario-override) so
                    // the AI estimates against what the analyst is actually
                    // seeing, not the stale base data in the DB.
                    const res = await fetch(`/api/deals/${params.id}/ai-rents`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ unit_groups: d.unit_groups }),
                    });
                    const json = await res.json();
                    if (!res.ok) { toast.error(json.error || "AI rent estimation failed"); return; }
                    const rents: Array<{ id?: string; market_rent_per_unit?: number; market_rent_per_bed?: number; market_rent_per_sf?: number; notes?: string }> = json.rents || [];
                    if (rents.length === 0) {
                      toast.error("AI returned no rents — check console for details");
                      console.warn("ai-rents empty response", json);
                      return;
                    }
                    // Route writes through the same scenario-aware plumbing
                    // as upd() so the values actually show up when an active
                    // scenario override is in use.
                    const applyToGroups = (groups: UnitGroup[]): UnitGroup[] => groups.map(g => {
                      const match = rents.find(r => r.id === g.id);
                      if (!match) return g;
                      return {
                        ...g,
                        ...(match.market_rent_per_unit != null ? { market_rent_per_unit: match.market_rent_per_unit } : {}),
                        ...(match.market_rent_per_bed != null ? { market_rent_per_bed: match.market_rent_per_bed } : {}),
                        ...(match.market_rent_per_sf != null ? { market_rent_per_sf: match.market_rent_per_sf } : {}),
                        notes: "AI generated",
                      };
                    });
                    setData(p => {
                      if (activeScenarioId) {
                        return {
                          ...p,
                          scenarios: (p.scenarios || []).map(s => {
                            if (s.id !== activeScenarioId) return s;
                            const base = s.overrides.unit_groups || p.unit_groups;
                            return { ...s, overrides: { ...s.overrides, unit_groups: applyToGroups(base) } };
                          }),
                        };
                      }
                      return { ...p, unit_groups: applyToGroups(p.unit_groups) };
                    });
                    const matchCount = rents.filter(r => d.unit_groups.some(g => g.id === r.id)).length;
                    toast.success(`AI estimated rents for ${matchCount}/${d.unit_groups.length} unit groups`);
                  } catch (err) {
                    console.error("ai-rents error", err);
                    toast.error("AI rent estimation failed");
                  } finally { setRentEstimating(false); }
                }}
              >
                {rentEstimating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AI Generate Rents
              </Button>
            )}
          </div>
          {/* Parking Revenue (other income items managed below in dedicated section) */}
          <div className="mt-4 border-t pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Parking Revenue</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
              <NumInput label="Reserved Spaces" value={d.parking_reserved_spaces} onChange={v => set("parking_reserved_spaces", v)} decimals={0} />
              <NumInput label="Reserved $/Space/Mo" value={d.parking_reserved_rate} onChange={v => set("parking_reserved_rate", v)} prefix="$" decimals={0} />
              <NumInput label="Unreserved Spaces" value={d.parking_unreserved_spaces} onChange={v => set("parking_unreserved_spaces", v)} decimals={0} />
              <NumInput label="Unreserved $/Space/Mo" value={d.parking_unreserved_rate} onChange={v => set("parking_unreserved_rate", v)} prefix="$" decimals={0} />
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Monthly: {fc((d.parking_reserved_spaces || 0) * (d.parking_reserved_rate || 0) + (d.parking_unreserved_spaces || 0) * (d.parking_unreserved_rate || 0))}</span>
              <span>Annual: <span className="text-foreground font-medium">{fc(m.otherIncomeParking)}</span></span>
              {(d.parking_reserved_spaces || 0) === 0 && (d.parking_unreserved_spaces || 0) === 0 && d.parking_monthly > 0 && (
                <span className="text-amber-400">(using legacy flat ${d.parking_monthly}/mo)</span>
              )}
            </div>
          </div>

          {/* ── Commercial Tenants ── */}
          <div className="mt-4 border-t pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Commercial Tenants</h4>
            {(d.commercial_tenants || []).length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse mb-2 min-w-[650px]">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Tenant</th>
                    <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[60px]">Use</th>
                    <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[65px]">SF</th>
                    <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[65px]">$/SF</th>
                    <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[55px]">Lease</th>
                    <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">TI</th>
                    <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">Esc%</th>
                    <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Annual</th>
                    <th className="w-[24px]" />
                  </tr>
                </thead>
                <tbody>
                  {(d.commercial_tenants || []).map((t: any, i: number) => {
                    const updCT = (upd: Record<string, any>) => setData(p => ({ ...p, commercial_tenants: (p.commercial_tenants || []).map((ct: any, j: number) => j === i ? { ...ct, ...upd } : ct) }));
                    return (
                      <tr key={t.id || i} className="border-b hover:bg-muted/10 group">
                        <td className="px-2 py-1.5"><input type="text" value={t.tenant_name || ""} onChange={e => updCT({ tenant_name: e.target.value })} placeholder="Tenant" className="w-full bg-transparent text-sm outline-none" /></td>
                        <td className="px-2 py-1.5"><select value={t.use_type || "retail"} onChange={e => updCT({ use_type: e.target.value })} className="bg-background text-foreground text-xs outline-none w-full rounded border border-border/40"><option value="retail">Retail</option><option value="office">Office</option><option value="restaurant">Rest.</option></select></td>
                        <td className="px-2 py-1.5"><CellInput value={t.sf || 0} onChange={v => updCT({ sf: v })} /></td>
                        <td className="px-2 py-1.5"><CellInput value={t.rent_per_sf || 0} onChange={v => updCT({ rent_per_sf: v })} prefix="$" decimals={2} /></td>
                        <td className="px-2 py-1.5"><select value={t.lease_type || "NNN"} onChange={e => updCT({ lease_type: e.target.value })} className="bg-background text-foreground text-xs outline-none w-full rounded border border-border/40"><option value="NNN">NNN</option><option value="MG">MG</option><option value="Gross">Gross</option></select></td>
                        <td className="px-2 py-1.5"><CellInput value={t.ti_allowance_per_sf || 0} onChange={v => updCT({ ti_allowance_per_sf: v })} prefix="$" /></td>
                        <td className="px-2 py-1.5"><CellInput value={t.rent_escalation_pct || 0} onChange={v => updCT({ rent_escalation_pct: v })} suffix="%" decimals={1} /></td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc((t.sf || 0) * (t.rent_per_sf || 0))}</td>
                        <td className="px-1"><button onClick={() => setData(p => ({ ...p, commercial_tenants: (p.commercial_tenants || []).filter((_: any, j: number) => j !== i) }))} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/20 font-semibold">
                    <td colSpan={7} className="px-2 py-1.5 text-right">Commercial GPR</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fc((d.commercial_tenants || []).reduce((s: number, t: any) => s + (t.sf || 0) * (t.rent_per_sf || 0), 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => setData(p => ({ ...p, commercial_tenants: [...(p.commercial_tenants || []), { id: uuidv4(), tenant_name: "", suite: "", use_type: "retail", sf: 0, rent_per_sf: 0, lease_type: "NNN", cam_reimbursement_pct: 100, ti_allowance_per_sf: 0, lc_pct: 6, free_rent_months: 0, rent_escalation_pct: 3, lease_start: "", lease_term_years: 10, notes: "" }] }))}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Tenant
            </Button>
            {/* Auto-populate retail tenant(s) from the active massing.
                Creates one placeholder row per retail NRSF bucket when no
                tenants exist, so the analyst starts with a reasonable
                structure already wired to the building's programming. */}
            {isGroundUp && d.building_program?.scenarios?.length > 0 && (() => {
              const bp = d.building_program;
              const activeS = bp.scenarios.find((s: any) => s.is_baseline) || bp.scenarios.find((s: any) => s.id === bp.active_scenario_id) || bp.scenarios[0];
              if (!activeS) return null;
              const landSF = d.site_info?.land_sf || ((deal as any)?.land_acres || 0) * 43560;
              const zi = { land_sf: landSF, far: d.far || 0, lot_coverage_pct: d.lot_coverage_pct || 0, height_limit_ft: (d.height_limit_stories || 0) * 10, height_limit_stories: d.height_limit_stories || 0 };
              const { computeMassingSummary: cms } = require("@/components/massing/massing-utils");
              const ms = cms(activeS, zi);
              const retailSf = ms.nrsf_by_use?.retail || 0;
              const officeSf = ms.nrsf_by_use?.office || 0;
              if (retailSf <= 0 && officeSf <= 0) return null;
              return (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() => {
                    setData(p => {
                      const existing = p.commercial_tenants || [];
                      const add: any[] = [];
                      if (retailSf > 0 && !existing.some((t: any) => (t.use_type || "retail") === "retail")) {
                        add.push({ id: uuidv4(), tenant_name: "Retail Tenant (TBD)", suite: "", use_type: "retail", sf: Math.round(retailSf), rent_per_sf: 30, lease_type: "NNN", cam_reimbursement_pct: 100, ti_allowance_per_sf: 75, lc_pct: 6, free_rent_months: 3, rent_escalation_pct: 3, lease_start: "", lease_term_years: 10, notes: `Pre-filled from ${activeS.name} — retail NRSF` });
                      }
                      if (officeSf > 0 && !existing.some((t: any) => t.use_type === "office")) {
                        add.push({ id: uuidv4(), tenant_name: "Office Tenant (TBD)", suite: "", use_type: "office", sf: Math.round(officeSf), rent_per_sf: 40, lease_type: "MG", cam_reimbursement_pct: 0, ti_allowance_per_sf: 60, lc_pct: 6, free_rent_months: 4, rent_escalation_pct: 3, lease_start: "", lease_term_years: 7, notes: `Pre-filled from ${activeS.name} — office NRSF` });
                      }
                      if (add.length === 0) {
                        toast.info("Tenants already cover retail/office from the massing.");
                        return p;
                      }
                      toast.success(`Added ${add.length} tenant placeholder${add.length === 1 ? "" : "s"} from massing`);
                      return { ...p, commercial_tenants: [...existing, ...add] };
                    });
                  }}
                  title="Create placeholder tenant rows sized to the massing's retail / office NRSF"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1 text-amber-400" />
                  From Massing ({fn(retailSf + officeSf)} SF)
                </Button>
              );
            })()}
          </div>

          {/* ── Other Income (dynamic line items) ── */}
          <div className="mt-4 border-t pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Other Income</h4>
            <table className="w-full text-sm border-collapse mb-2">
              <thead>
                <tr className="bg-muted/30 border-b">
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Source</th>
                  <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Basis</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">$/Mo</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Annual</th>
                  <th className="w-[24px]" />
                </tr>
              </thead>
              <tbody>
                {(d.other_income_items || []).map((item: any, i: number) => {
                  const updOI = (upd: Record<string, any>) => setData(p => ({ ...p, other_income_items: (p.other_income_items || []).map((oi: any, j: number) => j === i ? { ...oi, ...upd } : oi) }));
                  const mult = item.basis === "per_unit" ? m.totalUnits : item.basis === "per_space" ? (d.parking_reserved_spaces || 0) : 1;
                  return (
                    <tr key={item.id || i} className="border-b hover:bg-muted/10 group">
                      <td className="px-2 py-1.5"><input type="text" value={item.label} onChange={e => updOI({ label: e.target.value })} className="w-full bg-transparent text-sm outline-none" /></td>
                      <td className="px-2 py-1.5"><select value={item.basis} onChange={e => updOI({ basis: e.target.value })} className="w-full bg-background text-foreground text-xs outline-none rounded border border-border/40"><option value="per_unit">Per Unit ({m.totalUnits})</option><option value="per_property">Per Property</option><option value="per_space">Per Space</option></select></td>
                      <td className="px-2 py-1.5"><CellInput value={item.amount || 0} onChange={v => updOI({ amount: v })} prefix="$" /></td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc((item.amount || 0) * mult * 12)}</td>
                      <td className="px-1"><button onClick={() => setData(p => ({ ...p, other_income_items: (p.other_income_items || []).filter((_: any, j: number) => j !== i) }))} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
              {(d.other_income_items || []).length > 0 && (
                <tfoot>
                  <tr className="border-t bg-muted/20 font-semibold">
                    <td colSpan={3} className="px-2 py-1.5 text-right">Total Other Income</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fc((d.other_income_items || []).reduce((s: number, item: any) => { const mult = item.basis === "per_unit" ? m.totalUnits : item.basis === "per_space" ? (d.parking_reserved_spaces || 0) : 1; return s + (item.amount || 0) * mult * 12; }, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
            <Button variant="ghost" size="sm" onClick={() => setData(p => ({ ...p, other_income_items: [...(p.other_income_items || []), { id: uuidv4(), label: "", amount: 0, basis: "per_unit", unit_type_filter: "", notes: "" }] }))}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Income Item
            </Button>
            {/* Auto-populate a Parking Income row from the massing's
                estimated parking-space count (computed from parking SF /
                SF-per-space). Default $125/month/space — analyst tunes
                per market. Skips if a Parking row already exists. */}
            {isGroundUp && d.building_program?.scenarios?.length > 0 && (() => {
              const bp = d.building_program;
              const activeS = bp.scenarios.find((s: any) => s.is_baseline) || bp.scenarios.find((s: any) => s.id === bp.active_scenario_id) || bp.scenarios[0];
              if (!activeS) return null;
              const landSF = d.site_info?.land_sf || ((deal as any)?.land_acres || 0) * 43560;
              const zi = { land_sf: landSF, far: d.far || 0, lot_coverage_pct: d.lot_coverage_pct || 0, height_limit_ft: (d.height_limit_stories || 0) * 10, height_limit_stories: d.height_limit_stories || 0 };
              const { computeMassingSummary: cms } = require("@/components/massing/massing-utils");
              const ms = cms(activeS, zi);
              const spaces = ms.total_parking_spaces_est || 0;
              if (spaces <= 0) return null;
              return (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() => {
                    setData(p => {
                      const existing = p.other_income_items || [];
                      if (existing.some((it: any) => /parking/i.test(it.label || ""))) {
                        toast.info("Parking income already in the list.");
                        return p;
                      }
                      // Mirror the massing's space count into the top-
                      // level parking field so the per-space multiplier
                      // picks it up when rendering the Annual column.
                      const nextParkingSpaces = spaces;
                      toast.success(`Added Parking Income · ${spaces} spaces @ $125/mo`);
                      return {
                        ...p,
                        parking_reserved_spaces: Math.max(nextParkingSpaces, p.parking_reserved_spaces || 0),
                        other_income_items: [
                          ...existing,
                          { id: uuidv4(), label: "Parking Income", amount: 125, basis: "per_space", unit_type_filter: "", notes: `From ${activeS.name} — ${spaces} est. spaces` },
                        ],
                      };
                    });
                  }}
                  title="Pre-fill a parking-income line item sized to the massing's estimated parking space count"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1 text-amber-400" />
                  From Massing ({fn(spaces)} spaces)
                </Button>
              );
            })()}
          </div>
        </div>
      </Section>

      {/* ═══ Affordability (multifamily / student housing) ═══ */}
      {isMF && (
        <AffordabilityPlanner
          dealId={params.id}
          totalUnits={m.totalUnits || 0}
          avgMarketRent={(() => {
            // Weighted average market rent per unit/month across unit groups.
            // IMPORTANT: exclude is_affordable rows — after a split those
            // carry the AMI-capped rent in market_rent_per_unit and would
            // drag the average down, causing the planner's "revenue
            // impact" preview to understate how much market rent is
            // being traded away.
            const marketRows = d.unit_groups.filter(
              (g) => !(g as { is_affordable?: boolean }).is_affordable
            );
            const totalUnits = marketRows.reduce((s, g) => s + effectiveUnits(g), 0);
            if (totalUnits === 0) return 0;
            if (isSH) {
              // student housing: rent is per-bed monthly; convert to per-unit
              const totalRentPerMonth = marketRows.reduce((s, g) => s + effectiveUnits(g) * g.beds_per_unit * g.market_rent_per_bed, 0);
              return totalRentPerMonth / totalUnits;
            }
            // multifamily / mixed-use residential
            const totalRentPerMonth = marketRows.reduce((s, g) => s + effectiveUnits(g) * (g.market_rent_per_unit || 0), 0);
            return totalRentPerMonth / totalUnits;
          })()}
          currentTaxes={d.taxes_annual || 0}
          initialConfig={d.affordability_config}
          buildingUnitMix={(() => {
            // Bucket the building's unit groups into BR-type counts so the
            // planner's match-building solver and AI optimizer know what's
            // typical for this deal. Exclude any affordable rows (added by
            // the programming-page split) so we're reasoning about the
            // market-rate template, not a post-split mix that would feed
            // back into itself.
            const mix = { studio: 0, one_br: 0, two_br: 0, three_br: 0, four_br_plus: 0 };
            for (const g of d.unit_groups) {
              if ((g as { is_affordable?: boolean }).is_affordable) continue;
              const count = effectiveUnits(g);
              if (!count) continue;
              const bd = g.bedrooms || 0;
              if (bd === 0) mix.studio += count;
              else if (bd === 1) mix.one_br += count;
              else if (bd === 2) mix.two_br += count;
              else if (bd === 3) mix.three_br += count;
              else mix.four_br_plus += count;
            }
            return mix;
          })()}
          mode="mix"
          onConfigChange={(cfg) => set("affordability_config", cfg as UWData["affordability_config"])}
          onPushToUnitMix={() => {
            // Run the shared split against the current unit_groups + the
            // live affordability config, then write the result back. Market
            // rows shrink, each (tier × BR bucket) becomes its own affordable
            // row the analyst can then size independently (affordable units
            // are typically smaller SF than market).
            setData((prev) => {
              const cfg = prev.affordability_config;
              if (!cfg?.enabled || !cfg.tiers?.length) {
                toast.error("Enable an affordability tier first");
                return prev;
              }
              const split = splitUnitGroupsByAffordability(
                prev.unit_groups,
                cfg as unknown as Parameters<typeof splitUnitGroupsByAffordability>[1]
              );
              const affCount = (split as unknown as Array<{ is_affordable?: boolean }>).filter(
                (g) => g.is_affordable
              ).length;
              const origAff = (prev.unit_groups as unknown as Array<{ is_affordable?: boolean }>).filter(
                (g) => g.is_affordable
              ).length;
              toast.success(
                origAff > 0
                  ? `Re-split unit mix: ${affCount} affordable row${affCount === 1 ? "" : "s"}`
                  : `Added ${affCount} affordable row${affCount === 1 ? "" : "s"} to the unit mix`
              );
              return { ...prev, unit_groups: split as typeof prev.unit_groups };
            });
          }}
        />
      )}

      <Section title={isGroundUp ? "Development Budget" : "Capital Expenditures"} icon={<Hammer className="h-4 w-4 text-orange-400" />}>
        <div className="mt-3 overflow-x-auto">
          {isGroundUp ? (
            <>
              {/* Seed button if no itemized budget yet */}
              {d.dev_budget_items.length === 0 && (
                <div className="flex items-center gap-3 mb-3">
                  <Button variant="outline" size="sm" onClick={() => setData(p => ({ ...p, dev_budget_items: seedDevBudget(p) }))}>
                    <Plus className="h-4 w-4 mr-2" /> Seed Itemized Budget
                  </Button>
                  <p className="text-xs text-muted-foreground">Or continue using simple Hard Cost/SF + Soft Cost % below</p>
                </div>
              )}

              {d.dev_budget_items.length > 0 ? (
                <>
                  {/* ── Hard Costs ── */}
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-2">Hard Costs</h4>
                  <table className="w-full text-sm border-collapse mb-3">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Line Item</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Qty / %</th>
                        <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Unit</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">$ / Unit</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Total</th>
                        <th className="w-[28px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {d.dev_budget_items.filter(i => i.category === "hard").map(item => {
                        const updBI = (upd: Partial<DevBudgetLineItem>) => {
                          setData(p => ({
                            ...p,
                            dev_budget_items: p.dev_budget_items.map(bi =>
                              bi.id === item.id ? { ...bi, ...upd, amount: upd.is_pct ?? item.is_pct ? bi.amount : ((upd.quantity ?? item.quantity) * (upd.unit_cost ?? item.unit_cost)) } : bi
                            ),
                          }));
                        };
                        const resolvedAmt = item.is_pct
                          ? m.totalHardCosts * (item.pct_value / 100)
                          : item.quantity * item.unit_cost;
                        return (
                          <tr key={item.id} className="border-b hover:bg-muted/10 group">
                            <td className="px-2 py-1.5">
                              <input type="text" value={item.label} onChange={e => updBI({ label: e.target.value })} className="w-full bg-transparent text-sm outline-none" />
                            </td>
                            <td className="px-2 py-1.5">
                              {item.is_pct
                                ? <CellInput value={item.pct_value} onChange={v => updBI({ pct_value: v, amount: m.totalHardCosts * v / 100 })} suffix="%" decimals={1} />
                                : <CellInput value={item.quantity} onChange={v => updBI({ quantity: v })} />
                              }
                            </td>
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">{item.unit_label}</td>
                            <td className="px-2 py-1.5">
                              {item.is_pct ? <span className="text-muted-foreground text-xs">—</span> : <CellInput value={item.unit_cost} onChange={v => updBI({ unit_cost: v })} prefix="$" />}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(resolvedAmt)}</td>
                            <td className="px-1 py-1.5">
                              <button onClick={() => setData(p => ({ ...p, dev_budget_items: p.dev_budget_items.filter(bi => bi.id !== item.id) }))} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20 font-semibold">
                        <td colSpan={4} className="px-2 py-2 text-right">Total Hard Costs</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fc(m.totalHardCosts)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                  <Button variant="ghost" size="sm" className="mb-4" onClick={() => setData(p => ({ ...p, dev_budget_items: [...p.dev_budget_items, newDevBudgetItem("New Hard Cost", "hard", "custom", "lump sum")] }))}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Hard Cost
                  </Button>

                  {/* ── Soft Costs ── */}
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Soft Costs</h4>
                  <table className="w-full text-sm border-collapse mb-3">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Line Item</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Qty / %</th>
                        <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Unit</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">$ / Unit</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Total</th>
                        <th className="w-[28px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {d.dev_budget_items.filter(i => i.category === "soft").map(item => {
                        const updBI = (upd: Partial<DevBudgetLineItem>) => {
                          setData(p => ({
                            ...p,
                            dev_budget_items: p.dev_budget_items.map(bi =>
                              bi.id === item.id ? { ...bi, ...upd, amount: upd.is_pct ?? item.is_pct ? bi.amount : ((upd.quantity ?? item.quantity) * (upd.unit_cost ?? item.unit_cost)) } : bi
                            ),
                          }));
                        };
                        const resolvedAmt = item.is_pct
                          ? m.totalHardCosts * (item.pct_value / 100)
                          : (item.subcategory === "interest_carry" ? m.capitalizedInterest : item.quantity * item.unit_cost);
                        return (
                          <tr key={item.id} className="border-b hover:bg-muted/10 group">
                            <td className="px-2 py-1.5">
                              <input type="text" value={item.label} onChange={e => updBI({ label: e.target.value })} className="w-full bg-transparent text-sm outline-none" />
                              {item.subcategory === "interest_carry" && <span className="text-[10px] text-primary">auto-computed from construction loan</span>}
                            </td>
                            <td className="px-2 py-1.5">
                              {item.is_pct
                                ? <CellInput value={item.pct_value} onChange={v => updBI({ pct_value: v, amount: m.totalHardCosts * v / 100 })} suffix="%" decimals={1} />
                                : item.subcategory === "interest_carry"
                                  ? <span className="text-xs text-muted-foreground">auto</span>
                                  : <CellInput value={item.quantity || item.amount} onChange={v => updBI({ quantity: 1, unit_cost: v, amount: v })} />
                              }
                            </td>
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">{item.unit_label}</td>
                            <td className="px-2 py-1.5">
                              {item.is_pct || item.subcategory === "interest_carry" ? <span className="text-muted-foreground text-xs">—</span> : <CellInput value={item.unit_cost} onChange={v => updBI({ unit_cost: v })} prefix="$" />}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(resolvedAmt)}</td>
                            <td className="px-1 py-1.5">
                              <button onClick={() => setData(p => ({ ...p, dev_budget_items: p.dev_budget_items.filter(bi => bi.id !== item.id) }))} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20 font-semibold">
                        <td colSpan={4} className="px-2 py-2 text-right">Total Soft Costs</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fc(m.softCostsTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                  <Button variant="ghost" size="sm" className="mb-4" onClick={() => setData(p => ({ ...p, dev_budget_items: [...p.dev_budget_items, newDevBudgetItem("New Soft Cost", "soft", "custom", "lump sum")] }))}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Soft Cost
                  </Button>

                  {/* ── Project Total Summary ── */}
                  <div className="border rounded-md bg-muted/10 p-3 mt-2">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr><td className="py-1">Land Acquisition</td><td className="text-right tabular-nums">{fc(d.land_cost)}</td></tr>
                        <tr><td className="py-1">Total Hard Costs</td><td className="text-right tabular-nums">{fc(m.totalHardCosts)}</td></tr>
                        <tr><td className="py-1">Total Soft Costs</td><td className="text-right tabular-nums">{fc(m.softCostsTotal)}</td></tr>
                        {m.totalParkingCost > 0 && <tr><td className="py-1">Parking Structure</td><td className="text-right tabular-nums">{fc(m.totalParkingCost)}</td></tr>}
                        {m.capitalizedInterest > 0 && <tr><td className="py-1">Capitalized Interest</td><td className="text-right tabular-nums">{fc(m.capitalizedInterest)}</td></tr>}
                        {m.demolitionCosts > 0 && <tr><td className="py-1">Demolition / Abatement</td><td className="text-right tabular-nums">{fc(m.demolitionCosts)}</td></tr>}
                        <tr><td className="py-1">Closing Costs</td><td className="text-right tabular-nums">{fc(m.closingCosts)}</td></tr>
                        <tr className="border-t font-semibold text-base">
                          <td className="pt-2">Total Project Cost</td>
                          <td className="text-right tabular-nums pt-2">{fc(m.totalCost)}</td>
                        </tr>
                        {m.totalUnits > 0 && (
                          <tr className="text-muted-foreground text-xs">
                            <td className="py-0.5">Per Unit</td>
                            <td className="text-right tabular-nums">{fc(m.totalCost / m.totalUnits)}</td>
                          </tr>
                        )}
                        {(d.max_nrsf || d.max_gsf) > 0 && (
                          <tr className="text-muted-foreground text-xs">
                            <td className="py-0.5">Per SF (NRSF)</td>
                            <td className="text-right tabular-nums">{fc(m.totalCost / (d.max_nrsf || d.max_gsf))}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  {/* Legacy simple budget: hard_cost_per_sf + soft_cost_pct */}
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Description</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Qty</th>
                        <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Units</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">$ / Unit</th>
                        <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-muted/10">
                        <td className="px-2 py-1.5 font-medium">Hard Costs</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fn(d.max_gsf || 0)}</td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">GSF</td>
                        <td className="px-2 py-1.5"><CellInput value={d.hard_cost_per_sf} onChange={v => set("hard_cost_per_sf", v)} prefix="$" decimals={2} /></td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(m.totalHardCosts)}</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/10">
                        <td className="px-2 py-1.5 font-medium">Soft Costs</td>
                        <td className="px-2 py-1.5"><CellInput value={d.soft_cost_pct} onChange={v => set("soft_cost_pct", v)} decimals={1} /></td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">% of Hard</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(m.softCostsTotal)}</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20 font-semibold">
                        <td colSpan={4} className="px-2 py-2 text-right">Total Hard + Soft Costs</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fc(m.totalHardCosts + m.softCostsTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={estimateCapex} disabled={capexEstimating}>
                    {capexEstimating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    AI Dev Budget
                  </Button>
                </div>
                {!d.max_gsf && <p className="text-xs text-amber-500">Set GSF in Site &amp; Zoning to enable budget calculations</p>}
              </div>
            </>
          ) : (
            <>
          {d.capex_items.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              No CapEx items. Click + to add or check &quot;Renovate&quot; on unit types.
            </p>
          )}
          {d.capex_items.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b">
                  <th className="w-[28px]" />
                  <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[30px]">#</th>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Description</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Qty</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Cost / Unit</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Total</th>
                  <th className="w-[32px]" />
                </tr>
              </thead>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorderCapex}>
              <SortableContext items={d.capex_items.map(c => c.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {d.capex_items.map((c, i) => {
                  const isLinked = !!c.linked_unit_group_id;
                  const updCapex = (updates: Partial<CapexItem>) => {
                    updC(c.id, updates);
                    if (isLinked) {
                      setData(prev => ({
                        ...prev,
                        unit_groups: prev.unit_groups.map(g =>
                          g.id === c.linked_unit_group_id
                            ? { ...g, ...(updates.cost_per_unit !== undefined ? { renovation_cost_per_unit: updates.cost_per_unit } : {}) }
                            : g
                        ),
                      }));
                    }
                  };
                  return (
                    <SortableRow key={c.id} id={c.id}>
                      <td className="px-1 py-1.5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={c.label} onChange={e => updCapex({ label: e.target.value })}
                          placeholder="e.g. Roof, HVAC" className="w-full bg-transparent text-sm outline-none"
                          readOnly={isLinked} />
                        {isLinked && <span className="text-[10px] text-primary">linked to unit type</span>}
                      </td>
                      <td className="px-2 py-1.5"><CellInput value={c.quantity} onChange={v => updCapex({ quantity: v })} /></td>
                      <td className="px-2 py-1.5"><CellInput value={c.cost_per_unit} onChange={v => updCapex({ cost_per_unit: v })} prefix="$" /></td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(c.quantity * c.cost_per_unit)}</td>
                      <td className="px-1 py-1.5">
                        {!isLinked && (
                          <button onClick={() => delC(c.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </td>
                    </SortableRow>
                  );
                })}
              </tbody>
              </SortableContext>
              </DndContext>
              <tfoot>
                <tr className="border-t bg-muted/20 font-semibold">
                  <td colSpan={5} className="px-2 py-2 text-right">Total CapEx</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fc(m.capexTotal)}
                    <p className="text-[10px] text-muted-foreground/60 font-normal tabular-nums">
                      {isSH ? (m.capexPerBed > 0 ? `${fc(m.capexPerBed)}/bed` : "") : isMF ? (m.capexPerUnit > 0 ? `${fc(m.capexPerUnit)}/unit` : "") : m.capexPerSF > 0 ? `$${m.capexPerSF.toFixed(2)}/SF` : ""}
                    </p>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setData(p => ({ ...p, capex_items: [...p.capex_items, newCapex()] }))}>
                <Plus className="h-4 w-4 mr-2" /> Add Item
              </Button>
              <Button variant="outline" size="sm" onClick={estimateCapex} disabled={capexEstimating}>
                {capexEstimating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AI Estimate
              </Button>
            </div>
          </div>
            </>
          )}
        </div>
      </Section>

      {/* ═══════════════════ PARKING CONFIGURATION ═══════════════════ */}
      {(isGroundUp || d.parking?.entries?.length) && (
      <Section title="Parking Configuration" icon={<Car className="h-4 w-4 text-cyan-400" />}>
        <div className="mt-3">
          {(() => {
            const pk = d.parking || defaultParkingConfig();
            const totalSpaces = pk.entries.reduce((s, e) => s + e.spaces, 0);
            const totalPkCost = pk.entries.reduce((s, e) => s + e.spaces * e.cost_per_space, 0);
            const totalPkRevenue = pk.entries.reduce((s, e) => s + (e.reserved_residential_spaces * e.reserved_monthly_rate + e.unreserved_spaces * e.unreserved_monthly_rate + e.retail_shared_spaces * e.retail_shared_monthly_rate), 0) * 12;
            const requiredResSpaces = pk.zoning_required_ratio_residential * m.totalUnits;
            const isMixedUse = deal?.property_type === "mixed_use";
            const retailSF = isMixedUse ? (d.mixed_use?.components || []).filter(c => c.component_type === "retail").reduce((s, c) => s + c.sf_allocation, 0) : 0;
            const requiredComSpaces = pk.zoning_required_ratio_commercial * (retailSF / 1000);
            const requiredTotal = requiredResSpaces + requiredComSpaces;
            const underParked = totalSpaces > 0 && requiredTotal > 0 && totalSpaces < requiredTotal;

            const setPk = (fn: (prev: ParkingConfig) => ParkingConfig) => setData(p => ({ ...p, parking: fn(p.parking || defaultParkingConfig()) }));
            const updEntry = (id: string, upd: Partial<ParkingEntry>) => setPk(prev => ({ ...prev, entries: prev.entries.map(e => e.id === id ? { ...e, ...upd } : e) }));

            return (
              <>
                {/* Zoning ratios */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <NumInput label="Zoning Req: Spaces / Unit" value={pk.zoning_required_ratio_residential} onChange={v => setPk(p => ({ ...p, zoning_required_ratio_residential: v }))} decimals={2} />
                  <NumInput label="Zoning Req: Spaces / 1,000 SF Retail" value={pk.zoning_required_ratio_commercial} onChange={v => setPk(p => ({ ...p, zoning_required_ratio_commercial: v }))} decimals={2} />
                </div>

                {/* Parking entries table */}
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Parking Inventory & Cost</h4>
                <table className="w-full text-sm border-collapse mb-3">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Type</th>
                      <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Spaces</th>
                      <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Cost / Space</th>
                      <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Total Cost</th>
                      <th className="w-[28px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {pk.entries.map(entry => (
                      <tr key={entry.id} className="border-b hover:bg-muted/10 group">
                        <td className="px-2 py-1.5">
                          <select value={entry.type} onChange={e => { const t = e.target.value as ParkingType; updEntry(entry.id, { type: t, cost_per_space: PARKING_COST_DEFAULTS[t] }); }} className="bg-background text-foreground text-sm outline-none rounded border border-border/40">
                            {(Object.keys(PARKING_TYPE_LABELS) as ParkingType[]).map(t => <option key={t} value={t}>{PARKING_TYPE_LABELS[t]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5"><CellInput value={entry.spaces} onChange={v => updEntry(entry.id, { spaces: v })} /></td>
                        <td className="px-2 py-1.5"><CellInput value={entry.cost_per_space} onChange={v => updEntry(entry.id, { cost_per_space: v })} prefix="$" /></td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(entry.spaces * entry.cost_per_space)}</td>
                        <td className="px-1 py-1.5">
                          <button onClick={() => setPk(p => ({ ...p, entries: p.entries.filter(e => e.id !== entry.id) }))} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                    {pk.entries.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground text-sm">No parking entries. Add one below.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/20 font-semibold">
                      <td className="px-2 py-2">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fn(totalSpaces)}</td>
                      <td />
                      <td className="px-2 py-2 text-right tabular-nums">{fc(totalPkCost)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                <Button variant="ghost" size="sm" className="mb-4" onClick={() => setPk(p => ({ ...p, entries: [...p.entries, newParkingEntry()] }))}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Parking Type
                </Button>

                {/* Parking ratios */}
                {totalSpaces > 0 && m.totalUnits > 0 && (
                  <div className={`rounded-md p-3 text-sm ${underParked ? "bg-red-500/10 border border-red-500/30" : "bg-muted/10 border"}`}>
                    <div className="flex justify-between">
                      <span>Actual Ratio</span>
                      <span className="tabular-nums font-medium">{(totalSpaces / m.totalUnits).toFixed(2)} spaces/unit</span>
                    </div>
                    {requiredTotal > 0 && (
                      <div className="flex justify-between mt-1">
                        <span>Zoning Required</span>
                        <span className="tabular-nums font-medium">{fn(Math.ceil(requiredTotal))} spaces</span>
                      </div>
                    )}
                    {underParked && <p className="text-red-400 text-xs mt-2 font-medium">Warning: {fn(Math.ceil(requiredTotal - totalSpaces))} spaces short of zoning requirement</p>}
                  </div>
                )}

                {/* Parking Revenue */}
                {pk.entries.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Parking Revenue</h4>
                    <table className="w-full text-sm border-collapse mb-2">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Type</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Reserved</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">$/mo</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Unreserved</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">$/mo</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Retail</th>
                          <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">$/mo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pk.entries.map(entry => (
                          <tr key={entry.id} className="border-b hover:bg-muted/10">
                            <td className="px-2 py-1.5 text-muted-foreground">{PARKING_TYPE_LABELS[entry.type]}</td>
                            <td className="px-2 py-1.5"><CellInput value={entry.reserved_residential_spaces} onChange={v => updEntry(entry.id, { reserved_residential_spaces: v })} /></td>
                            <td className="px-2 py-1.5"><CellInput value={entry.reserved_monthly_rate} onChange={v => updEntry(entry.id, { reserved_monthly_rate: v })} prefix="$" /></td>
                            <td className="px-2 py-1.5"><CellInput value={entry.unreserved_spaces} onChange={v => updEntry(entry.id, { unreserved_spaces: v })} /></td>
                            <td className="px-2 py-1.5"><CellInput value={entry.unreserved_monthly_rate} onChange={v => updEntry(entry.id, { unreserved_monthly_rate: v })} prefix="$" /></td>
                            <td className="px-2 py-1.5"><CellInput value={entry.retail_shared_spaces} onChange={v => updEntry(entry.id, { retail_shared_spaces: v })} /></td>
                            <td className="px-2 py-1.5"><CellInput value={entry.retail_shared_monthly_rate} onChange={v => updEntry(entry.id, { retail_shared_monthly_rate: v })} prefix="$" /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/20 font-semibold">
                          <td colSpan={6} className="px-2 py-2 text-right">Annual Parking Revenue</td>
                          <td className="px-2 py-2 text-right tabular-nums">{fc(totalPkRevenue)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </>
                )}

                {/* ── Shared Parking / Peak Offset Analysis ── */}
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Shared Parking Strategy</h4>
                <label className="flex items-center gap-2 text-sm mb-3">
                  <input type="checkbox" checked={pk.shared_parking_enabled} onChange={e => setPk(p => ({ ...p, shared_parking_enabled: e.target.checked }))} className="accent-primary" />
                  Enable Shared Parking / Peak Offset Analysis
                </label>
                {pk.shared_parking_enabled && (() => {
                  // Compute peak demand across time periods — the minimum total across all periods = shared parking target
                  const resDemand = pk.spaces_needed_residential || (pk.zoning_required_ratio_residential * m.totalUnits);
                  const offDemand = pk.spaces_needed_office;
                  const retDemand = pk.spaces_needed_retail;
                  const nonSharedTotal = resDemand + offDemand + retDemand;

                  const weekdayPeak = (resDemand * pk.peak_demand_residential_weekday_pct / 100)
                    + (offDemand * pk.peak_demand_office_weekday_pct / 100)
                    + (retDemand * pk.peak_demand_retail_weekday_pct / 100);
                  const eveningPeak = (resDemand * pk.peak_demand_residential_evening_pct / 100)
                    + (offDemand * pk.peak_demand_office_evening_pct / 100)
                    + (retDemand * pk.peak_demand_retail_evening_pct / 100);
                  const weekendPeak = (resDemand * pk.peak_demand_residential_weekend_pct / 100)
                    + (offDemand * pk.peak_demand_office_weekend_pct / 100)
                    + (retDemand * pk.peak_demand_retail_weekend_pct / 100);
                  const maxPeak = Math.max(weekdayPeak, eveningPeak, weekendPeak);
                  const computedReduction = nonSharedTotal > 0 ? ((nonSharedTotal - maxPeak) / nonSharedTotal) * 100 : 0;
                  const effectiveReduction = pk.shared_parking_reduction_pct > 0 ? pk.shared_parking_reduction_pct : computedReduction;
                  const sharedTotal = Math.ceil(nonSharedTotal * (1 - effectiveReduction / 100));
                  const spacesSaved = Math.floor(nonSharedTotal - sharedTotal);
                  const costSaved = spacesSaved * (pk.entries.length > 0 ? pk.entries.reduce((s, e) => s + e.cost_per_space * e.spaces, 0) / Math.max(totalSpaces, 1) : 35000);

                  return (
                    <>
                      <p className="text-xs text-muted-foreground mb-3">
                        Shared parking leverages peak-hour offsets between uses — office peaks weekday daytime, residential peaks evenings/weekends.
                        A parking study can justify 20-40% fewer total spaces vs. separate ratios per use.
                      </p>

                      {/* Parking study info */}
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Parking Study Firm</label>
                          <input type="text" value={pk.shared_parking_study_firm} onChange={e => setPk(p => ({ ...p, shared_parking_study_firm: e.target.value }))} placeholder="e.g. Walker Consultants" className="w-full border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={pk.shared_parking_study_completed} onChange={e => setPk(p => ({ ...p, shared_parking_study_completed: e.target.checked }))} className="accent-primary" />
                            Study Completed
                          </label>
                          {pk.shared_parking_study_completed && (
                            <input type="date" value={pk.shared_parking_study_date || ""} onChange={e => setPk(p => ({ ...p, shared_parking_study_date: e.target.value || null }))} className="border rounded-md px-2 py-1.5 text-sm bg-background outline-none" />
                          )}
                        </div>
                      </div>

                      {/* Spaces needed by use */}
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <NumInput label="Spaces Needed — Residential" value={pk.spaces_needed_residential || Math.ceil(resDemand)} onChange={v => setPk(p => ({ ...p, spaces_needed_residential: v }))} />
                        <NumInput label="Spaces Needed — Office" value={pk.spaces_needed_office} onChange={v => setPk(p => ({ ...p, spaces_needed_office: v }))} />
                        <NumInput label="Spaces Needed — Retail" value={pk.spaces_needed_retail} onChange={v => setPk(p => ({ ...p, spaces_needed_retail: v }))} />
                      </div>

                      {/* Peak demand matrix */}
                      <table className="w-full text-sm border-collapse mb-4">
                        <thead>
                          <tr className="bg-muted/30 border-b">
                            <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground">Use</th>
                            <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[90px]">Spaces</th>
                            <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Weekday Day</th>
                            <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Evening</th>
                            <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Weekend</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b hover:bg-muted/10">
                            <td className="px-2 py-1.5 font-medium">
                              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2" />Residential
                            </td>
                            <td className="px-2 py-1.5 text-center tabular-nums">{fn(Math.ceil(resDemand))}</td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_residential_weekday_pct} onChange={v => setPk(p => ({ ...p, peak_demand_residential_weekday_pct: v }))} suffix="%" decimals={0} /></td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_residential_evening_pct} onChange={v => setPk(p => ({ ...p, peak_demand_residential_evening_pct: v }))} suffix="%" decimals={0} /></td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_residential_weekend_pct} onChange={v => setPk(p => ({ ...p, peak_demand_residential_weekend_pct: v }))} suffix="%" decimals={0} /></td>
                          </tr>
                          <tr className="border-b hover:bg-muted/10">
                            <td className="px-2 py-1.5 font-medium">
                              <span className="inline-block w-2 h-2 rounded-full bg-purple-500 mr-2" />Office
                            </td>
                            <td className="px-2 py-1.5 text-center tabular-nums">{fn(offDemand)}</td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_office_weekday_pct} onChange={v => setPk(p => ({ ...p, peak_demand_office_weekday_pct: v }))} suffix="%" decimals={0} /></td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_office_evening_pct} onChange={v => setPk(p => ({ ...p, peak_demand_office_evening_pct: v }))} suffix="%" decimals={0} /></td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_office_weekend_pct} onChange={v => setPk(p => ({ ...p, peak_demand_office_weekend_pct: v }))} suffix="%" decimals={0} /></td>
                          </tr>
                          <tr className="border-b hover:bg-muted/10">
                            <td className="px-2 py-1.5 font-medium">
                              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2" />Retail
                            </td>
                            <td className="px-2 py-1.5 text-center tabular-nums">{fn(retDemand)}</td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_retail_weekday_pct} onChange={v => setPk(p => ({ ...p, peak_demand_retail_weekday_pct: v }))} suffix="%" decimals={0} /></td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_retail_evening_pct} onChange={v => setPk(p => ({ ...p, peak_demand_retail_evening_pct: v }))} suffix="%" decimals={0} /></td>
                            <td className="px-2 py-1.5"><CellInput value={pk.peak_demand_retail_weekend_pct} onChange={v => setPk(p => ({ ...p, peak_demand_retail_weekend_pct: v }))} suffix="%" decimals={0} /></td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr className="border-t bg-muted/20">
                            <td className="px-2 py-1.5 font-semibold">Peak Demand</td>
                            <td className="px-2 py-1.5 text-center tabular-nums font-semibold">{fn(Math.ceil(nonSharedTotal))}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums font-medium">{fn(Math.ceil(weekdayPeak))}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums font-medium">{fn(Math.ceil(eveningPeak))}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums font-medium">{fn(Math.ceil(weekendPeak))}</td>
                          </tr>
                        </tfoot>
                      </table>

                      {/* Reduction override */}
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <NumInput label="Shared Parking Reduction (override or auto)" value={pk.shared_parking_reduction_pct || Math.round(computedReduction * 10) / 10} onChange={v => setPk(p => ({ ...p, shared_parking_reduction_pct: v }))} suffix="%" decimals={1} />
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Auto-Computed Reduction</label>
                          <p className="text-sm font-semibold py-1.5 text-primary">{computedReduction.toFixed(1)}%</p>
                        </div>
                      </div>

                      {/* Results summary */}
                      <div className={`rounded-md p-3 text-sm space-y-1.5 ${spacesSaved > 0 ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-muted/10 border"}`}>
                        <div className="flex justify-between"><span>Non-Shared Total (all uses at full ratio)</span><span className="font-semibold tabular-nums">{fn(Math.ceil(nonSharedTotal))} spaces</span></div>
                        <div className="flex justify-between"><span>Peak Period</span><span className="font-semibold tabular-nums">{weekdayPeak >= eveningPeak && weekdayPeak >= weekendPeak ? "Weekday Day" : eveningPeak >= weekendPeak ? "Evening" : "Weekend"} — {fn(Math.ceil(maxPeak))} spaces</span></div>
                        <div className="flex justify-between"><span>Shared Parking Target</span><span className="font-semibold tabular-nums text-emerald-400">{fn(sharedTotal)} spaces ({effectiveReduction.toFixed(1)}% reduction)</span></div>
                        <div className="flex justify-between"><span>Spaces Saved</span><span className="font-semibold tabular-nums text-emerald-400">{fn(spacesSaved)} spaces</span></div>
                        <div className="flex justify-between"><span>Estimated Cost Savings</span><span className="font-semibold tabular-nums text-emerald-400">{fc(costSaved)}</span></div>
                        {!pk.shared_parking_study_completed && (
                          <p className="text-xs text-amber-400 mt-2 font-medium">Note: Cities typically require a formal parking study by a traffic engineer to approve shared parking reductions. Budget $15K-$50K for the study.</p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </>
            );
          })()}
        </div>
      </Section>
      )}

      <Section title="Operating Assumptions" icon={<Calculator className="h-4 w-4 text-blue-400" />}>
        <div className="mt-3 overflow-x-auto">
          {/* Vacancy row */}
          <div className={`grid ${isGroundUp ? "grid-cols-2" : "grid-cols-3"} gap-4 mb-4`}>
            {!isGroundUp && <NumInput label="In-Place Vacancy" value={d.in_place_vacancy_rate} onChange={v => set("in_place_vacancy_rate", v)} suffix="%" decimals={1} />}
            <NumInput label={isGroundUp ? "Stabilized Vacancy" : "Pro Forma Vacancy"} value={d.vacancy_rate} onChange={v => set("vacancy_rate", v)} suffix="%" decimals={1} />
            <NumInput label="Management Fee" value={d.management_fee_pct} onChange={v => set("management_fee_pct", v)} suffix="% EGI" decimals={1} />
          </div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[180px]">Category</th>
                {!isMF && !isSH && <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]" title="Common Area Maintenance — checked items are reimbursed by NNN/MG tenants">CAM</th>}
                {!isGroundUp && <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[130px]">In-Place (Annual)</th>}
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[130px]">{isGroundUp ? "Stabilized (Annual)" : "Pro Forma (Annual)"}</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">$/Unit</th>
              </tr>
            </thead>
            <tbody>
              {/* Management row — in-place is hard $ amount, pro forma is % of EGI */}
              <tr className="border-b hover:bg-muted/20">
                <td className="px-2 py-1.5 text-muted-foreground">Management <span className="text-xs text-muted-foreground/60">({d.management_fee_pct}% PF)</span></td>
                {!isMF && !isSH && (
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={d.cam_management} onChange={e => set("cam_management", e.target.checked)} className="rounded h-3.5 w-3.5 accent-blue-500" />
                  </td>
                )}
                {!isGroundUp && (
                  <td className="px-2 py-1.5">
                    <CellInput value={d.ip_mgmt_annual} onChange={v => set("ip_mgmt_annual", v)} prefix="$" />
                  </td>
                )}
                <td className="px-2 py-1.5"><span className="block text-right text-sm tabular-nums">{fc(m.mgmtFee)}</span></td>
                <td className="px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground">{m.totalUnits > 0 ? fc(Math.round(m.mgmtFee / m.totalUnits)) : "—"}</td>
              </tr>
              {/* Affordability tax exemption notice */}
              {d.affordability_config?.tax_exemption_enabled && d.affordability_config?.tax_exemption_pct > 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-1.5">
                    <div className="flex items-center gap-2 text-[10px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-1">
                      <span>Tax Exemption Active: {d.affordability_config.tax_exemption_pct}% reduction ({d.affordability_config.tax_exemption_type || "affordable housing"}) for {d.affordability_config.tax_exemption_years || "?"} years. Adjust Property Taxes below accordingly.</span>
                    </div>
                  </td>
                </tr>
              )}
              {/* Editable expense rows */}
              {([
                { label: "Property Taxes", ipKey: "ip_taxes_annual" as keyof UWData, pfKey: "taxes_annual" as keyof UWData, camKey: "cam_taxes" as keyof UWData },
                { label: "Insurance", ipKey: "ip_insurance_annual" as keyof UWData, pfKey: "insurance_annual" as keyof UWData, camKey: "cam_insurance" as keyof UWData },
                { label: "Repairs & Maintenance", ipKey: "ip_repairs_annual" as keyof UWData, pfKey: "repairs_annual" as keyof UWData, camKey: "cam_repairs" as keyof UWData },
                { label: "Utilities", ipKey: "ip_utilities_annual" as keyof UWData, pfKey: "utilities_annual" as keyof UWData, camKey: "cam_utilities" as keyof UWData },
                { label: "General & Admin", ipKey: "ip_ga_annual" as keyof UWData, pfKey: "ga_annual" as keyof UWData, camKey: "cam_ga" as keyof UWData },
                { label: "Marketing / Leasing", ipKey: "ip_marketing_annual" as keyof UWData, pfKey: "marketing_annual" as keyof UWData, camKey: "cam_marketing" as keyof UWData },
                { label: "Reserves", ipKey: "ip_reserves_annual" as keyof UWData, pfKey: "reserves_annual" as keyof UWData, camKey: "cam_reserves" as keyof UWData },
                { label: "Other", ipKey: "ip_other_annual" as keyof UWData, pfKey: "other_expenses_annual" as keyof UWData, camKey: "cam_other" as keyof UWData },
              ]).map(row => {
                const ipVal = (d[row.ipKey] as number) || 0;
                const pfVal = (d[row.pfKey] as number) || 0;
                const perUnit = m.totalUnits > 0 ? pfVal / m.totalUnits : 0;
                const isCam = d[row.camKey] as boolean;
                const ipIsDefault = ipVal === 0;
                return (
                  <tr key={row.label} className="border-b hover:bg-muted/20">
                    <td className="px-2 py-1.5 text-muted-foreground">{row.label}</td>
                    {!isMF && !isSH && (
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={isCam} onChange={e => set(row.camKey as keyof UWData, e.target.checked)} className="rounded h-3.5 w-3.5 accent-blue-500" />
                      </td>
                    )}
                    {!isGroundUp && (
                      <td className="px-2 py-1.5">
                        <CellInput value={ipVal} onChange={v => set(row.ipKey as keyof UWData, v)} prefix="$" placeholder={pfVal > 0 ? `${Math.round(pfVal).toLocaleString()}` : undefined} />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <CellInput value={pfVal} onChange={v => set(row.pfKey as keyof UWData, v)} prefix="$" />
                    </td>
                    <td className="px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground">{perUnit > 0 ? fc(Math.round(perUnit)) : "—"}</td>
                  </tr>
                );
              })}
              {/* Custom user-defined OpEx rows */}
              {(d.custom_opex || []).map(row => {
                const perUnit = m.totalUnits > 0 ? (row.pf_annual || 0) / m.totalUnits : 0;
                const updateRow = (patch: Partial<CustomOpexRow>) => set(
                  "custom_opex",
                  (d.custom_opex || []).map(r => r.id === row.id ? { ...r, ...patch } : r)
                );
                const removeRow = () => set(
                  "custom_opex",
                  (d.custom_opex || []).filter(r => r.id !== row.id)
                );
                return (
                  <tr key={row.id} className="border-b hover:bg-muted/20 group">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <input
                          value={row.label}
                          onChange={e => updateRow({ label: e.target.value })}
                          placeholder="Category"
                          className="bg-transparent border-b border-transparent focus:border-muted-foreground/40 outline-none text-sm text-muted-foreground w-full"
                        />
                        <button
                          onClick={removeRow}
                          className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-red-400 px-1"
                          title="Remove row"
                        >
                          ×
                        </button>
                      </div>
                    </td>
                    {!isMF && !isSH && (
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={row.cam} onChange={e => updateRow({ cam: e.target.checked })} className="rounded h-3.5 w-3.5 accent-blue-500" />
                      </td>
                    )}
                    {!isGroundUp && (
                      <td className="px-2 py-1.5">
                        <CellInput value={row.ip_annual || 0} onChange={v => updateRow({ ip_annual: v })} prefix="$" placeholder={row.pf_annual > 0 ? `${Math.round(row.pf_annual).toLocaleString()}` : undefined} />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <CellInput value={row.pf_annual || 0} onChange={v => updateRow({ pf_annual: v })} prefix="$" />
                    </td>
                    <td className="px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground">{perUnit > 0 ? fc(Math.round(perUnit)) : "—"}</td>
                  </tr>
                );
              })}
              {/* Add Row button */}
              <tr>
                <td colSpan={3 + (!isMF && !isSH ? 1 : 0) + (!isGroundUp ? 1 : 0)} className="px-2 py-1.5">
                  <button
                    onClick={() => set("custom_opex", [
                      ...(d.custom_opex || []),
                      { id: uuidv4(), label: "", ip_annual: 0, pf_annual: 0, cam: false },
                    ])}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Row
                  </button>
                </td>
              </tr>
              <tr className="border-t-2 font-semibold">
                <td className="px-2 py-2">Total Operating Expenses</td>
                {!isMF && !isSH && <td />}
                {!isGroundUp && <td className="px-2 py-2 text-right tabular-nums">{fc(m.inPlaceTotalOpEx)}</td>}
                <td className="px-2 py-2 text-right tabular-nums">{fc(m.totalOpEx)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{m.totalUnits > 0 ? fc(Math.round(m.totalOpEx / m.totalUnits)) : "—"}</td>
              </tr>
              {/* OpEx Ratio (% of EGI per column) */}
              <tr className="border-b">
                <td className="px-2 py-1.5 text-xs text-muted-foreground">OpEx Ratio</td>
                {!isMF && !isSH && <td />}
                {!isGroundUp && (
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                    {m.inPlaceEGI > 0 ? `${((m.inPlaceTotalOpEx / m.inPlaceEGI) * 100).toFixed(0)}% of EGI` : "—"}
                  </td>
                )}
                <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                  {m.proformaEGI > 0 ? `${((m.proformaTotalOpEx / m.proformaEGI) * 100).toFixed(0)}% of EGI` : "—"}
                </td>
                <td />
              </tr>
              {!isMF && !isSH && m.camPool > 0 && (
                <tr className="bg-blue-500/5">
                  <td className="px-2 py-2 text-blue-400 text-xs font-medium" colSpan={2}>CAM Reimbursable Pool</td>
                  {!isGroundUp && <td className="px-2 py-2 text-right tabular-nums text-blue-400">{fc(m.ipCamPool)}</td>}
                  <td className="px-2 py-2 text-right tabular-nums text-blue-400">{fc(m.camPool)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex items-center gap-4 mt-3">
            <div className="p-3 bg-muted/50 rounded-lg flex-1"><p className="text-xs text-muted-foreground mb-1">EGI</p><p className="text-sm font-semibold">{fc(m.egi)}</p><p className="text-xs text-muted-foreground">{fc(m.vacancyLoss)} vacancy loss</p></div>
            {(isMF || isSH) && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  // Industry-standard MF OpEx split = 30% of EGI excluding
                  // management (~5%), giving a combined ~35% load.
                  // Applied directly to the pro-forma column; in-place
                  // figures are separately sourced from T12 and untouched.
                  // If EGI is zero (revenue not yet entered), no-op with a
                  // toast so the user understands why nothing changed.
                  const egi = m.proformaEGI;
                  if (egi <= 0) {
                    toast.error("Enter pro forma revenue first — EGI is needed to split the 30% load.");
                    return;
                  }
                  const pcts: Array<[keyof UWData, number]> = [
                    ["taxes_annual", 0.08],
                    ["insurance_annual", 0.03],
                    ["repairs_annual", 0.06],
                    ["utilities_annual", 0.04],
                    ["ga_annual", 0.03],
                    ["marketing_annual", 0.01],
                    ["reserves_annual", 0.05],
                  ];
                  setData(p => {
                    const patch: Partial<UWData> = {};
                    for (const [k, pct] of pcts) {
                      (patch as any)[k] = Math.round(egi * pct);
                    }
                    // Writes to the active scenario overrides if one is
                    // active, otherwise to the base data (mirrors how set()
                    // routes writes).
                    if (activeScenarioId) {
                      return {
                        ...p,
                        scenarios: (p.scenarios || []).map(s =>
                          s.id === activeScenarioId
                            ? { ...s, overrides: { ...s.overrides, ...patch } }
                            : s
                        ),
                      };
                    }
                    return { ...p, ...patch };
                  });
                  toast.success("Applied MF default OpEx (30% of EGI, ~35% with mgmt)");
                }}
                title="Fill in Pro Forma OpEx at industry-standard multifamily ratios (30% of EGI + ~5% mgmt = 35% total load)"
              >
                MF Default (35%)
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={estimateOpex} disabled={opexEstimating} className="shrink-0">
              {opexEstimating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              AI Estimate
            </Button>
          </div>
          {/* AI OpEx Narrative (persistent) */}
          {d.opex_narrative && (
            <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <p className="text-xs font-medium text-primary mb-1">AI Estimate Basis</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{d.opex_narrative}</p>
            </div>
          )}
          {/* Leasing Commissions — commercial only */}
          {!isMF && !isSH && (
            <div className="mt-4 border-t pt-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Leasing Commissions</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <NumInput label="New Lease Commission" value={d.lc_new_pct} onChange={v => set("lc_new_pct", v)} suffix="%" decimals={1} />
                <NumInput label="Renewal Commission" value={d.lc_renewal_pct} onChange={v => set("lc_renewal_pct", v)} suffix="%" decimals={1} />
                <NumInput label="Assumed Renewal %" value={d.lc_renewal_prob} onChange={v => set("lc_renewal_prob", v)} suffix="%" decimals={0} />
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Annual LC Cost</p>
                  <p className="text-sm font-semibold">{fc(m.leasingCommissions)}</p>
                  <p className="text-xs text-muted-foreground">{m.proformaEGI > 0 ? ((m.leasingCommissions / m.proformaEGI) * 100).toFixed(1) : 0}% of EGI</p>
                </div>
              </div>
            </div>
          )}

          {/* Per-component OpEx allocation (formerly on the Mixed-Use
              Section). Shows "shared % of building OpEx" per product type
              so the analyst can model e.g. residential carrying 70% and
              retail carrying 30%. Only the % is surfaced here — the
              shared/own toggle stays on the data model for future use. */}
          {d.mixed_use?.enabled && (d.mixed_use?.components?.length ?? 0) > 0 && (
            <div className="mt-4 border-t pt-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Per-Component OpEx Allocation
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(d.mixed_use?.components || []).map((comp) => {
                  const updComp = (upd: Partial<MixedUseComponent>) =>
                    setData(p => ({
                      ...p,
                      mixed_use: {
                        ...(p.mixed_use || defaultMixedUseConfig()),
                        components: (p.mixed_use?.components || []).map(c =>
                          c.id === comp.id ? { ...c, ...upd } : c
                        ),
                      },
                    }));
                  return (
                    <div key={comp.id} className="space-y-1">
                      <NumInput
                        label={`${comp.label} OpEx Share`}
                        value={comp.opex_allocation_pct}
                        onChange={v => updComp({ opex_allocation_pct: v })}
                        suffix="%"
                        decimals={1}
                      />
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`opex-mode-${comp.id}`}
                            checked={comp.opex_mode === "shared"}
                            onChange={() => updComp({ opex_mode: "shared" })}
                            className="accent-primary"
                          />
                          Shared
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`opex-mode-${comp.id}`}
                            checked={comp.opex_mode === "own"}
                            onChange={() => updComp({ opex_mode: "own" })}
                            className="accent-primary"
                          />
                          Own OpEx
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                Shared = component carries a % of the building-wide OpEx above.
                Own OpEx = component tracks its own expenses (model separately).
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* ═══════════════════ ABSORPTION / LEASE-UP ═══════════════════
          Shown for ground-up (residential absorption) OR any deal with
          commercial components that need per-component leasing terms
          (TI / LC / free rent / escalation). */}
      {/* Absorption / Lease-Up — Advanced. Drives the timing of NOI
          ramp on ground-up / heavy-renovation deals; not needed for a
          back-of-envelope IRR estimate. Hidden in Basic, and only
          shown when the deal type requires it (ground-up or mixed-use
          with retail/office components). */}
      {!isBasic && (isGroundUp || (d.mixed_use?.enabled && (d.mixed_use?.components || []).some(
        c => c.component_type === "retail" || c.component_type === "office"
      ))) && (
      <Section title="Absorption / Lease-Up" icon={<ArrowDownUp className="h-4 w-4 text-green-400" />}>
        <div className="mt-3">
          {isGroundUp && (() => {
            const lu = d.lease_up || defaultLeaseUp();
            const setLU = (upd: Partial<LeaseUpConfig>) => setData(p => ({ ...p, lease_up: { ...(p.lease_up || defaultLeaseUp()), ...upd } }));
            const monthsToStab = lu.absorption_units_per_month > 0 ? Math.ceil((m.totalUnits * (lu.stabilization_occupancy_pct / 100)) / lu.absorption_units_per_month) : 0;
            const totalConcessions = lu.concession_free_months > 0
              ? m.totalUnits * lu.concession_free_months * (m.gpr / m.totalUnits / 12 || 0)
              : m.totalUnits * lu.concession_per_unit;
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                  <NumInput label="Construction Period (months)" value={lu.construction_months} onChange={v => setLU({ construction_months: v })} />
                  <NumInput label="Absorption (units/month)" value={lu.absorption_units_per_month} onChange={v => setLU({ absorption_units_per_month: v })} />
                  <NumInput label="Stabilization Target" value={lu.stabilization_occupancy_pct} onChange={v => setLU({ stabilization_occupancy_pct: v })} suffix="%" decimals={1} />
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <NumInput label="Concession (free months)" value={lu.concession_free_months} onChange={v => setLU({ concession_free_months: v, concession_per_unit: 0 })} decimals={1} />
                  <NumInput label="Or: Concession $/unit" value={lu.concession_per_unit} onChange={v => setLU({ concession_per_unit: v, concession_free_months: 0 })} prefix="$" />
                </div>
                {/* Summary */}
                <div className="border rounded-md bg-muted/10 p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span>Months to Stabilization</span><span className="font-semibold tabular-nums">{monthsToStab} months</span></div>
                  <div className="flex justify-between"><span>Total Timeline (construction + lease-up)</span><span className="font-semibold tabular-nums">{lu.construction_months + monthsToStab} months</span></div>
                  <div className="flex justify-between"><span>Est. Total Concessions</span><span className="font-semibold tabular-nums text-amber-400">{fc(totalConcessions)}</span></div>
                  {/* Simple lease-up progress bar */}
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Construction</span><span>Lease-Up</span><span>Stabilized</span>
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted/30">
                      <div className="bg-orange-500/60" style={{ width: `${lu.construction_months / (lu.construction_months + monthsToStab + 3) * 100}%` }} />
                      <div className="bg-blue-500/60" style={{ width: `${monthsToStab / (lu.construction_months + monthsToStab + 3) * 100}%` }} />
                      <div className="bg-emerald-500/60 flex-1" />
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* Per-component leasing terms (formerly on the Mixed-Use
              Section). Only retail/office get TI / LC / free rent /
              escalation — residential uses the Absorption block above. */}
          {d.mixed_use?.enabled && (d.mixed_use?.components || []).some(
            c => c.component_type === "retail" || c.component_type === "office"
          ) && (
            <div className="mt-4 border-t pt-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Per-Component Leasing Terms (Retail / Office)
              </div>
              <div className="space-y-3">
                {(d.mixed_use?.components || [])
                  .filter(c => c.component_type === "retail" || c.component_type === "office")
                  .map((comp) => {
                    const updComp = (upd: Partial<MixedUseComponent>) =>
                      setData(p => ({
                        ...p,
                        mixed_use: {
                          ...(p.mixed_use || defaultMixedUseConfig()),
                          components: (p.mixed_use?.components || []).map(c =>
                            c.id === comp.id ? { ...c, ...upd } : c
                          ),
                        },
                      }));
                    return (
                      <div key={comp.id} className="border rounded-md p-3 bg-muted/5">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              comp.component_type === "retail" ? "bg-amber-500" : "bg-purple-500"
                            }`}
                          />
                          <span className="text-sm font-medium">{comp.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            ({fn(comp.sf_allocation)} SF)
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <NumInput
                            label="TI Allowance ($/SF)"
                            value={comp.ti_allowance_per_sf}
                            onChange={v => updComp({ ti_allowance_per_sf: v })}
                            prefix="$"
                            decimals={2}
                          />
                          <NumInput
                            label="Leasing Commission"
                            value={comp.leasing_commission_pct}
                            onChange={v => updComp({ leasing_commission_pct: v })}
                            suffix="%"
                            decimals={1}
                          />
                          <NumInput
                            label="Free Rent (months)"
                            value={comp.free_rent_months}
                            onChange={v => updComp({ free_rent_months: v })}
                            decimals={1}
                          />
                          <NumInput
                            label="Rent Escalation"
                            value={comp.rent_escalation_pct}
                            onChange={v => updComp({ rent_escalation_pct: v })}
                            suffix="%"
                            decimals={1}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </Section>
      )}

      {/* ═══════════════════ CONSTRUCTION FINANCING ═══════════════════
          Hidden in Basic — analysts running back-of-envelope numbers
          can use the simpler Acquisition Financing block below; the
          construction loan modeling is for dialed-in ground-up UWs. */}
      {!isBasic && isGroundUp && (
      <Section title="Construction Financing" icon={<Construction className="h-4 w-4 text-yellow-400" />}>
        <div className="mt-3">
          {(() => {
            const cl = d.construction_loan || defaultConstructionLoan();
            const setCL = (upd: Partial<ConstructionLoanConfig>) => setData(p => ({ ...p, construction_loan: { ...(p.construction_loan || defaultConstructionLoan()), ...upd } }));
            const loanAmt = m.totalCost * (cl.ltc_pct / 100);
            const monthlyRate = cl.rate / 100 / 12;
            const avgInterest = loanAmt * 0.5 * monthlyRate * cl.term_months;
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <NumInput label="Loan-to-Cost (LTC)" value={cl.ltc_pct} onChange={v => setCL({ ltc_pct: v })} suffix="%" decimals={1} />
                  <NumInput label="Interest Rate" value={cl.rate} onChange={v => setCL({ rate: v })} suffix="%" decimals={2} />
                  <NumInput label="Term (months)" value={cl.term_months} onChange={v => setCL({ term_months: v })} />
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Loan Amount</label>
                    <p className="text-sm font-semibold py-1.5">{fc(loanAmt)}</p>
                  </div>
                </div>
                <div className="border rounded-md bg-muted/10 p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span>Estimated Capitalized Interest (avg 50% draw)</span><span className="font-semibold tabular-nums">{fc(avgInterest)}</span></div>
                  <div className="flex justify-between"><span>Computed Cap. Interest (from calc)</span><span className="font-semibold tabular-nums text-primary">{fc(m.capitalizedInterest)}</span></div>
                  <p className="text-xs text-muted-foreground mt-1">Interest carry is auto-included in the Development Budget soft costs and total project cost.</p>
                </div>
              </>
            );
          })()}
        </div>
      </Section>
      )}

      <Section title="Financing" icon={<TrendingUp className="h-4 w-4 text-purple-400" />}>
        <div className="mt-3 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold">
                <input type="checkbox" checked={d.has_financing} onChange={e => set("has_financing", e.target.checked)} className="rounded" />
                Acquisition Loan
              </label>
              <Button variant="outline" size="sm" onClick={estimateLoan} disabled={loanSizing}>
                {loanSizing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                AI Loan Sizer
              </Button>
            </div>
            {d.has_financing && (<>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <NumInput label="Purchase Price LTV" value={d.acq_pp_ltv} onChange={v => set("acq_pp_ltv", v)} suffix="%" decimals={1} />
                <NumInput label="CapEx LTV" value={d.acq_capex_ltv} onChange={v => set("acq_capex_ltv", v)} suffix="%" decimals={1} />
                <NumInput label="Interest Rate" value={d.acq_interest_rate} onChange={v => set("acq_interest_rate", v)} suffix="%" decimals={3} />
                <div className="p-3 bg-primary/5 rounded-lg border border-primary/15">
                  <p className="text-xs text-muted-foreground mb-1">Blended LTC</p>
                  <p className="text-sm font-semibold text-primary">{m.blendedLtc > 0 ? `${m.blendedLtc.toFixed(1)}%` : "—"}</p>
                </div>
                <NumInput label="Amortization" value={d.acq_amort_years} onChange={v => set("acq_amort_years", v)} suffix="yrs" />
                <NumInput label="Interest-Only Period" value={d.acq_io_years} onChange={v => set("acq_io_years", v)} suffix="yrs" />
                <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Loan Amount</p><p className="text-sm font-semibold">{fc(m.acqLoan)}</p></div>
                <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Annual Debt Service</p><p className="text-sm font-semibold">{fc(m.acqDebt)}</p></div>
                <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Equity Required</p><p className="text-sm font-semibold">{fc(m.equity)}</p></div>
                <div className={`p-3 rounded-lg ${m.dscr >= 1.25 ? "bg-green-500/10 border border-green-500/20" : m.dscr > 0 ? "bg-yellow-500/10 border border-yellow-500/20" : "bg-muted/50"}`}>
                  <p className="text-xs text-muted-foreground mb-1">DSCR</p>
                  <p className={`text-sm font-semibold ${m.dscr >= 1.25 ? "text-green-400" : m.dscr > 0 ? "text-yellow-400" : ""}`}>{m.dscr > 0 ? `${m.dscr.toFixed(2)}x` : "—"}</p>
                  <p className="text-xs text-muted-foreground">{m.dscr >= 1.25 ? "✓ Good" : m.dscr > 0 ? "⚠ Low" : ""}</p>
                </div>
              </div>
              {d.acq_loan_narrative && (
                <div className="mt-3 bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">Guidance</span>
                    <span className="text-[10px] text-muted-foreground/60">— AI suggestion</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{d.acq_loan_narrative}</p>
                </div>
              )}
            </>)}
          </div>
          {d.has_financing && (
            <div className="border-t pt-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold mb-3">
                <input type="checkbox" checked={d.has_refi} onChange={e => set("has_refi", e.target.checked)} className="rounded" />
                Refinance
              </label>
              {d.has_refi && (<>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <NumInput label="Refi in Year" value={d.refi_year} onChange={v => set("refi_year", v)} suffix="yr" />
                  <NumInput label="Refi LTV" value={d.refi_ltv} onChange={v => set("refi_ltv", v)} suffix="%" decimals={1} />
                  <NumInput label="Refi Rate" value={d.refi_rate} onChange={v => set("refi_rate", v)} suffix="%" decimals={3} />
                  <NumInput label="Refi Amortization" value={d.refi_amort_years} onChange={v => set("refi_amort_years", v)} suffix="yrs" />
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Refi Proceeds</p>
                    <p className={`text-sm font-semibold ${m.refiProceeds < 0 ? "text-red-400" : "text-green-400"}`}>{fc(m.refiProceeds)}</p>
                    <p className="text-xs text-muted-foreground">{m.refiProceeds < 0 ? "⚠ Shortfall" : "Cash out"}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">New Annual Debt</p><p className="text-sm font-semibold">{fc(m.refiDebt)}</p></div>
                </div>
                {d.refi_loan_narrative && (
                  <div className="mt-3 bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles className="h-3 w-3 text-amber-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">Guidance</span>
                      <span className="text-[10px] text-muted-foreground/60">— AI suggestion</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{d.refi_loan_narrative}</p>
                  </div>
                )}
              </>)}
            </div>
          )}
        </div>
      </Section>

      <Section title="Exit Analysis" icon={<RefreshCw className="h-4 w-4 text-teal-600" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
          <NumInput label="Exit Cap Rate" value={d.exit_cap_rate} onChange={v => set("exit_cap_rate", v)} suffix="%" decimals={2} />
          <NumInput label="Hold Period" value={d.hold_period_years} onChange={v => set("hold_period_years", v)} suffix="yrs" />
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Exit Value</p>
            <p className="text-sm font-semibold">{fc(m.exitValue)}</p>
            {m.exitValue > 0 && (
              <p className="text-[10px] text-muted-foreground/60 tabular-nums">
                {isSH ? (m.exitPricePerBed > 0 ? `${fc(m.exitPricePerBed)}/bed` : "") : isMF ? (m.exitPricePerUnit > 0 ? `${fc(m.exitPricePerUnit)}/unit` : "") : m.exitPricePerSF > 0 ? `${fc(m.exitPricePerSF)}/SF` : ""}
              </p>
            )}
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Equity at Exit</p>
            <p className="text-sm font-semibold">{fc(m.exitEquity)}</p>
          </div>
        </div>

        {/* Per-component cap rates (formerly on the Mixed-Use Section). The
            primary "Exit Cap Rate" above still drives the single-property
            valuation; per-component rates let analysts track different
            yields by use type for their own memos / waterfalls. */}
        {d.mixed_use?.enabled && (d.mixed_use?.components?.length ?? 0) > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              Per-Component Cap Rates
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(d.mixed_use?.components || []).map((comp) => {
                const updComp = (upd: Partial<MixedUseComponent>) =>
                  setData(p => ({
                    ...p,
                    mixed_use: {
                      ...(p.mixed_use || defaultMixedUseConfig()),
                      components: (p.mixed_use?.components || []).map(c =>
                        c.id === comp.id ? { ...c, ...upd } : c
                      ),
                    },
                  }));
                return (
                  <NumInput
                    key={comp.id}
                    label={`${comp.label} Cap Rate`}
                    value={comp.cap_rate}
                    onChange={v => updComp({ cap_rate: v })}
                    suffix="%"
                    decimals={2}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Section>

      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between gap-4">
          <h3 className="font-semibold text-sm">Discounted Cash Flow</h3>
          <div className="flex items-center gap-3">
            <NumInput label="Rent Growth" value={d.rent_growth_pct} onChange={v => set("rent_growth_pct", v)} suffix="%" decimals={1} className="w-28" />
            <NumInput label="Expense Growth" value={d.expense_growth_pct} onChange={v => set("expense_growth_pct", v)} suffix="%" decimals={1} className="w-28" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide">Line Item</th>
                <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide w-24">{isGroundUp ? "Stabilized" : "In-Place"}</th>
                {[1,2,3,4,5].map(yr => (
                  <th key={yr} className="text-right px-4 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide w-24">Year {yr}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <DCFRow label="Gross Potential Rent" yr0={isGroundUp ? m.proformaGPR : m.inPlaceGPR} yr1to5={m.yearlyDCF.map(y => y.gpr)} />
              <DCFRow label="Less Vacancy" yr0={isGroundUp ? -m.proformaVacancyLoss : -m.inPlaceVacancyLoss} yr1to5={m.yearlyDCF.map(y => -y.vacancyLoss)} muted />
              {m.reimbursements > 0 && <DCFRow label="CAM Reimbursements" yr0={isGroundUp ? m.reimbursements : m.ipReimbursements} yr1to5={m.yearlyDCF.map(y => y.reimbursements)} muted />}
              {m.totalOtherIncome > 0 && <DCFRow label="Other Income" yr0={isGroundUp ? m.totalOtherIncome : 0} yr1to5={m.yearlyDCF.map(y => y.otherIncome)} muted />}
              <DCFRow label="Effective Gross Income" yr0={isGroundUp ? m.proformaEffectiveRevenue : m.inPlaceEffectiveRevenue} yr1to5={m.yearlyDCF.map(y => y.egi + y.reimbursements + y.otherIncome)} bold />
              <tr><td colSpan={7} className="px-4"><div className="border-t" /></td></tr>
              <DCFRow label="Total Operating Expenses" yr0={isGroundUp ? -m.proformaTotalOpEx : -m.inPlaceTotalOpEx} yr1to5={m.yearlyDCF.map(y => -y.totalOpEx)} />
              {m.leasingCommissions > 0 && <DCFRow label="Leasing Commissions" yr0={isGroundUp ? -m.leasingCommissions : -m.ipLeasingCommissions} yr1to5={m.yearlyDCF.map(y => -y.leasingCommissions)} muted />}
              <tr><td colSpan={7} className="px-4"><div className="border-t" /></td></tr>
              <DCFRow label="Net Operating Income" yr0={isGroundUp ? m.proformaNOI : m.inPlaceNOI} yr1to5={m.yearlyDCF.map(y => y.noi)} bold hi />
              {d.has_financing && <>
                <tr className="hover:bg-muted/20">
                  <td className="px-4 py-1.5 text-muted-foreground">Annual Debt Service</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                    <span>{m.inPlaceDCF.debtService > 0 ? `(${fc(m.inPlaceDCF.debtService)})` : "—"}</span>
                    {m.inPlaceDCF.debtLabel !== "—" && <span className="block text-[10px] text-muted-foreground/60">{m.inPlaceDCF.debtLabel}</span>}
                  </td>
                  {m.yearlyDCF.map((y, i) => (
                    <td key={i} className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                      <span>{y.debtService > 0 ? `(${fc(y.debtService)})` : "—"}</span>
                      {y.debtLabel !== "—" && <span className="block text-[10px] text-muted-foreground/60">{y.debtLabel}</span>}
                    </td>
                  ))}
                </tr>
                {d.has_refi && m.yearlyDCF.some(y => y.refiProceeds !== 0) && (
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-1.5 text-muted-foreground italic">Refinance Proceeds</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">—</td>
                    {m.yearlyDCF.map((y, i) => (
                      <td key={i} className={`px-4 py-1.5 text-right tabular-nums ${y.refiProceeds > 0 ? "text-green-400 font-medium" : ""}`}>
                        {y.refiProceeds !== 0 ? fc(y.refiProceeds) : "—"}
                      </td>
                    ))}
                  </tr>
                )}
                <tr><td colSpan={7} className="px-4"><div className="border-t" /></td></tr>
                <DCFRow label="Cash Flow Before Tax" yr0={isGroundUp ? m.cashFlow : m.inPlaceCashFlow} yr1to5={m.yearlyDCF.map(y => y.cashFlow)} bold hi={m.cashFlow > 0} />
                <DCFRow label="Cash-on-Cash Return" yr0={isGroundUp ? m.coc : m.inPlaceCoC} yr1to5={m.yearlyDCF.map(y => y.coc)} isPct />
              </>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Deal Score Progression ── */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Deal Score</h3>
          <Button
            size="sm" variant="outline"
            disabled={scoringUW}
            onClick={async () => {
              setScoringUW(true);
              try {
                await save();
                const res = await fetch(`/api/deals/${params.id}/deal-score`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ stage: "underwriting" }),
                });
                const json = await res.json();
                if (res.ok && json.data) {
                  setDealScores(prev => ({ ...prev, uw_score: json.data.score, uw_score_reasoning: json.data.reasoning }));
                  toast.success("Underwriting score updated");
                } else { toast.error(json.error || "Scoring failed"); }
              } catch { toast.error("Scoring failed"); }
              finally { setScoringUW(false); }
            }}
          >
            {scoringUW ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Scoring...</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{dealScores.uw_score ? "Re-score" : "Score Deal"}</>}
          </Button>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "OM Analysis", score: dealScores.om_score, reasoning: dealScores.om_reasoning, empty: "Run OM Analysis first" },
              { label: "Post-Underwriting", score: dealScores.uw_score, reasoning: dealScores.uw_score_reasoning, empty: "Score after completing underwriting" },
            ].map(({ label, score, reasoning, empty }) => {
              const accent = score ? score >= 8 ? "border-l-emerald-500" : score >= 6 ? "border-l-amber-500" : score >= 4 ? "border-l-orange-500" : "border-l-rose-500" : "border-l-muted-foreground/20";
              const numColor = score ? score >= 8 ? "text-emerald-400" : score >= 6 ? "text-amber-400" : score >= 4 ? "text-orange-400" : "text-rose-400" : "text-muted-foreground/30";
              return (
                <div key={label} className={`rounded-lg border border-l-4 ${accent} bg-card p-4`}>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-3xl font-bold tabular-nums ${numColor}`}>
                      {score ?? "—"}
                    </span>
                    {score && <span className="text-sm text-muted-foreground">/10</span>}
                  </div>
                  {reasoning && (
                    <p className="text-xs text-foreground/70 mt-2 leading-relaxed">{reasoning}</p>
                  )}
                  {!score && <p className="text-xs text-muted-foreground mt-1">{empty}</p>}
                </div>
              );
            })}
          </div>
          {/* Score change indicator */}
          {dealScores.om_score && dealScores.uw_score && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Change:</span>
              {dealScores.uw_score > dealScores.om_score ? (
                <span className="text-emerald-600 font-medium flex items-center gap-0.5"><TrendingUp className="h-3 w-3" /> +{dealScores.uw_score - dealScores.om_score} from OM</span>
              ) : dealScores.uw_score < dealScores.om_score ? (
                <span className="text-rose-600 font-medium">{dealScores.uw_score - dealScores.om_score} from OM</span>
              ) : (
                <span className="text-muted-foreground font-medium">No change from OM</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border rounded-xl bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">Deal Notes</h3>
        <DealNotes dealId={params.id} compact />
      </div>

      {/* AMI reference from Location Intel — quick lookup while underwriting */}
      {isMF && <AmiReference dealId={params.id} />}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} size="lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save Underwriting
        </Button>
      </div>

      {/* ── Scenario Wizard Modal ── */}
      {showScenarioWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowScenarioWizard(false)}>
          <div className="bg-card rounded-xl border shadow-lifted-md w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold text-sm">New Scenario</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {wizardStep === 0 ? "What would you like to model?" : wizardStep === 1 ? "Set your target" : "Review results"}
                </p>
              </div>
              <button onClick={() => setShowScenarioWizard(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {wizardStep === 0 && (
                <div className="space-y-2">
                  {SCENARIO_TYPES.map(st => (
                    <button
                      key={st.type}
                      onClick={() => {
                        setWizardType(st.type);
                        if (st.type === "custom") {
                          createScenario("Custom Scenario", "custom", "Manual what-if adjustments", {});
                        } else {
                          // Set smart defaults from business plan
                          if (st.type === "land_residual" || st.type === "rent_target") {
                            setWizardMetric("em");
                            setWizardTarget(businessPlan?.target_equity_multiple_min || 2);
                          } else {
                            setWizardMetric("em");
                            setWizardTarget(businessPlan?.target_equity_multiple_min || 2);
                          }
                          setWizardStep(1);
                        }
                      }}
                      className={`w-full flex items-start gap-3 p-4 rounded-lg border transition-colors text-left hover:border-primary/50 hover:bg-primary/5`}
                    >
                      <span className="text-xl">{st.icon}</span>
                      <div>
                        <p className="text-sm font-medium">{st.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{st.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {wizardStep === 1 && (() => {
                // Filter metrics that are meaningful for the chosen scenario type.
                const availableMetrics = WIZARD_METRICS.filter(m => m.scenarios.includes(wizardType));
                const activeMeta = availableMetrics.find(m => m.key === wizardMetric) || availableMetrics[0];
                const suffix = activeMeta.suffix;
                return (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-2">Target Return Metric</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {availableMetrics.map(opt => {
                        const bpVal = opt.bpKey ? businessPlan?.[opt.bpKey] : undefined;
                        return (
                          <button
                            key={opt.key}
                            onClick={() => {
                              setWizardMetric(opt.key);
                              if (bpVal) setWizardTarget(bpVal);
                            }}
                            className={`p-3 rounded-lg border text-center transition-colors ${
                              wizardMetric === opt.key ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                            }`}
                          >
                            <p className="text-xs font-medium">{opt.label}</p>
                            {bpVal != null && (
                              <p className="text-[10px] text-primary mt-1">Plan: {bpVal}{opt.suffix}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-2">
                      Target Value
                      {businessPlan && activeMeta.bpKey && businessPlan[activeMeta.bpKey] != null && (
                        <button
                          className="ml-2 text-primary hover:underline"
                          onClick={() => setWizardTarget(businessPlan[activeMeta.bpKey!]!)}
                        >
                          Use plan min ({businessPlan[activeMeta.bpKey]}{suffix})
                        </button>
                      )}
                    </label>
                    <div className="flex items-center border rounded-md bg-background overflow-hidden w-48">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={wizardTarget || ""}
                        onChange={e => setWizardTarget(parseFloat(e.target.value) || 0)}
                        className="flex-1 px-3 py-2 text-sm outline-none bg-transparent text-blue-700"
                        placeholder="0"
                      />
                      <span className="px-2 text-sm text-muted-foreground bg-muted border-l">
                        {suffix}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {wizardType === "land_residual" && "We'll find the maximum purchase price that achieves this return."}
                      {wizardType === "rent_target" && "We'll find how much market rents need to change to achieve this return."}
                      {wizardType === "exit_cap" && "We'll find the exit cap rate needed to achieve this return."}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" size="sm" onClick={() => setWizardStep(0)}>Back</Button>
                    <Button size="sm" onClick={() => { runWizardSolve(); setWizardStep(2); }} disabled={!wizardTarget}>
                      Calculate
                    </Button>
                  </div>
                </div>
                );
              })()}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  {wizardSolving ? (
                    <div className="flex flex-col items-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary mb-3" />
                      <p className="text-sm text-muted-foreground">Solving...</p>
                    </div>
                  ) : wizardResult ? (
                    <>
                      <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-xs text-muted-foreground mb-1">{wizardResult.label}</p>
                        <p className="text-2xl font-bold text-primary tabular-nums">
                          {wizardType === "land_residual" ? fc(wizardResult.value) :
                           wizardType === "exit_cap" ? `${wizardResult.value.toFixed(2)}%` :
                           `${(wizardResult.value * 100).toFixed(0)}% of baseline rents`}
                        </p>
                        {wizardType === "land_residual" && (
                          <p className="text-xs text-muted-foreground mt-1">
                            vs baseline {fc(data.purchase_price)} ({wizardResult.value > data.purchase_price ? "+" : ""}{((wizardResult.value - data.purchase_price) / data.purchase_price * 100).toFixed(1)}%)
                          </p>
                        )}
                        {wizardType === "exit_cap" && (
                          <p className="text-xs text-muted-foreground mt-1">
                            vs baseline {data.exit_cap_rate.toFixed(2)}%
                          </p>
                        )}
                      </div>
                      {/* Quick comparison */}
                      {(() => {
                        const scenarioData = { ...data, ...wizardResult.scenarioOverrides };
                        const sm = calc(scenarioData, calcMode);
                        const bm = calc(data, calcMode);
                        return (
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: "Equity Multiple", base: `${bm.em.toFixed(2)}x`, scen: `${sm.em.toFixed(2)}x` },
                              { label: "Cash-on-Cash", base: `${bm.coc.toFixed(2)}%`, scen: `${sm.coc.toFixed(2)}%` },
                              { label: "NOI", base: fc(bm.noi), scen: fc(sm.noi) },
                            ].map(c => (
                              <div key={c.label} className="p-3 rounded-lg border bg-muted/30">
                                <p className="text-[10px] text-muted-foreground mb-1">{c.label}</p>
                                <p className="text-xs tabular-nums"><span className="text-muted-foreground">{c.base}</span> → <span className="font-semibold text-primary">{c.scen}</span></p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between pt-2">
                        <Button variant="outline" size="sm" onClick={() => setWizardStep(1)}>Back</Button>
                        <Button size="sm" onClick={() => {
                          const name = wizardType === "land_residual" ? `Price → ${fc(wizardResult.value)}`
                            : wizardType === "exit_cap" ? `Exit Cap → ${wizardResult.value.toFixed(2)}%`
                            : `Rents → ${(wizardResult.value * 100).toFixed(0)}%`;
                          createScenario(name, wizardType, wizardResult.label, wizardResult.scenarioOverrides);
                        }}>
                          <Check className="h-4 w-4 mr-1.5" />Create Scenario
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">No solution found. Try adjusting your target.</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setWizardStep(1)}>Back</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Scenario Compare Modal ── */}
      {showCompareModal && (() => {
        const columns: Array<{ key: string; label: string; data: UWData; isBaseline: boolean }> = [];
        if (compareSelection.has("baseline")) {
          columns.push({ key: "baseline", label: "Baseline", data, isBaseline: true });
        }
        (data.scenarios || []).forEach(s => {
          if (compareSelection.has(s.id)) {
            columns.push({
              key: s.id,
              label: s.name,
              data: { ...data, ...s.overrides, scenarios: data.scenarios },
              isBaseline: false,
            });
          }
        });
        const computed = columns.map(c => ({ ...c, m: calc(c.data, calcMode) }));
        const calcXirr = (m: ReturnType<typeof calc>, eq: number) => {
          if (eq <= 0 || m.yearlyDCF.length === 0) return 0;
          const flows: number[] = [-eq, ...m.yearlyDCF.map((yr, i) =>
            i === m.yearlyDCF.length - 1 ? yr.cashFlow + m.exitEquity : yr.cashFlow
          )];
          return xirr(flows);
        };
        const rows: Array<{ label: string; values: string[]; highlight?: boolean }> = [
          { label: "Purchase Price", values: computed.map(c => fc(c.data.purchase_price)) },
          { label: "Total Investment", values: computed.map(c => fc(c.m.totalCost)) },
          { label: "Equity Required", values: computed.map(c => fc(c.m.equity)) },
          { label: "Debt", values: computed.map(c => fc(c.m.acqLoan)) },
          { label: "NOI (Proforma)", values: computed.map(c => fc(c.m.proformaNOI)) },
          { label: "Cap Rate (Proforma)", values: computed.map(c => c.m.proformaCapRate > 0 ? `${c.m.proformaCapRate.toFixed(2)}%` : "—") },
          { label: "Cash-on-Cash", values: computed.map(c => c.m.coc !== 0 ? `${c.m.coc.toFixed(2)}%` : "—") },
          { label: "DSCR", values: computed.map(c => c.m.dscr > 0 ? `${c.m.dscr.toFixed(2)}x` : "—") },
          { label: "Equity Multiple", values: computed.map(c => c.m.em > 0 ? `${c.m.em.toFixed(2)}x` : "—"), highlight: true },
          { label: "IRR", values: computed.map(c => { const v = calcXirr(c.m, c.m.equity); return v > 0 ? `${v.toFixed(2)}%` : "—"; }), highlight: true },
          { label: "Exit Value", values: computed.map(c => fc(c.m.exitValue)) },
          { label: "Exit Cap Rate", values: computed.map(c => c.data.exit_cap_rate > 0 ? `${c.data.exit_cap_rate.toFixed(2)}%` : "—") },
          { label: "Hold Period", values: computed.map(c => `${c.data.hold_period_years}yr`) },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowCompareModal(false)}>
            <div className="bg-card rounded-xl border shadow-lifted-md w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <GitCompare className="h-4 w-4 text-primary" />
                    Compare Scenarios
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Side-by-side returns across baseline and scenarios</p>
                </div>
                <button onClick={() => setShowCompareModal(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              <div className="px-4 py-3 border-b bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground mb-2">Select scenarios to compare</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleCompareSelection("baseline")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      compareSelection.has("baseline")
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {compareSelection.has("baseline") && <Check className="h-3 w-3" />}
                    <BarChart3 className="h-3 w-3" />
                    Baseline
                  </button>
                  {(data.scenarios || []).map(s => (
                    <button
                      key={s.id}
                      onClick={() => toggleCompareSelection(s.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        compareSelection.has(s.id)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {compareSelection.has(s.id) && <Check className="h-3 w-3" />}
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {columns.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Select at least one scenario to compare.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Metric</th>
                        {computed.map(c => (
                          <th key={c.key} className={`text-right px-4 py-3 text-xs font-semibold ${c.isBaseline ? "text-muted-foreground" : "text-primary"}`}>
                            <div className="flex items-center justify-end gap-1.5">
                              {c.isBaseline ? <BarChart3 className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                              <span className="truncate max-w-[140px]" title={c.label}>{c.label}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={row.label} className={`border-b border-border/50 ${row.highlight ? "bg-primary/5" : i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className={`px-4 py-2.5 text-xs ${row.highlight ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{row.label}</td>
                          {row.values.map((val, j) => (
                            <td key={j} className={`px-4 py-2.5 text-right tabular-nums text-xs ${row.highlight ? "font-bold text-primary" : "text-foreground"}`}>
                              {val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex items-center justify-between p-4 border-t bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Comparing {columns.length} {columns.length === 1 ? "scenario" : "scenarios"}
                </p>
                <Button variant="outline" size="sm" onClick={() => setShowCompareModal(false)}>Close</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CapEx AI Preview Modal ── */}
      {capexPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCapexPreview(null)}>
          <div className="bg-card rounded-xl border shadow-lifted-md w-full max-w-xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">Guidance</span>
                </div>
                <h3 className="font-semibold text-sm mt-0.5">AI CapEx Estimates</h3>
                <p className="text-xs text-muted-foreground mt-0.5">AI suggestions — review and select items to add to your underwriting</p>
              </div>
              <button onClick={() => setCapexPreview(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {capexPreview.map((item, i) => (
                <label key={i} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${item.selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                  <input type="checkbox" checked={item.selected} onChange={() => {
                    setCapexPreview(prev => prev!.map((p, j) => j === i ? { ...p, selected: !p.selected } : p));
                  }} className="rounded mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{item.label}</span>
                      <span className="font-semibold text-sm tabular-nums">{fc(item.quantity * item.cost_per_unit)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.quantity} {item.unit} × {fc(item.cost_per_unit)}</p>
                    {item.basis && <p className="text-xs text-muted-foreground/70 mt-1 italic">{item.basis}</p>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between p-4 border-t bg-muted/20">
              <p className="text-sm text-muted-foreground">
                {capexPreview.filter(i => i.selected).length} selected — {fc(capexPreview.filter(i => i.selected).reduce((s, i) => s + i.quantity * i.cost_per_unit, 0))}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCapexPreview(null)}>Cancel</Button>
                <Button size="sm" onClick={applyCapexEstimates} disabled={capexPreview.filter(i => i.selected).length === 0}>
                  <Check className="h-4 w-4 mr-1.5" />Add Selected
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Document Picker Modal ── */}
      {showDocPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDocPicker(false)}>
          <div className="bg-card rounded-xl border shadow-lifted-md w-full max-w-md mx-4 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold text-sm">Select Documents for Autofill</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Choose which docs to extract underwriting data from</p>
              </div>
              <button onClick={() => setShowDocPicker(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No documents uploaded for this deal.</p>
              ) : (
                <>
                  <button className="text-xs text-primary hover:underline mb-2" onClick={() => {
                    setSelectedDocIds(prev => prev.length === docs.length ? [] : docs.map(d => d.id));
                  }}>{selectedDocIds.length === docs.length ? "Deselect all" : "Select all"}</button>
                  {docs.map(doc => (
                    <label key={doc.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedDocIds.includes(doc.id) ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                      <input type="checkbox" checked={selectedDocIds.includes(doc.id)} onChange={() => {
                        setSelectedDocIds(prev => prev.includes(doc.id) ? prev.filter(id => id !== doc.id) : [...prev, doc.id]);
                      }} className="rounded" />
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{doc.original_name}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
            <div className="flex items-center justify-between p-4 border-t bg-muted/20">
              <p className="text-xs text-muted-foreground">{selectedDocIds.length > 0 ? `${selectedDocIds.length} doc${selectedDocIds.length !== 1 ? "s" : ""} selected` : "All docs will be used"}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowDocPicker(false)}>Cancel</Button>
                <Button size="sm" onClick={autofillWithDocs}>
                  <Sparkles className="h-4 w-4 mr-1.5" />Autofill
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>

      {/* ── Side-by-Side Document Viewer Panel ── */}
      {docViewerOpen && (
        <div className="w-[480px] flex-shrink-0 sticky top-[108px] h-[calc(100vh-120px)] bg-card border rounded-xl shadow-lg flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 shrink-0">
            <h3 className="font-semibold text-sm">Documents</h3>
            <button onClick={() => setDocViewerOpen(false)} className="text-muted-foreground hover:text-foreground">
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>

          {/* Doc tabs */}
          <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto shrink-0 bg-muted/10">
            {docs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No documents uploaded</p>
            ) : docs.map(doc => (
              <button
                key={doc.id}
                onClick={() => setViewingDocId(doc.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                  viewingDocId === doc.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                {doc.original_name.length > 30 ? doc.original_name.slice(0, 27) + "..." : doc.original_name}
              </button>
            ))}
          </div>

          {/* Viewer */}
          <div className="flex-1 min-h-0">
            {viewingDocId ? (
              <iframe
                key={viewingDocId}
                src={`/api/documents/${viewingDocId}/view`}
                className="w-full h-full border-0"
                title="Document viewer"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a document to view
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── UW Co-Pilot is now in the universal chatbot widget ── */}
    </div>
  );
}
