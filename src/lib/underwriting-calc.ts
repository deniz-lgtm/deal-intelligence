import type {
  DevBudgetLineItem, ParkingConfig, LeaseUpConfig, ConstructionLoanConfig,
  MixedUseConfig, RedevelopmentConfig,
} from "@/lib/types";
import type { AffordabilityConfig } from "@/components/AffordabilityPlanner";

export type LeaseType = "NNN" | "MG" | "Gross" | "Modified Gross";

export interface UnitGroup {
  id: string; label: string; unit_count: number;
  renovation_count: number; renovation_cost_per_unit: number;
  unit_change: "none" | "add" | "remove"; unit_change_count: number;
  bedrooms: number; bathrooms: number; sf_per_unit: number;
  current_rent_per_sf: number; market_rent_per_sf: number;
  lease_type: LeaseType; expense_reimbursement_per_sf: number;
  current_rent_per_unit: number; market_rent_per_unit: number;
  beds_per_unit: number; current_rent_per_bed: number; market_rent_per_bed: number;
}

export interface CapexItem { id: string; label: string; quantity: number; cost_per_unit: number; linked_unit_group_id?: string; }

export interface RentComp {
  name: string; address: string; distance_mi: number; year_built: number;
  units?: number; total_sf?: number; occupancy_pct: number;
  unit_types?: Array<{ type: string; sf: number; rent: number }>;
  rent_per_sf?: number; lease_type?: string; tenant_type?: string;
  amenities?: string; notes?: string;
}

export type DCFYear = {
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

export type ScenarioType = "custom" | "land_residual" | "rent_target" | "exit_cap";
export interface Scenario {
  id: string;
  name: string;
  type: ScenarioType;
  description: string;
  overrides: Partial<UWData>;
}

export interface ZoningData {
  far?: number; max_height?: number; lot_coverage?: number;
  setbacks?: { front?: number; side?: number; rear?: number };
  overlays?: string[]; density_bonuses?: string[];
}

export interface CustomOpexRow {
  id: string;
  label: string;
  ip_annual: number;
  pf_annual: number;
  cam: boolean;
}

export interface UWData {
  purchase_price: number; closing_costs_pct: number;
  unit_groups: UnitGroup[]; capex_items: CapexItem[];
  custom_opex: CustomOpexRow[];
  vacancy_rate: number; in_place_vacancy_rate: number; management_fee_pct: number;
  taxes_annual: number; insurance_annual: number; repairs_annual: number;
  utilities_annual: number; other_expenses_annual: number;
  ga_annual: number; marketing_annual: number; reserves_annual: number;
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
  rubs_per_unit_monthly: number; parking_monthly: number; laundry_monthly: number;
  parking_reserved_spaces: number;
  parking_reserved_rate: number;
  parking_unreserved_spaces: number;
  parking_unreserved_rate: number;
  rent_growth_pct: number; expense_growth_pct: number;
  exit_cap_rate: number; hold_period_years: number; notes: string;
  scenarios: Scenario[];
  rent_comps: RentComp[];
  rent_comp_unit_types: string[];
  selected_comp_ids: number[];
  development_mode: boolean;
  land_cost: number;
  hard_cost_per_sf: number;
  soft_cost_pct: number;
  lot_coverage_pct: number;
  far: number;
  height_limit_stories: number;
  max_gsf: number;
  efficiency_pct: number;
  max_nrsf: number;
  cam_taxes: boolean; cam_insurance: boolean; cam_repairs: boolean;
  cam_utilities: boolean; cam_ga: boolean; cam_marketing: boolean;
  cam_reserves: boolean; cam_other: boolean; cam_management: boolean;
  lc_new_pct: number;
  lc_renewal_pct: number;
  lc_renewal_prob: number;
  zoning_designation: string;
  zoning_data: ZoningData | null;
  dev_budget_items: DevBudgetLineItem[];
  parking: ParkingConfig | null;
  lease_up: LeaseUpConfig | null;
  construction_loan: ConstructionLoanConfig | null;
  mixed_use: MixedUseConfig | null;
  redevelopment: RedevelopmentConfig | null;
  building_program: any;
  commercial_tenants: any[];
  other_income_items: any[];
  site_info: any;
  opex_narrative: string;
  loan_narrative: string;
  affordability_config: AffordabilityConfig | null;
}

export const DEFAULT: UWData = {
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
  cam_taxes: true, cam_insurance: true, cam_repairs: true,
  cam_utilities: true, cam_ga: false, cam_marketing: false,
  cam_reserves: false, cam_other: false, cam_management: false,
  lc_new_pct: 6, lc_renewal_pct: 3, lc_renewal_prob: 60,
  zoning_designation: "",
  zoning_data: null,
  dev_budget_items: [],
  parking: null,
  lease_up: null,
  construction_loan: null,
  mixed_use: null,
  redevelopment: null,
  building_program: null,
  commercial_tenants: [],
  other_income_items: [],
  site_info: null,
  opex_narrative: "",
  loan_narrative: "",
  affordability_config: null,
};

export const PROPERTY_OVERRIDES: Record<string, Partial<UWData>> = {
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

export const EFFICIENCY_DEFAULTS: Record<string, number> = {
  industrial: 98, multifamily: 80, sfr: 95, student_housing: 78,
  office: 87, retail: 95, mixed_use: 85, other: 90,
};

export function getDefaultsForPropertyType(propertyType: string | undefined): UWData {
  const overrides = PROPERTY_OVERRIDES[propertyType || ""] || {};
  return { ...DEFAULT, ...overrides };
}

export function ipOr(ip: number, _pf: number): number { return ip || 0; }

export function annualPayment(principal: number, rate: number, years: number): number {
  if (principal <= 0 || rate === 0) return principal > 0 ? principal / years : 0;
  const r = rate / 100 / 12, n = years * 12;
  return (principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)) * 12;
}

export function effectiveUnits(g: UnitGroup): number {
  const delta = (g.unit_change_count || 0);
  if (g.unit_change === "add") return g.unit_count + delta;
  if (g.unit_change === "remove") return Math.max(0, g.unit_count - delta);
  return g.unit_count;
}

export function calc(d: UWData, mode: "commercial" | "multifamily" | "student_housing") {
  const totalUnits = d.unit_groups.reduce((s, g) => s + effectiveUnits(g), 0);
  const ipTotalUnits = d.unit_groups.reduce((s, g) => s + g.unit_count, 0);
  const ipTotalSF = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit, 0) : 0;
  const ipTotalBeds = mode === "student_housing" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.beds_per_unit, 0) : 0;
  const totalSF = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.sf_per_unit, 0) : 0;
  const totalBeds = mode === "student_housing" ? d.unit_groups.reduce((s, g) => s + effectiveUnits(g) * g.beds_per_unit, 0) : 0;

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

  const otherIncomeRUBS = (d.rubs_per_unit_monthly || 0) * totalUnits * 12;
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

  const mgmtFee = egi * (d.management_fee_pct / 100);
  const proformaMgmtFee = proformaEGI * (d.management_fee_pct / 100);
  const inPlaceMgmtFee = d.ip_mgmt_annual;
  const customOpex = d.custom_opex || [];
  const customPfTotal = customOpex.reduce((s, r) => s + (r.pf_annual || 0), 0);
  const customIpTotal = customOpex.reduce((s, r) => s + ipOr(r.ip_annual || 0, r.pf_annual || 0), 0);
  const fixedOpEx = d.taxes_annual + d.insurance_annual + d.repairs_annual + d.utilities_annual + d.other_expenses_annual + (d.ga_annual || 0) + (d.marketing_annual || 0) + (d.reserves_annual || 0) + customPfTotal;
  const totalOpEx = mgmtFee + fixedOpEx;
  const proformaTotalOpEx = proformaMgmtFee + fixedOpEx;
  const ipFixedOpEx = ipOr(d.ip_taxes_annual, d.taxes_annual) + ipOr(d.ip_insurance_annual, d.insurance_annual) + ipOr(d.ip_repairs_annual, d.repairs_annual) + ipOr(d.ip_utilities_annual, d.utilities_annual) + ipOr(d.ip_other_annual, d.other_expenses_annual) + ipOr(d.ip_ga_annual, d.ga_annual || 0) + ipOr(d.ip_marketing_annual, d.marketing_annual || 0) + ipOr(d.ip_reserves_annual, d.reserves_annual || 0) + customIpTotal;
  const inPlaceTotalOpEx = inPlaceMgmtFee + ipFixedOpEx;

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
  let reimbursements = 0;
  let ipReimbursements = 0;
  if (mode === "commercial" && totalSF > 0) {
    for (const g of d.unit_groups) {
      const share = (effectiveUnits(g) * g.sf_per_unit) / totalSF;
      const ipShare = ipTotalSF > 0 ? (g.unit_count * g.sf_per_unit) / ipTotalSF : 0;
      if (g.lease_type === "NNN" || g.lease_type === "MG" || g.lease_type === "Modified Gross") {
        reimbursements += camPool * share;
        ipReimbursements += ipCamPool * ipShare;
      }
    }
  }
  const effectiveRevenue = egi + reimbursements;
  const inPlaceEffectiveRevenue = inPlaceEGI + ipReimbursements;
  const proformaEffectiveRevenue = proformaEGI + reimbursements + totalOtherIncome;

  const lcBlendedPct = mode === "commercial"
    ? ((d.lc_renewal_prob / 100) * (d.lc_renewal_pct / 100) + (1 - d.lc_renewal_prob / 100) * (d.lc_new_pct / 100))
    : 0;
  const leasingCommissions = proformaEGI * lcBlendedPct;
  const ipLeasingCommissions = inPlaceEGI * lcBlendedPct;

  const noi = effectiveRevenue - totalOpEx - leasingCommissions;
  const inPlaceNOI = inPlaceEffectiveRevenue - inPlaceTotalOpEx - ipLeasingCommissions;
  const proformaNOI = proformaEffectiveRevenue - proformaTotalOpEx - leasingCommissions;

  const capexTotal = d.capex_items.reduce((s, c) => s + c.quantity * c.cost_per_unit, 0);
  const devBudgetItems = d.dev_budget_items || [];
  const hasItemizedBudget = d.development_mode && devBudgetItems.length > 0 && devBudgetItems.some(i => i.amount > 0);

  let itemizedHardBase = 0, itemizedSoftBase = 0;
  if (hasItemizedBudget) {
    for (const item of devBudgetItems) {
      if (!item.is_pct && item.category === "hard") itemizedHardBase += item.amount;
      if (!item.is_pct && item.category === "soft") itemizedSoftBase += item.amount;
    }
    for (const item of devBudgetItems) {
      if (item.is_pct && item.pct_basis === "hard_costs") {
        const resolved = itemizedHardBase * (item.pct_value / 100);
        if (item.category === "hard") itemizedHardBase += resolved;
        else itemizedSoftBase += resolved;
      }
    }
  }

  const totalParkingCost = parkingEntries.reduce((s, e) => s + e.spaces * e.cost_per_space, 0);
  const totalHardCosts = d.development_mode
    ? (hasItemizedBudget ? itemizedHardBase : d.hard_cost_per_sf * (d.max_gsf || 0))
    : 0;
  const softCostsTotal = d.development_mode
    ? (hasItemizedBudget ? itemizedSoftBase : totalHardCosts * (d.soft_cost_pct / 100))
    : 0;

  let capitalizedInterest = 0;
  const cl = d.construction_loan;
  if (d.development_mode && cl && cl.rate > 0 && cl.term_months > 0) {
    const totalBudget = totalHardCosts + softCostsTotal + (d.development_mode ? totalParkingCost : 0);
    const loanAmount = totalBudget * (cl.ltc_pct / 100);
    const monthlyRate = cl.rate / 100 / 12;
    if (cl.draw_schedule.length > 0) {
      for (let m = 1; m <= cl.term_months; m++) {
        const draw = cl.draw_schedule.find(dp => dp.month === m);
        const cumPct = draw ? draw.cumulative_pct / 100 : (cl.draw_schedule.filter(dp => dp.month <= m).pop()?.cumulative_pct || 0) / 100;
        capitalizedInterest += loanAmount * cumPct * monthlyRate;
      }
    } else {
      capitalizedInterest = loanAmount * 0.5 * monthlyRate * cl.term_months;
    }
  }

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

  const costBasis = d.development_mode ? totalCost : d.purchase_price;
  const inPlaceCapRate = costBasis > 0 ? (inPlaceNOI / costBasis) * 100 : 0;
  const marketCapRate = costBasis > 0 ? (noi / costBasis) * 100 : 0;
  const proformaCapRate = costBasis > 0 ? (proformaNOI / costBasis) * 100 : 0;
  const yoc = totalCost > 0 ? ((d.development_mode ? noi : proformaNOI) / totalCost) * 100 : 0;

  const basisForPerUnit = d.development_mode ? totalCost : d.purchase_price;
  const pricePerSF = mode === "commercial" && totalSF > 0 ? basisForPerUnit / totalSF : 0;
  const pricePerBed = mode === "student_housing" && totalBeds > 0 ? basisForPerUnit / totalBeds : 0;
  const pricePerUnit = totalUnits > 0 ? basisForPerUnit / totalUnits : 0;

  let acqLoan = 0, acqDebt = 0, acqDebtIO = 0, blendedLtc = 0;
  if (d.has_financing && totalCost > 0) {
    if (d.development_mode) {
      const ltc = d.acq_ltc ?? d.acq_pp_ltv ?? 0;
      acqLoan = totalCost * (ltc / 100);
    } else {
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
      acqDebt = acqLoan * (d.acq_interest_rate / 100);
    } else {
      acqDebt = annualPayment(acqLoan, d.acq_interest_rate, d.acq_amort_years);
    }
    acqDebtIO = d.acq_io_years > 0 ? acqLoan * (d.acq_interest_rate / 100) : acqDebt;
  }
  const equity = totalCost - acqLoan;
  const yr1Debt = d.acq_io_years > 0 ? acqDebtIO : acqDebt;
  const cashFlow = proformaNOI - yr1Debt;
  const coc = equity > 0 ? (cashFlow / equity) * 100 : 0;
  const dscr = acqDebt > 0 ? proformaNOI / acqDebt : 0;

  let refiProceeds = 0, refiDebt = 0;
  if (d.has_refi && d.has_financing && d.exit_cap_rate > 0) {
    const refiLoan = (proformaNOI / (d.exit_cap_rate / 100)) * (d.refi_ltv / 100);
    refiProceeds = refiLoan - acqLoan;
    refiDebt = annualPayment(refiLoan, d.refi_rate, d.refi_amort_years);
  }

  const stabilizedDebtCF = d.has_refi && d.has_financing ? refiDebt : yr1Debt;
  const stabilizedDebtAmort = d.has_refi && d.has_financing ? refiDebt : acqDebt;
  const stabilizedCashFlow = proformaNOI - stabilizedDebtCF;
  const stabilizedCoC = equity > 0 ? (stabilizedCashFlow / equity) * 100 : 0;
  const stabilizedDSCR = stabilizedDebtAmort > 0 ? proformaNOI / stabilizedDebtAmort : 0;

  const rg = (d.rent_growth_pct || 0) / 100;
  const eg = (d.expense_growth_pct || 0) / 100;
  const yearlyDCF: DCFYear[] = [];

  const lu = d.lease_up;
  const constructionMonths = lu?.construction_months || 0;
  const absUnitsPerMo = lu?.absorption_units_per_month || 0;
  const stabOccPct = lu?.stabilization_occupancy_pct || 93;
  const monthsToStab = absUnitsPerMo > 0 ? Math.ceil((totalUnits * stabOccPct / 100) / absUnitsPerMo) : 0;
  let yr1LeaseUpFactor = 1;
  if (d.development_mode && lu && absUnitsPerMo > 0 && totalUnits > 0) {
    const leaseUpStartMonth = Math.max(0, 12 - constructionMonths);
    if (leaseUpStartMonth < 12) {
      let totalOccupancyMonths = 0;
      for (let m = 1; m <= 12; m++) {
        if (m <= (12 - leaseUpStartMonth)) { totalOccupancyMonths += 0; continue; }
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

  const holdYrs = d.hold_period_years || 5;
  const terminalNOI = proformaNOI * Math.pow(1 + rg, holdYrs);
  const exitValue = d.exit_cap_rate > 0 ? terminalNOI / (d.exit_cap_rate / 100) : 0;
  const exitLoanBalance = d.has_refi ? (terminalNOI / (d.exit_cap_rate / 100)) * (d.refi_ltv / 100) : acqLoan;
  const exitEquity = exitValue - exitLoanBalance;

  let totalCashFlows = 0;
  for (let yr = 1; yr <= holdYrs; yr++) {
    if (yr <= 5) {
      totalCashFlows += yearlyDCF[yr - 1].cashFlow;
    } else {
      const yrNOI = proformaNOI * Math.pow(1 + rg, yr) - (fixedOpEx * Math.pow(1 + eg, yr)) - (proformaEGI * Math.pow(1 + rg, yr) * (d.management_fee_pct / 100));
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

  const grm = totalCost > 0 && gpr > 0 ? totalCost / gpr : 0;
  const proformaGRM = totalCost > 0 && proformaGPR > 0 ? totalCost / proformaGPR : 0;
  const inPlaceGRM = totalCost > 0 && inPlaceGPR > 0 ? totalCost / inPlaceGPR : 0;
  const inPlaceCashFlow = inPlaceNOI - yr1Debt;
  const inPlaceCoC = equity > 0 ? (inPlaceCashFlow / equity) * 100 : 0;
  const inPlaceDSCR = acqDebt > 0 ? inPlaceNOI / acqDebt : 0;

  const exitPricePerUnit = totalUnits > 0 && exitValue > 0 ? exitValue / totalUnits : 0;
  const exitPricePerBed = mode === "student_housing" && totalBeds > 0 && exitValue > 0 ? exitValue / totalBeds : 0;
  const exitPricePerSF = mode === "commercial" && totalSF > 0 && exitValue > 0 ? exitValue / totalSF : 0;

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
