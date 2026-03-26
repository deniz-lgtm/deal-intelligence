"use client";

import React, { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash2, Save, Loader2, TrendingUp, DollarSign,
  Calculator, ChevronDown, ChevronUp, RefreshCw, Hammer, Sparkles, X, Check, FileText, Eye, PanelRightClose, GripVertical, BarChart3,
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type LeaseType = "NNN" | "MG" | "Gross" | "Modified Gross";

interface UnitGroup {
  id: string; label: string; unit_count: number;
  will_renovate: boolean; renovation_cost_per_unit: number;
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
}

interface CapexItem { id: string; label: string; quantity: number; cost_per_unit: number; linked_unit_group_id?: string; }

interface RentComp {
  name: string; address: string; distance_mi: number; year_built: number;
  units?: number; total_sf?: number; occupancy_pct: number;
  unit_types?: Array<{ type: string; sf: number; rent: number }>;
  rent_per_sf?: number; lease_type?: string; tenant_type?: string;
  amenities?: string; notes?: string;
}

type NoteCategory = "context" | "review";
interface NoteItem { id: string; text: string; category: NoteCategory; created_at: string; }

interface UWData {
  purchase_price: number; closing_costs_pct: number;
  unit_groups: UnitGroup[]; capex_items: CapexItem[];
  vacancy_rate: number; in_place_vacancy_rate: number; management_fee_pct: number;
  taxes_annual: number; insurance_annual: number; repairs_annual: number;
  utilities_annual: number; other_expenses_annual: number;
  ga_annual: number; marketing_annual: number; reserves_annual: number;
  // In-place opex overrides (annual)
  ip_mgmt_annual: number; ip_taxes_annual: number; ip_insurance_annual: number;
  ip_repairs_annual: number; ip_utilities_annual: number; ip_other_annual: number;
  ip_ga_annual: number; ip_marketing_annual: number; ip_reserves_annual: number;
  has_financing: boolean; acq_ltc: number; acq_interest_rate: number;
  acq_amort_years: number; acq_io_years: number;
  has_refi: boolean; refi_year: number; refi_ltv: number;
  refi_rate: number; refi_amort_years: number;
  exit_cap_rate: number; hold_period_years: number; notes: string; deal_notes: NoteItem[];
}

const DEFAULT: UWData = {
  purchase_price: 0, closing_costs_pct: 2,
  unit_groups: [], capex_items: [],
  vacancy_rate: 5, in_place_vacancy_rate: 5, management_fee_pct: 5,
  taxes_annual: 0, insurance_annual: 0, repairs_annual: 0,
  utilities_annual: 0, other_expenses_annual: 0,
  ga_annual: 0, marketing_annual: 0, reserves_annual: 0,
  ip_mgmt_annual: 0, ip_taxes_annual: 0, ip_insurance_annual: 0,
  ip_repairs_annual: 0, ip_utilities_annual: 0, ip_other_annual: 0,
  ip_ga_annual: 0, ip_marketing_annual: 0, ip_reserves_annual: 0,
  has_financing: true, acq_ltc: 65, acq_interest_rate: 6.5,
  acq_amort_years: 25, acq_io_years: 0,
  has_refi: false, refi_year: 3, refi_ltv: 70,
  refi_rate: 6.0, refi_amort_years: 25,
  exit_cap_rate: 5.5, hold_period_years: 5, notes: "", deal_notes: [],
};

const newGroup = (): UnitGroup => ({
  id: uuidv4(), label: "", unit_count: 1,
  will_renovate: false, renovation_cost_per_unit: 0,
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

function annualPayment(principal: number, rate: number, years: number): number {
  if (principal <= 0 || rate === 0) return principal > 0 ? principal / years : 0;
  const r = rate / 100 / 12, n = years * 12;
  return (principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)) * 12;
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

  // ── Revenue (pro forma uses effective units, in-place uses current) ────────
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

  const ipVacRate = d.in_place_vacancy_rate ?? d.vacancy_rate;
  const vacancyLoss = gpr * (d.vacancy_rate / 100);
  const inPlaceVacancyLoss = inPlaceGPR * (ipVacRate / 100);
  const egi = gpr - vacancyLoss;
  const inPlaceEGI = inPlaceGPR - inPlaceVacancyLoss;

  const reimbursements = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit * g.expense_reimbursement_per_sf, 0) : 0;
  const effectiveRevenue = egi + reimbursements;
  const inPlaceEffectiveRevenue = inPlaceEGI + reimbursements;

  // ── Operating Expenses ──────────────────────────────────────────────────────
  const mgmtFee = egi * (d.management_fee_pct / 100);
  const inPlaceMgmtFee = d.ip_mgmt_annual; // Hard-coded dollar amount, not derived from %
  const fixedOpEx = d.taxes_annual + d.insurance_annual + d.repairs_annual + d.utilities_annual + d.other_expenses_annual + (d.ga_annual || 0) + (d.marketing_annual || 0) + (d.reserves_annual || 0);
  const totalOpEx = mgmtFee + fixedOpEx;
  const ipFixedOpEx = (d.ip_taxes_annual || d.taxes_annual) + (d.ip_insurance_annual || d.insurance_annual) + (d.ip_repairs_annual || d.repairs_annual) + (d.ip_utilities_annual || d.utilities_annual) + (d.ip_other_annual || d.other_expenses_annual) + (d.ip_ga_annual || d.ga_annual || 0) + (d.ip_marketing_annual || d.marketing_annual || 0) + (d.ip_reserves_annual || d.reserves_annual || 0);
  const inPlaceTotalOpEx = inPlaceMgmtFee + ipFixedOpEx;

  // ── NOI ─────────────────────────────────────────────────────────────────────
  const noi = effectiveRevenue - totalOpEx;
  const inPlaceNOI = inPlaceEffectiveRevenue - inPlaceTotalOpEx;

  // ── Cost Basis ──────────────────────────────────────────────────────────────
  // Renovation costs are now included in capex_items via linked items — no separate sum
  const capexTotal = d.capex_items.reduce((s, c) => s + c.quantity * c.cost_per_unit, 0);
  const closingCosts = d.purchase_price * (d.closing_costs_pct / 100);
  const totalCost = d.purchase_price + closingCosts + capexTotal;

  // ── Cap Rates ───────────────────────────────────────────────────────────────
  const inPlaceCapRate = d.purchase_price > 0 ? (inPlaceNOI / d.purchase_price) * 100 : 0;
  const marketCapRate = d.purchase_price > 0 ? (noi / d.purchase_price) * 100 : 0;
  const yoc = totalCost > 0 ? (noi / totalCost) * 100 : 0;

  // ── Per-Unit Metrics ────────────────────────────────────────────────────────
  const pricePerSF = mode === "commercial" && totalSF > 0 ? d.purchase_price / totalSF : 0;
  const pricePerBed = mode === "student_housing" && totalBeds > 0 ? d.purchase_price / totalBeds : 0;
  const pricePerUnit = totalUnits > 0 ? d.purchase_price / totalUnits : 0;

  // ── Acquisition Financing ───────────────────────────────────────────────────
  let acqLoan = 0, acqDebt = 0;
  if (d.has_financing && totalCost > 0) {
    acqLoan = totalCost * (d.acq_ltc / 100);
    acqDebt = d.acq_io_years > 0 ? acqLoan * (d.acq_interest_rate / 100) : annualPayment(acqLoan, d.acq_interest_rate, d.acq_amort_years);
  }
  const equity = totalCost - acqLoan;
  const cashFlow = noi - acqDebt;
  const coc = equity > 0 ? (cashFlow / equity) * 100 : 0;
  const dscr = acqDebt > 0 ? noi / acqDebt : 0;

  // ── Refinance ───────────────────────────────────────────────────────────────
  let refiProceeds = 0, refiDebt = 0;
  if (d.has_refi && d.has_financing && d.exit_cap_rate > 0) {
    const refiLoan = (noi / (d.exit_cap_rate / 100)) * (d.refi_ltv / 100);
    refiProceeds = refiLoan - acqLoan;
    refiDebt = annualPayment(refiLoan, d.refi_rate, d.refi_amort_years);
  }

  // ── Exit & Returns ──────────────────────────────────────────────────────────
  const exitValue = d.exit_cap_rate > 0 ? noi / (d.exit_cap_rate / 100) : 0;
  const exitLoanBalance = d.has_refi ? (noi / (d.exit_cap_rate / 100)) * (d.refi_ltv / 100) : acqLoan;
  const exitEquity = exitValue - exitLoanBalance;

  // Equity multiple: account for pre-refi and post-refi cash flows separately
  let totalCashFlows = 0;
  if (d.has_refi && d.has_financing) {
    const preRefiYears = Math.min(d.refi_year, d.hold_period_years);
    const postRefiYears = Math.max(0, d.hold_period_years - d.refi_year);
    totalCashFlows = cashFlow * preRefiYears + (noi - refiDebt) * postRefiYears + refiProceeds;
  } else {
    totalCashFlows = cashFlow * d.hold_period_years;
  }
  const em = equity > 0 ? (exitEquity + totalCashFlows) / equity : 0;

  // ── GRM + In-Place metrics ────────────────────────────────────────────────
  const grm = d.purchase_price > 0 && gpr > 0 ? d.purchase_price / gpr : 0;
  const inPlaceGRM = d.purchase_price > 0 && inPlaceGPR > 0 ? d.purchase_price / inPlaceGPR : 0;
  const inPlaceCashFlow = inPlaceNOI - acqDebt;
  const inPlaceCoC = equity > 0 ? (inPlaceCashFlow / equity) * 100 : 0;
  const inPlaceDSCR = acqDebt > 0 ? inPlaceNOI / acqDebt : 0;

  // ── Exit Per-Unit ─────────────────────────────────────────────────────────
  const exitPricePerUnit = totalUnits > 0 && exitValue > 0 ? exitValue / totalUnits : 0;
  const exitPricePerBed = mode === "student_housing" && totalBeds > 0 && exitValue > 0 ? exitValue / totalBeds : 0;
  const exitPricePerSF = mode === "commercial" && totalSF > 0 && exitValue > 0 ? exitValue / totalSF : 0;

  return {
    totalSF, totalBeds, totalUnits, ipTotalUnits, ipTotalSF, ipTotalBeds,
    gpr, inPlaceGPR, vacancyLoss, inPlaceVacancyLoss, egi, inPlaceEGI,
    reimbursements, effectiveRevenue, inPlaceEffectiveRevenue,
    mgmtFee, inPlaceMgmtFee, totalOpEx, inPlaceTotalOpEx,
    noi, inPlaceNOI,
    grm, inPlaceGRM, inPlaceCashFlow, inPlaceCoC, inPlaceDSCR,
    exitPricePerUnit, exitPricePerBed, exitPricePerSF,
    capexTotal, closingCosts, totalCost,
    inPlaceCapRate, marketCapRate, yoc,
    pricePerSF, pricePerBed, pricePerUnit,
    acqLoan, acqDebt, equity, cashFlow, coc, dscr,
    refiProceeds, refiDebt, exitValue, exitEquity, totalCashFlows, em,
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
  useEffect(() => { setRaw(fmt(value)); }, [value]);
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex items-center border rounded-md bg-background overflow-hidden">
        {prefix && <span className="px-2 text-sm text-muted-foreground bg-muted border-r">{prefix}</span>}
        <input type="text" inputMode="decimal" value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => { const v = parseFloat(raw.replace(/,/g, "")) || 0; onChange(v); setRaw(fmt(v)); }}
          className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent text-blue-700" placeholder="0" />
        {suffix && <span className="px-2 text-sm text-muted-foreground bg-muted border-l">{suffix}</span>}
      </div>
    </div>
  );
}

function CellInput({ value, onChange, decimals = 0, prefix, align = "right", placeholder = "0", className = "" }: {
  value: number; onChange: (v: number) => void; decimals?: number; prefix?: string; align?: "left" | "right"; placeholder?: string; className?: string;
}) {
  const v0 = value ?? 0;
  const fmt = (v: number) => !v ? "" : v.toLocaleString("en-US", { maximumFractionDigits: decimals });
  const [raw, setRaw] = useState(fmt(v0));
  useEffect(() => { setRaw(fmt(v0)); }, [v0]);
  return (
    <div className={`flex items-center ${className}`}>
      {prefix && <span className="text-xs text-muted-foreground mr-0.5 shrink-0">{prefix}</span>}
      <input type="text" inputMode="decimal" value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => { const v = parseFloat(raw.replace(/,/g, "")) || 0; onChange(v); setRaw(fmt(v)); }}
        className={`w-full bg-transparent text-sm outline-none tabular-nums text-blue-700 ${align === "right" ? "text-right" : "text-left"}`}
        placeholder={placeholder} />
    </div>
  );
}

function CellText({ value, onChange, placeholder = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-transparent text-sm outline-none text-blue-700" placeholder={placeholder} />
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
      <p className={`text-xl font-bold ${hi ? "text-primary" : warn ? "text-yellow-700" : ""}`}>{value}</p>
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

function ISRow({ label, ip, pf, muted, bold, hi }: { label: string; ip: number; pf: number; muted?: boolean; bold?: boolean; hi?: boolean; }) {
  const fmtVal = (v: number) => { const neg = v < 0; return neg ? `(${fc(Math.abs(v))})` : fc(Math.abs(v)); };
  return (
    <tr className={`${bold ? "font-semibold" : ""} ${hi ? "bg-primary/5" : "hover:bg-muted/20"}`}>
      <td className={`px-4 py-1.5 ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{label}</td>
      <td className={`px-4 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{fmtVal(ip)}</td>
      <td className={`px-4 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{fmtVal(pf)}</td>
    </tr>
  );
}

export default function UnderwritingPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<UWData>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [capexEstimating, setCapexEstimating] = useState(false);
  const [capexPreview, setCapexPreview] = useState<Array<{ label: string; quantity: number; unit: string; cost_per_unit: number; basis: string; selected: boolean }> | null>(null);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [docs, setDocs] = useState<Array<{ id: string; original_name: string; mime_type?: string }>>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [docViewerOpen, setDocViewerOpen] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [deal, setDeal] = useState<{ name: string; property_type?: string } | null>(null);
  const [compsLoading, setCompsLoading] = useState(false);
  const [comps, setComps] = useState<Array<RentComp>>([]);
  const [selectedCompIds, setSelectedCompIds] = useState<Set<number>>(new Set());
  const isSH = deal?.property_type === "student_housing";
  const isMF = deal?.property_type === "multifamily" || isSH;
  const calcMode = isSH ? "student_housing" as const : isMF ? "multifamily" as const : "commercial" as const;

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
  // Renovation ↔ CapEx sync
  const toggleRenovation = (groupId: string, checked: boolean) => {
    setData(prev => {
      const group = prev.unit_groups.find(g => g.id === groupId);
      if (!group) return prev;
      const updatedGroups = prev.unit_groups.map(g => g.id === groupId ? { ...g, will_renovate: checked } : g);
      let updatedCapex = [...prev.capex_items];
      if (checked) {
        // Add linked capex item
        if (!updatedCapex.some(c => c.linked_unit_group_id === groupId)) {
          updatedCapex.push({
            id: uuidv4(),
            label: `${group.label || "Unit"} Renovation`,
            quantity: group.unit_count,
            cost_per_unit: group.renovation_cost_per_unit || 0,
            linked_unit_group_id: groupId,
          });
        }
      } else {
        // Remove linked capex item
        updatedCapex = updatedCapex.filter(c => c.linked_unit_group_id !== groupId);
      }
      return { ...prev, unit_groups: updatedGroups, capex_items: updatedCapex };
    });
  };
  // Keep linked capex in sync when unit group changes
  const syncLinkedCapex = (groupId: string, updates: Partial<UnitGroup>) => {
    setData(prev => {
      const updatedGroups = prev.unit_groups.map(g => g.id === groupId ? { ...g, ...updates } : g);
      const group = updatedGroups.find(g => g.id === groupId)!;
      const updatedCapex = prev.capex_items.map(c =>
        c.linked_unit_group_id === groupId
          ? { ...c, label: `${group.label || "Unit"} Renovation`, quantity: group.unit_count, cost_per_unit: group.renovation_cost_per_unit }
          : c
      );
      return { ...prev, unit_groups: updatedGroups, capex_items: updatedCapex };
    });
  };

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
    ]).then(([dr, ur]) => {
      setDeal(dr.data);
      if (ur.data?.data) {
        const raw = ur.data.data;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
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
        setData({ ...DEFAULT, ...parsed });
      }
      else if (dr.data?.asking_price) setData(p => ({ ...p, purchase_price: dr.data.asking_price }));
      setLoading(false);
    });
  }, [params.id]);

  const set = useCallback(<K extends keyof UWData>(k: K, v: UWData[K]) => setData(p => ({ ...p, [k]: v })), []);
  const upd = (id: string, u: Partial<UnitGroup>) => setData(p => ({ ...p, unit_groups: p.unit_groups.map(g => g.id === id ? { ...g, ...u } : g) }));
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
      // Filter out renovation-type items if we already have linked renovation capex
      const hasLinkedRenos = data.capex_items.some(c => c.linked_unit_group_id);
      const renoKeywords = /\breno(vat|v)|unit (upgrade|improve|rehab)|interior (upgrade|improve)/i;
      const items = (json.data as Array<{ label: string; quantity: number; unit: string; cost_per_unit: number; basis: string }>)
        .map(item => ({ ...item, selected: hasLinkedRenos && renoKeywords.test(item.label) ? false : true }));
      setCapexPreview(items);
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

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const m = calc(data, calcMode);

  return (
    <div className={`flex gap-4 ${docViewerOpen ? "" : ""}`}>
    <div className={`space-y-5 min-w-0 ${docViewerOpen ? "flex-1" : "w-full"}`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Underwriting</h2>
          <p className="text-sm text-muted-foreground">{deal?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openDocViewer}>
            <Eye className="h-4 w-4 mr-2" />Docs
          </Button>
          <Button variant="outline" onClick={openDocPicker} disabled={autofilling || saving}>
            {autofilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Autofill
          </Button>
          <Button onClick={save} disabled={saving || autofilling}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
        </div>
      </div>

      {/* Returns — Before (In-Place) vs After (Pro Forma) */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Returns — In-Place vs Pro Forma</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border">
          {([
            { label: "NOI", ip: fc(m.inPlaceNOI), pf: fc(m.noi) },
            { label: "Cap Rate", ip: m.inPlaceCapRate > 0 ? `${m.inPlaceCapRate.toFixed(2)}%` : "—", pf: m.marketCapRate > 0 ? `${m.marketCapRate.toFixed(2)}%` : "—" },
            { label: "Cash-on-Cash", ip: m.inPlaceCoC !== 0 ? `${m.inPlaceCoC.toFixed(2)}%` : "—", pf: m.coc !== 0 ? `${m.coc.toFixed(2)}%` : "—" },
            { label: "DSCR", ip: m.inPlaceDSCR > 0 ? `${m.inPlaceDSCR.toFixed(2)}x` : "—", pf: m.dscr > 0 ? `${m.dscr.toFixed(2)}x` : "—" },
            { label: "GRM", ip: m.inPlaceGRM > 0 ? m.inPlaceGRM.toFixed(2) : "—", pf: m.grm > 0 ? m.grm.toFixed(2) : "—" },
            { label: "Yield on Cost", ip: "—", pf: m.yoc > 0 ? `${m.yoc.toFixed(2)}%` : "—" },
          ] as const).map(metric => (
            <div key={metric.label} className="bg-card p-3">
              <p className="text-xs text-muted-foreground mb-2">{metric.label}</p>
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground/70 uppercase">In-Place</p>
                  <p className="text-sm font-semibold tabular-nums">{metric.ip}</p>
                </div>
                <span className="text-muted-foreground/40 text-xs">→</span>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground/70 uppercase">Pro Forma</p>
                  <p className="text-sm font-semibold tabular-nums text-primary">{metric.pf}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border border-t">
          {/* Total Units with arrow */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-2">{isSH ? "Total Beds" : isMF ? "Total Units" : "Total SF"}</p>
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
          </div>
          {/* Price / Unit: purchase → sale */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-2">{isSH ? "Price / Bed" : "Price / Unit"}</p>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground/70 uppercase">Purchase</p>
                <p className="text-sm font-semibold tabular-nums">{isSH ? (m.pricePerBed > 0 ? fc(m.pricePerBed) : "—") : m.pricePerUnit > 0 ? fc(m.pricePerUnit) : "—"}</p>
              </div>
              <span className="text-muted-foreground/40 text-xs">→</span>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground/70 uppercase">Sale</p>
                <p className="text-sm font-semibold tabular-nums text-primary">{isSH ? (m.exitPricePerBed > 0 ? fc(m.exitPricePerBed) : "—") : m.exitPricePerUnit > 0 ? fc(m.exitPricePerUnit) : "—"}</p>
              </div>
            </div>
          </div>
          {/* Equity Multiple */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-1">Equity Multiple</p>
            <p className="text-lg font-bold tabular-nums">{m.em > 0 ? `${m.em.toFixed(2)}x` : "—"}</p>
            <p className="text-xs text-muted-foreground">{data.hold_period_years}yr hold</p>
          </div>
          {/* Debt */}
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground mb-1">Debt</p>
            <p className="text-lg font-bold tabular-nums">{fc(m.acqLoan)}</p>
            <p className="text-xs text-muted-foreground/60">{data.acq_ltc}% LTC · {data.acq_interest_rate}% · {data.acq_amort_years}yr</p>
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

      <Section title="Purchase & Cost Basis" icon={<DollarSign className="h-4 w-4 text-green-600" />}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-3">
          <NumInput label="Purchase Price" value={data.purchase_price} onChange={v => set("purchase_price", v)} prefix="$" />
          <NumInput label="Closing Costs" value={data.closing_costs_pct} onChange={v => set("closing_costs_pct", v)} suffix="%" decimals={1} />
          <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Closing Cost $</p><p className="text-sm font-semibold">{fc(m.closingCosts)}</p></div>
        </div>
      </Section>

      {/* Rent Comp Generator */}
      <Section title="Rent Comps" icon={<BarChart3 className="h-4 w-4 text-teal-600" />} open={false}>
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="outline" size="sm"
              onClick={async () => {
                setCompsLoading(true);
                try {
                  const res = await fetch(`/api/deals/${params.id}/rent-comps`, { method: "POST" });
                  const json = await res.json();
                  if (res.ok && Array.isArray(json.data)) {
                    setComps(prev => [...prev, ...json.data]);
                    setSelectedCompIds(prev => {
                      const next = new Set(prev);
                      const offset = comps.length;
                      json.data.forEach((_: unknown, i: number) => next.add(offset + i));
                      return next;
                    });
                    toast.success(`${json.data.length} comps generated`);
                  } else { toast.error(json.error || "Failed to generate comps"); }
                } catch { toast.error("Failed to generate comps"); }
                finally { setCompsLoading(false); }
              }}
              disabled={compsLoading}
            >
              {compsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              AI Generate
            </Button>
            <Button variant="outline" size="sm"
              onClick={() => {
                const newComp: RentComp = {
                  name: "", address: "", distance_mi: 0, year_built: 0,
                  units: 0, occupancy_pct: 0,
                  unit_types: (isMF || isSH)
                    ? Array.from(new Set(data.unit_groups.map(g => `${g.bedrooms || 1}BR/${g.bathrooms || 1}BA`))).map(t => ({ type: t, sf: 0, rent: 0 }))
                    : [],
                  rent_per_sf: 0, notes: "",
                };
                setComps(prev => [...prev, newComp]);
                setSelectedCompIds(prev => { const next = new Set(prev); next.add(comps.length); return next; });
              }}
            >
              <Plus className="h-4 w-4 mr-2" />Add Comp
            </Button>
            {comps.length > 0 && selectedCompIds.size > 0 && (
              <Button variant="outline" size="sm"
                onClick={() => {
                  const selected = comps.filter((_, i) => selectedCompIds.has(i));
                  if (isMF || isSH) {
                    const rentsByType: Record<string, { total: number; count: number }> = {};
                    for (const comp of selected) {
                      for (const ut of (comp.unit_types || [])) {
                        if (!rentsByType[ut.type]) rentsByType[ut.type] = { total: 0, count: 0 };
                        if (ut.rent > 0) { rentsByType[ut.type].total += ut.rent; rentsByType[ut.type].count++; }
                      }
                    }
                    setData(prev => ({
                      ...prev,
                      unit_groups: prev.unit_groups.map(g => {
                        const bd = g.bedrooms || 1;
                        const match = Object.entries(rentsByType).find(([k]) => k.startsWith(`${bd}BR`));
                        if (match && match[1].count > 0) return { ...g, market_rent_per_unit: Math.round(match[1].total / match[1].count) };
                        return g;
                      }),
                    }));
                    toast.success("Market rents updated from comps");
                  } else {
                    const totalRent = selected.reduce((s, c) => s + (c.rent_per_sf || 0), 0);
                    const avgRent = selected.length > 0 ? totalRent / selected.length : 0;
                    if (avgRent > 0) {
                      setData(prev => ({ ...prev, unit_groups: prev.unit_groups.map(g => ({ ...g, market_rent_per_sf: Math.round(avgRent * 100) / 100 })) }));
                      toast.success(`Market rent set to $${avgRent.toFixed(2)}/SF`);
                    }
                  }
                }}
              >Apply to Market Rents</Button>
            )}
            {comps.length > 0 && <span className="text-xs text-muted-foreground">{selectedCompIds.size}/{comps.length} selected</span>}
          </div>

          {comps.length > 0 && (isMF || isSH) && (() => {
            // Collect all unique unit types across all comps
            const allTypes = Array.from(new Set(comps.flatMap(c => (c.unit_types || []).map(ut => ut.type)))).sort();
            if (allTypes.length === 0) return null;

            const updateComp = (idx: number, updates: Partial<RentComp>) => {
              setComps(prev => prev.map((c, i) => i === idx ? { ...c, ...updates } : c));
            };
            const updateCompUnitType = (compIdx: number, typeStr: string, field: "rent" | "sf", value: number) => {
              setComps(prev => prev.map((c, i) => {
                if (i !== compIdx) return c;
                const types = [...(c.unit_types || [])];
                const existing = types.findIndex(ut => ut.type === typeStr);
                if (existing >= 0) { types[existing] = { ...types[existing], [field]: value }; }
                else { types.push({ type: typeStr, sf: field === "sf" ? value : 0, rent: field === "rent" ? value : 0 }); }
                return { ...c, unit_types: types };
              }));
            };

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    {/* Top header: grouped by unit type */}
                    <tr className="bg-muted/30 border-b">
                      <th className="px-1 py-1 w-[24px]" rowSpan={2} />
                      <th className="text-left px-2 py-1 text-xs font-medium text-muted-foreground" rowSpan={2}>Property</th>
                      <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[45px]" rowSpan={2}>Dist</th>
                      <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]" rowSpan={2}>Yr</th>
                      <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]" rowSpan={2}>Units</th>
                      <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]" rowSpan={2}>Occ</th>
                      {allTypes.map(t => (
                        <th key={t} colSpan={2} className="text-center px-1 py-1 text-xs font-semibold text-primary border-l">{t}</th>
                      ))}
                      <th className="text-left px-2 py-1 text-xs font-medium text-muted-foreground" rowSpan={2}>Notes</th>
                      <th className="w-[28px]" rowSpan={2} />
                    </tr>
                    <tr className="bg-muted/20 border-b">
                      {allTypes.map(t => (
                        <React.Fragment key={t}>
                          <th className="text-right px-1 py-0.5 text-[10px] text-muted-foreground border-l w-[60px]">Rent</th>
                          <th className="text-right px-1 py-0.5 text-[10px] text-muted-foreground w-[45px]">SF</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((comp, i) => {
                      const isSelected = selectedCompIds.has(i);
                      return (
                        <tr key={i} className={`border-b ${isSelected ? "bg-primary/5" : "opacity-40"} group`}>
                          <td className="px-1 py-1"><input type="checkbox" checked={isSelected} onChange={() => setSelectedCompIds(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })} className="rounded" /></td>
                          <td className="px-2 py-1">
                            <input type="text" value={comp.name} onChange={e => updateComp(i, { name: e.target.value })}
                              className="w-full bg-transparent text-xs outline-none font-medium text-blue-700" placeholder="Property name" />
                            <input type="text" value={comp.address} onChange={e => updateComp(i, { address: e.target.value })}
                              className="w-full bg-transparent text-[10px] outline-none text-blue-700/70" placeholder="Address" />
                          </td>
                          <td className="px-1 py-1"><input type="text" inputMode="decimal" value={comp.distance_mi || ""} onChange={e => updateComp(i, { distance_mi: parseFloat(e.target.value) || 0 })} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                          <td className="px-1 py-1"><input type="text" inputMode="numeric" value={comp.year_built || ""} onChange={e => updateComp(i, { year_built: parseInt(e.target.value) || 0 })} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                          <td className="px-1 py-1"><input type="text" inputMode="numeric" value={comp.units || ""} onChange={e => updateComp(i, { units: parseInt(e.target.value) || 0 })} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                          <td className="px-1 py-1"><input type="text" inputMode="numeric" value={comp.occupancy_pct || ""} onChange={e => updateComp(i, { occupancy_pct: parseInt(e.target.value) || 0 })} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                          {allTypes.map(t => {
                            const ut = (comp.unit_types || []).find(u => u.type === t);
                            return (
                              <React.Fragment key={t}>
                                <td className="px-1 py-1 border-l"><input type="text" inputMode="decimal" value={ut?.rent || ""} onChange={e => updateCompUnitType(i, t, "rent", parseFloat(e.target.value.replace(/,/g, "")) || 0)} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" placeholder="—" /></td>
                                <td className="px-1 py-1"><input type="text" inputMode="numeric" value={ut?.sf || ""} onChange={e => updateCompUnitType(i, t, "sf", parseInt(e.target.value) || 0)} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" placeholder="—" /></td>
                              </React.Fragment>
                            );
                          })}
                          <td className="px-2 py-1"><input type="text" value={comp.notes || ""} onChange={e => updateComp(i, { notes: e.target.value })} className="w-full bg-transparent text-xs outline-none text-blue-700" placeholder="Notes" /></td>
                          <td className="px-1 py-1"><button onClick={() => { setComps(prev => prev.filter((_, j) => j !== i)); setSelectedCompIds(prev => { const next = new Set<number>(); prev.forEach(v => { if (v < i) next.add(v); else if (v > i) next.add(v - 1); }); return next; }); }} className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Averages row */}
                {selectedCompIds.size > 0 && (
                  <div className="mt-2 p-3 bg-muted/30 rounded-lg">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Avg. Rents (Selected)</p>
                    <div className="flex flex-wrap gap-2">
                      {allTypes.map(t => {
                        const rents = comps.filter((_, i) => selectedCompIds.has(i)).flatMap(c => (c.unit_types || []).filter(u => u.type === t && u.rent > 0).map(u => u.rent));
                        if (rents.length === 0) return null;
                        return (
                          <span key={t} className="text-xs bg-card border px-2 py-1 rounded tabular-nums">
                            {t}: <span className="font-semibold">${Math.round(rents.reduce((a, b) => a + b, 0) / rents.length).toLocaleString()}</span>/mo
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Commercial comp table */}
          {comps.length > 0 && !isMF && !isSH && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="px-1 py-1 w-[24px]" />
                    <th className="text-left px-2 py-1 text-xs font-medium text-muted-foreground">Property</th>
                    <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[45px]">Dist</th>
                    <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]">Yr</th>
                    <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[60px]">SF</th>
                    <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[60px]">$/SF</th>
                    <th className="text-right px-1 py-1 text-xs font-medium text-muted-foreground w-[40px]">Occ</th>
                    <th className="text-center px-1 py-1 text-xs font-medium text-muted-foreground w-[50px]">Lease</th>
                    <th className="text-left px-2 py-1 text-xs font-medium text-muted-foreground">Notes</th>
                    <th className="w-[28px]" />
                  </tr>
                </thead>
                <tbody>
                  {comps.map((comp, i) => (
                    <tr key={i} className={`border-b ${selectedCompIds.has(i) ? "bg-primary/5" : "opacity-40"} group`}>
                      <td className="px-1 py-1"><input type="checkbox" checked={selectedCompIds.has(i)} onChange={() => setSelectedCompIds(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })} className="rounded" /></td>
                      <td className="px-2 py-1">
                        <input type="text" value={comp.name} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, name: e.target.value } : c))} className="w-full bg-transparent text-xs font-medium outline-none text-blue-700" placeholder="Property" />
                        <input type="text" value={comp.address} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, address: e.target.value } : c))} className="w-full bg-transparent text-[10px] outline-none text-blue-700/70" placeholder="Address" />
                      </td>
                      <td className="px-1 py-1"><input type="text" value={comp.distance_mi || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, distance_mi: parseFloat(e.target.value) || 0 } : c))} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                      <td className="px-1 py-1"><input type="text" value={comp.year_built || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, year_built: parseInt(e.target.value) || 0 } : c))} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                      <td className="px-1 py-1"><input type="text" value={comp.total_sf || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, total_sf: parseInt(e.target.value.replace(/,/g, "")) || 0 } : c))} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                      <td className="px-1 py-1"><input type="text" value={comp.rent_per_sf || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, rent_per_sf: parseFloat(e.target.value) || 0 } : c))} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700 font-medium" /></td>
                      <td className="px-1 py-1"><input type="text" value={comp.occupancy_pct || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, occupancy_pct: parseInt(e.target.value) || 0 } : c))} className="w-full text-right bg-transparent text-xs outline-none tabular-nums text-blue-700" /></td>
                      <td className="px-1 py-1"><input type="text" value={comp.lease_type || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, lease_type: e.target.value } : c))} className="w-full text-center bg-transparent text-xs outline-none text-blue-700" /></td>
                      <td className="px-2 py-1"><input type="text" value={comp.notes || ""} onChange={e => setComps(prev => prev.map((c, j) => j === i ? { ...c, notes: e.target.value } : c))} className="w-full bg-transparent text-xs outline-none text-blue-700" placeholder="Notes" /></td>
                      <td className="px-1 py-1"><button onClick={() => { setComps(prev => prev.filter((_, j) => j !== i)); setSelectedCompIds(prev => { const next = new Set<number>(); prev.forEach(v => { if (v < i) next.add(v); else if (v > i) next.add(v - 1); }); return next; }); }} className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {comps.length === 0 && !compsLoading && (
            <p className="text-sm text-muted-foreground py-2">Generate AI comps or add manually. AI uses your deal location, unit mix, and uploaded documents.</p>
          )}
        </div>
      </Section>

      <Section title="Revenue — Unit / Space Mix" icon={<Calculator className="h-4 w-4 text-indigo-600" />}>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="w-[28px]" />
                {isSH ? (<>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[160px]">Unit Type</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">#</th>
                  <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">+/−</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">Beds</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">In-Place/Bed</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[110px]">Market/Bed</th>
                  <th className="w-[32px]" />
                </>) : isMF ? (<>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[160px]">Unit Type</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">#</th>
                  <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">+/−</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[40px]">BD</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[40px]">BA</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[60px]">SF</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">In-Place Rent</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[120px]">Market Rent</th>
                  <th className="w-[32px]" />
                </>) : (<>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[160px]">Unit / Space</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">#</th>
                  <th className="text-center px-1 py-1.5 text-xs font-medium text-muted-foreground w-[50px]">+/−</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[70px]">SF/Unit</th>
                  <th className="text-center px-2 py-1.5 text-xs font-medium text-muted-foreground w-[70px]">Lease</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Curr $/SF</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">Mkt $/SF</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[80px]">Reimb $/SF</th>
                  <th className="w-[32px]" />
                </>)}
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorderUnits}>
            <SortableContext items={data.unit_groups.map(g => g.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {data.unit_groups.map(g => {
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
                  if (g.will_renovate && ("label" in updates || "unit_count" in updates || "renovation_cost_per_unit" in updates)) {
                    syncLinkedCapex(id, updates);
                  } else {
                    upd(id, updates);
                  }
                };
                return (
                  <SortableRow key={g.id} id={g.id}>
                    {isSH ? (<>
                      <td className="px-2 py-1"><CellText value={g.label} onChange={v => updFn(g.id, { label: v })} placeholder="e.g. 4BR/2BA" /></td>
                      <td className="px-2 py-1"><CellInput value={g.unit_count} onChange={v => updFn(g.id, { unit_count: v })} /></td>
                      {unitChangeCell}
                      <td className="px-2 py-1"><CellInput value={g.beds_per_unit} onChange={v => upd(g.id, { beds_per_unit: v })} /></td>
                      <td className="px-2 py-1">
                        <CellInput value={g.current_rent_per_bed} onChange={v => upd(g.id, { current_rent_per_bed: v })} prefix="$" />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(ipAnnual)}/yr</p>
                      </td>
                      <td className="px-2 py-1">
                        <CellInput value={g.market_rent_per_bed} onChange={v => upd(g.id, { market_rent_per_bed: v })} prefix="$" />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(pfAnnual)}/yr</p>
                      </td>
                    </>) : isMF ? (<>
                      <td className="px-2 py-1"><CellText value={g.label} onChange={v => updFn(g.id, { label: v })} placeholder="e.g. 1BR/1BA" /></td>
                      <td className="px-2 py-1"><CellInput value={g.unit_count} onChange={v => updFn(g.id, { unit_count: v })} /></td>
                      {unitChangeCell}
                      <td className="px-2 py-1"><CellInput value={g.bedrooms} onChange={v => upd(g.id, { bedrooms: v })} /></td>
                      <td className="px-2 py-1"><CellInput value={g.bathrooms} onChange={v => upd(g.id, { bathrooms: v })} /></td>
                      <td className="px-2 py-1"><CellInput value={g.sf_per_unit} onChange={v => upd(g.id, { sf_per_unit: v })} /></td>
                      <td className="px-2 py-1">
                        <CellInput value={g.current_rent_per_unit} onChange={v => upd(g.id, { current_rent_per_unit: v })} prefix="$" />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(ipAnnual)}/yr</p>
                      </td>
                      <td className="px-2 py-1">
                        <CellInput value={g.market_rent_per_unit} onChange={v => upd(g.id, { market_rent_per_unit: v })} prefix="$" />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(pfAnnual)}/yr</p>
                      </td>
                    </>) : (<>
                      <td className="px-2 py-1"><CellText value={g.label} onChange={v => updFn(g.id, { label: v })} placeholder="e.g. Suite A" /></td>
                      <td className="px-2 py-1"><CellInput value={g.unit_count} onChange={v => updFn(g.id, { unit_count: v })} /></td>
                      {unitChangeCell}
                      <td className="px-2 py-1"><CellInput value={g.sf_per_unit} onChange={v => upd(g.id, { sf_per_unit: v })} /></td>
                      <td className="px-1 py-1">
                        <select value={g.lease_type} onChange={e => upd(g.id, { lease_type: e.target.value as LeaseType })} className="w-full bg-transparent text-sm outline-none text-center">
                          <option value="NNN">NNN</option><option value="MG">MG</option><option value="Gross">Gross</option><option value="Modified Gross">Mod G</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <CellInput value={g.current_rent_per_sf} onChange={v => upd(g.id, { current_rent_per_sf: v })} prefix="$" decimals={2} />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(ipAnnual)}/yr</p>
                      </td>
                      <td className="px-2 py-1">
                        <CellInput value={g.market_rent_per_sf} onChange={v => upd(g.id, { market_rent_per_sf: v })} prefix="$" decimals={2} />
                        <p className="text-[10px] text-muted-foreground/60 text-right tabular-nums">{fc(pfAnnual)}/yr</p>
                      </td>
                      <td className="px-2 py-1"><CellInput value={g.expense_reimbursement_per_sf} onChange={v => upd(g.id, { expense_reimbursement_per_sf: v })} prefix="$" decimals={2} /></td>
                    </>)}
                    <td className="px-1 py-1">
                      <button onClick={() => del(g.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </SortableRow>
                );
              })}
              {data.unit_groups.length === 0 && (
                <tr><td colSpan={isSH ? 8 : isMF ? 10 : 10} className="px-2 py-4 text-sm text-muted-foreground text-center">No units added yet</td></tr>
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
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.inPlaceGPR)}<span className="text-muted-foreground/60">/yr</span></td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                </>) : isMF ? (<>
                  <td colSpan={3} />
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.inPlaceGPR)}<span className="text-muted-foreground/60">/yr</span></td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                </>) : (<>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fn(m.totalSF)}</td>
                  <td />
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">{fc(m.inPlaceGPR)}<span className="text-muted-foreground/60">/yr</span></td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums font-semibold">{fc(m.gpr)}<span className="text-muted-foreground/60">/yr</span></td>
                  <td />
                </>)}
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="flex items-center gap-3 mt-3">
            <Button variant="outline" size="sm" onClick={() => setData(p => ({ ...p, unit_groups: [...p.unit_groups, newGroup()] }))}>
              <Plus className="h-4 w-4 mr-2" /> Add Row
            </Button>
          </div>
          {data.unit_groups.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {data.unit_groups.map(g => (
                <label key={g.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={g.will_renovate} onChange={e => toggleRenovation(g.id, e.target.checked)} className="rounded" />
                  <span className="text-muted-foreground">Renovate: {g.label || "Unit"}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Capital Expenditures" icon={<Hammer className="h-4 w-4 text-orange-600" />} open={false}>
        <div className="mt-3 overflow-x-auto">
          {data.capex_items.length === 0 && <p className="text-sm text-muted-foreground py-2">No CapEx items. Click + to add or check "Renovate" on unit types.</p>}
          {data.capex_items.length > 0 && (
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
              <SortableContext items={data.capex_items.map(c => c.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {data.capex_items.map((c, i) => {
                  const isLinked = !!c.linked_unit_group_id;
                  const updCapex = (updates: Partial<CapexItem>) => {
                    updC(c.id, updates);
                    // Sync back to unit group if linked
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
                  <td className="px-2 py-2 text-right tabular-nums">{fc(m.capexTotal)}</td>
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
        </div>
      </Section>

      <Section title="Operating Assumptions" icon={<Calculator className="h-4 w-4 text-blue-600" />}>
        <div className="mt-3 overflow-x-auto">
          {/* Vacancy row */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <NumInput label="In-Place Vacancy" value={data.in_place_vacancy_rate} onChange={v => set("in_place_vacancy_rate", v)} suffix="%" decimals={1} />
            <NumInput label="Pro Forma Vacancy" value={data.vacancy_rate} onChange={v => set("vacancy_rate", v)} suffix="%" decimals={1} />
            <NumInput label="Management Fee" value={data.management_fee_pct} onChange={v => set("management_fee_pct", v)} suffix="% EGI" decimals={1} />
          </div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="text-left px-2 py-1.5 text-xs font-medium text-muted-foreground w-[180px]">Category</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[130px]">In-Place (Annual)</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[130px]">Pro Forma (Annual)</th>
                <th className="text-right px-2 py-1.5 text-xs font-medium text-muted-foreground w-[100px]">PF $/Unit</th>
              </tr>
            </thead>
            <tbody>
              {/* Management row — in-place is hard $ amount, pro forma is % of EGI */}
              <tr className="border-b hover:bg-muted/20">
                <td className="px-2 py-1.5 text-muted-foreground">Management <span className="text-xs text-muted-foreground/60">({data.management_fee_pct}% PF)</span></td>
                <td className="px-2 py-1.5">
                  <CellInput value={data.ip_mgmt_annual} onChange={v => set("ip_mgmt_annual", v)} prefix="$" />
                </td>
                <td className="px-2 py-1.5"><span className="block text-right text-sm tabular-nums">{fc(m.mgmtFee)}</span></td>
                <td className="px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground">{m.totalUnits > 0 ? fc(Math.round(m.mgmtFee / m.totalUnits)) : "—"}</td>
              </tr>
              {/* Editable expense rows */}
              {([
                { label: "Property Taxes", ipKey: "ip_taxes_annual" as keyof UWData, pfKey: "taxes_annual" as keyof UWData },
                { label: "Insurance", ipKey: "ip_insurance_annual" as keyof UWData, pfKey: "insurance_annual" as keyof UWData },
                { label: "Repairs & Maintenance", ipKey: "ip_repairs_annual" as keyof UWData, pfKey: "repairs_annual" as keyof UWData },
                { label: "Utilities", ipKey: "ip_utilities_annual" as keyof UWData, pfKey: "utilities_annual" as keyof UWData },
                { label: "General & Admin", ipKey: "ip_ga_annual" as keyof UWData, pfKey: "ga_annual" as keyof UWData },
                { label: "Marketing / Leasing", ipKey: "ip_marketing_annual" as keyof UWData, pfKey: "marketing_annual" as keyof UWData },
                { label: "Reserves", ipKey: "ip_reserves_annual" as keyof UWData, pfKey: "reserves_annual" as keyof UWData },
                { label: "Other", ipKey: "ip_other_annual" as keyof UWData, pfKey: "other_expenses_annual" as keyof UWData },
              ]).map(row => {
                const ipVal = (data[row.ipKey] as number) || 0;
                const pfVal = (data[row.pfKey] as number) || 0;
                const perUnit = m.totalUnits > 0 ? pfVal / m.totalUnits : 0;
                return (
                  <tr key={row.label} className="border-b hover:bg-muted/20">
                    <td className="px-2 py-1.5 text-muted-foreground">{row.label}</td>
                    <td className="px-2 py-1.5">
                      <CellInput value={ipVal} onChange={v => set(row.ipKey as keyof UWData, v)} prefix="$" />
                    </td>
                    <td className="px-2 py-1.5">
                      <CellInput value={pfVal} onChange={v => set(row.pfKey as keyof UWData, v)} prefix="$" />
                    </td>
                    <td className="px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground">{perUnit > 0 ? fc(Math.round(perUnit)) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 font-semibold">
                <td className="px-2 py-2">Total Operating Expenses</td>
                <td className="px-2 py-2 text-right tabular-nums">{fc(m.inPlaceTotalOpEx)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fc(m.totalOpEx)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{m.totalUnits > 0 ? fc(Math.round(m.totalOpEx / m.totalUnits)) : "—"}</td>
              </tr>
            </tbody>
          </table>
          <div className="flex gap-4 mt-3">
            <div className="p-3 bg-muted/50 rounded-lg flex-1"><p className="text-xs text-muted-foreground mb-1">EGI</p><p className="text-sm font-semibold">{fc(m.egi)}</p><p className="text-xs text-muted-foreground">{fc(m.vacancyLoss)} vacancy loss</p></div>
            <div className="p-3 bg-muted/50 rounded-lg flex-1"><p className="text-xs text-muted-foreground mb-1">OpEx Ratio</p><p className="text-sm font-semibold">{m.egi > 0 ? ((m.totalOpEx / m.egi) * 100).toFixed(0) : 0}% of EGI</p></div>
          </div>
        </div>
      </Section>

      <Section title="Financing" icon={<TrendingUp className="h-4 w-4 text-purple-600" />}>
        <div className="mt-3 space-y-5">
          <div>
            <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold mb-3">
              <input type="checkbox" checked={data.has_financing} onChange={e => set("has_financing", e.target.checked)} className="rounded" />
              Acquisition Loan
            </label>
            {data.has_financing && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <NumInput label="Loan-to-Cost" value={data.acq_ltc} onChange={v => set("acq_ltc", v)} suffix="%" decimals={1} />
                <NumInput label="Interest Rate" value={data.acq_interest_rate} onChange={v => set("acq_interest_rate", v)} suffix="%" decimals={3} />
                <NumInput label="Amortization" value={data.acq_amort_years} onChange={v => set("acq_amort_years", v)} suffix="yrs" />
                <NumInput label="Interest-Only Period" value={data.acq_io_years} onChange={v => set("acq_io_years", v)} suffix="yrs" />
                <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Loan Amount</p><p className="text-sm font-semibold">{fc(m.acqLoan)}</p></div>
                <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Annual Debt Service</p><p className="text-sm font-semibold">{fc(m.acqDebt)}</p></div>
                <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Equity Required</p><p className="text-sm font-semibold">{fc(m.equity)}</p></div>
                <div className={`p-3 rounded-lg ${m.dscr >= 1.25 ? "bg-green-50 border border-green-200" : m.dscr > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-muted/50"}`}>
                  <p className="text-xs text-muted-foreground mb-1">DSCR</p>
                  <p className={`text-sm font-semibold ${m.dscr >= 1.25 ? "text-green-700" : m.dscr > 0 ? "text-yellow-700" : ""}`}>{m.dscr > 0 ? `${m.dscr.toFixed(2)}x` : "—"}</p>
                  <p className="text-xs text-muted-foreground">{m.dscr >= 1.25 ? "✓ Good" : m.dscr > 0 ? "⚠ Low" : ""}</p>
                </div>
              </div>
            )}
          </div>
          {data.has_financing && (
            <div className="border-t pt-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold mb-3">
                <input type="checkbox" checked={data.has_refi} onChange={e => set("has_refi", e.target.checked)} className="rounded" />
                Refinance
              </label>
              {data.has_refi && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <NumInput label="Refi in Year" value={data.refi_year} onChange={v => set("refi_year", v)} suffix="yr" />
                  <NumInput label="Refi LTV" value={data.refi_ltv} onChange={v => set("refi_ltv", v)} suffix="%" decimals={1} />
                  <NumInput label="Refi Rate" value={data.refi_rate} onChange={v => set("refi_rate", v)} suffix="%" decimals={3} />
                  <NumInput label="Refi Amortization" value={data.refi_amort_years} onChange={v => set("refi_amort_years", v)} suffix="yrs" />
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Refi Proceeds</p>
                    <p className={`text-sm font-semibold ${m.refiProceeds < 0 ? "text-red-600" : "text-green-700"}`}>{fc(m.refiProceeds)}</p>
                    <p className="text-xs text-muted-foreground">{m.refiProceeds < 0 ? "⚠ Shortfall" : "Cash out"}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">New Annual Debt</p><p className="text-sm font-semibold">{fc(m.refiDebt)}</p></div>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Exit Analysis" icon={<RefreshCw className="h-4 w-4 text-teal-600" />} open={false}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
          <NumInput label="Exit Cap Rate" value={data.exit_cap_rate} onChange={v => set("exit_cap_rate", v)} suffix="%" decimals={2} />
          <NumInput label="Hold Period" value={data.hold_period_years} onChange={v => set("hold_period_years", v)} suffix="yrs" />
          <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Exit Value</p><p className="text-sm font-semibold">{fc(m.exitValue)}</p></div>
          <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Equity at Exit</p><p className="text-sm font-semibold">{fc(m.exitEquity)}</p></div>
        </div>
      </Section>

      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Income Statement</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide">Line Item</th>
              <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide w-32">In-Place</th>
              <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide w-32">Pro Forma</th>
            </tr>
          </thead>
          <tbody>
            <ISRow label="Gross Potential Revenue" ip={m.inPlaceGPR} pf={m.gpr} />
            <ISRow label={`Less Vacancy`} ip={-m.inPlaceVacancyLoss} pf={-m.vacancyLoss} muted />
            <ISRow label="Effective Gross Income" ip={m.inPlaceEGI} pf={m.egi} bold />
            {m.reimbursements > 0 && <>
              <ISRow label="Expense Reimbursements" ip={m.reimbursements} pf={m.reimbursements} />
              <ISRow label="Effective Revenue" ip={m.inPlaceEffectiveRevenue} pf={m.effectiveRevenue} bold />
            </>}
            <tr><td colSpan={3} className="px-4"><div className="border-t" /></td></tr>
            <ISRow label={`Management (${data.management_fee_pct}%)`} ip={-m.inPlaceMgmtFee} pf={-m.mgmtFee} muted />
            <ISRow label="Property Taxes" ip={-(data.ip_taxes_annual || data.taxes_annual)} pf={-data.taxes_annual} muted />
            <ISRow label="Insurance" ip={-(data.ip_insurance_annual || data.insurance_annual)} pf={-data.insurance_annual} muted />
            <ISRow label="Repairs & Maintenance" ip={-(data.ip_repairs_annual || data.repairs_annual)} pf={-data.repairs_annual} muted />
            {(data.utilities_annual > 0 || data.ip_utilities_annual > 0) && <ISRow label="Utilities" ip={-(data.ip_utilities_annual || data.utilities_annual)} pf={-data.utilities_annual} muted />}
            {(data.ga_annual > 0 || data.ip_ga_annual > 0) && <ISRow label="General & Admin" ip={-(data.ip_ga_annual || data.ga_annual)} pf={-data.ga_annual} muted />}
            {(data.marketing_annual > 0 || data.ip_marketing_annual > 0) && <ISRow label="Marketing / Leasing" ip={-(data.ip_marketing_annual || data.marketing_annual)} pf={-data.marketing_annual} muted />}
            {(data.reserves_annual > 0 || data.ip_reserves_annual > 0) && <ISRow label="Reserves" ip={-(data.ip_reserves_annual || data.reserves_annual)} pf={-data.reserves_annual} muted />}
            {(data.other_expenses_annual > 0 || data.ip_other_annual > 0) && <ISRow label="Other Expenses" ip={-(data.ip_other_annual || data.other_expenses_annual)} pf={-data.other_expenses_annual} muted />}
            <ISRow label={`Total Operating Expenses${m.inPlaceEGI > 0 ? ` (${((m.inPlaceTotalOpEx / m.inPlaceEGI) * 100).toFixed(0)}% / ${m.egi > 0 ? ((m.totalOpEx / m.egi) * 100).toFixed(0) : 0}%)` : ""}`} ip={-m.inPlaceTotalOpEx} pf={-m.totalOpEx} />
            <tr><td colSpan={3} className="px-4"><div className="border-t" /></td></tr>
            <ISRow label="Net Operating Income" ip={m.inPlaceNOI} pf={m.noi} bold hi />
            {data.has_financing && <>
              <ISRow label="Annual Debt Service (Acq)" ip={-m.acqDebt} pf={-m.acqDebt} muted />
              <tr><td colSpan={3} className="px-4"><div className="border-t" /></td></tr>
              <ISRow label="Cash Flow Before Tax" ip={m.inPlaceNOI - m.acqDebt} pf={m.cashFlow} bold hi={m.cashFlow > 0} />
              <tr className="bg-muted/10">
                <td className="px-4 py-2 text-xs font-medium text-muted-foreground">Cash-on-Cash Return</td>
                <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums">{m.inPlaceCoC !== 0 ? `${m.inPlaceCoC.toFixed(2)}%` : "—"}</td>
                <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-primary">{m.coc !== 0 ? `${m.coc.toFixed(2)}%` : "—"}</td>
              </tr>
            </>}
          </tbody>
        </table>
      </div>

      <div className="border rounded-xl bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">Deal Notes</h3>
        {/* Existing notes list */}
        {(data.deal_notes ?? []).length > 0 && (
          <div className="space-y-2 mb-3">
            {(data.deal_notes ?? []).map(note => (
              <div key={note.id} className="flex items-start gap-2 group">
                <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded font-medium shrink-0 ${
                  note.category === "context" ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-700"
                }`}>
                  {note.category === "context" ? "AI Context" : "Team Review"}
                </span>
                <p className="text-sm flex-1">{note.text}</p>
                <button
                  onClick={() => setData(prev => ({ ...prev, deal_notes: (prev.deal_notes ?? []).filter(n => n.id !== note.id) }))}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                ><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        {/* Add note form */}
        <div className="flex items-center gap-2">
          <select
            id="note-category"
            defaultValue="context"
            className="text-xs border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="context">AI Context</option>
            <option value="review">Team Review</option>
          </select>
          <input
            id="note-input"
            type="text"
            placeholder="Add a note..."
            className="flex-1 text-sm border rounded-md px-3 py-1.5 bg-background outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={e => {
              if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                const input = e.target as HTMLInputElement;
                const catSelect = document.getElementById("note-category") as HTMLSelectElement;
                const newNote: NoteItem = {
                  id: uuidv4(),
                  text: input.value.trim(),
                  category: catSelect.value as NoteCategory,
                  created_at: new Date().toISOString(),
                };
                setData(prev => ({ ...prev, deal_notes: [...(prev.deal_notes ?? []), newNote] }));
                input.value = "";
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const input = document.getElementById("note-input") as HTMLInputElement;
              const catSelect = document.getElementById("note-category") as HTMLSelectElement;
              if (!input.value.trim()) return;
              const newNote: NoteItem = {
                id: uuidv4(),
                text: input.value.trim(),
                category: catSelect.value as NoteCategory,
                created_at: new Date().toISOString(),
              };
              setData(prev => ({ ...prev, deal_notes: [...(prev.deal_notes ?? []), newNote] }));
              input.value = "";
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} size="lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save Underwriting
        </Button>
      </div>

      {/* ── CapEx AI Preview Modal ── */}
      {capexPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCapexPreview(null)}>
          <div className="bg-card rounded-xl border shadow-lifted-md w-full max-w-xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold text-sm">AI CapEx Estimates</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Select items to add to your underwriting</p>
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
    </div>
  );
}
