"use client";

import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash2, Save, Loader2, TrendingUp, DollarSign,
  Calculator, ChevronDown, ChevronUp, RefreshCw, Hammer, Sparkles, X, Check, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type LeaseType = "NNN" | "MG" | "Gross" | "Modified Gross";

interface UnitGroup {
  id: string; label: string; unit_count: number;
  will_renovate: boolean; renovation_cost_per_unit: number;
  // Commercial (SF-based)
  sf_per_unit: number; current_rent_per_sf: number; market_rent_per_sf: number;
  lease_type: LeaseType; expense_reimbursement_per_sf: number;
  // Multifamily (unit-based, monthly)
  current_rent_per_unit: number; market_rent_per_unit: number;
  // Student Housing (bed-based, monthly)
  beds_per_unit: number; current_rent_per_bed: number; market_rent_per_bed: number;
}

interface CapexItem { id: string; label: string; quantity: number; cost_per_unit: number; }

interface UWData {
  purchase_price: number; closing_costs_pct: number;
  unit_groups: UnitGroup[]; capex_items: CapexItem[];
  vacancy_rate: number; management_fee_pct: number;
  taxes_annual: number; insurance_annual: number; repairs_annual: number;
  utilities_annual: number; other_expenses_annual: number;
  has_financing: boolean; acq_ltc: number; acq_interest_rate: number;
  acq_amort_years: number; acq_io_years: number;
  has_refi: boolean; refi_year: number; refi_ltv: number;
  refi_rate: number; refi_amort_years: number;
  exit_cap_rate: number; hold_period_years: number; notes: string;
}

const DEFAULT: UWData = {
  purchase_price: 0, closing_costs_pct: 2,
  unit_groups: [], capex_items: [],
  vacancy_rate: 5, management_fee_pct: 5,
  taxes_annual: 0, insurance_annual: 0, repairs_annual: 0,
  utilities_annual: 0, other_expenses_annual: 0,
  has_financing: true, acq_ltc: 65, acq_interest_rate: 6.5,
  acq_amort_years: 25, acq_io_years: 0,
  has_refi: false, refi_year: 3, refi_ltv: 70,
  refi_rate: 6.0, refi_amort_years: 25,
  exit_cap_rate: 5.5, hold_period_years: 5, notes: "",
};

const newGroup = (): UnitGroup => ({
  id: uuidv4(), label: "Unit Group", unit_count: 1,
  will_renovate: false, renovation_cost_per_unit: 0,
  // Commercial defaults
  sf_per_unit: 1000, current_rent_per_sf: 0, market_rent_per_sf: 24,
  lease_type: "NNN", expense_reimbursement_per_sf: 0,
  // MF defaults (monthly per unit)
  current_rent_per_unit: 0, market_rent_per_unit: 1200,
  // Student Housing defaults (monthly per bed)
  beds_per_unit: 1, current_rent_per_bed: 0, market_rent_per_bed: 1200,
});

const newCapex = (): CapexItem => ({ id: uuidv4(), label: "CapEx Item", quantity: 1, cost_per_unit: 0 });

function annualPayment(principal: number, rate: number, years: number): number {
  if (principal <= 0 || rate === 0) return principal > 0 ? principal / years : 0;
  const r = rate / 100 / 12, n = years * 12;
  return (principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)) * 12;
}

function calc(d: UWData, mode: "commercial" | "multifamily" | "student_housing") {
  const totalUnits = d.unit_groups.reduce((s, g) => s + g.unit_count, 0);
  const totalSF = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit, 0) : 0;
  const totalBeds = mode === "student_housing" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.beds_per_unit, 0) : 0;

  // ── Revenue ─────────────────────────────────────────────────────────────────
  const gpr = mode === "student_housing"
    ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.beds_per_unit * g.market_rent_per_bed * 12, 0)
    : mode === "multifamily"
    ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.market_rent_per_unit * 12, 0)
    : d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit * g.market_rent_per_sf, 0);
  const inPlaceGPR = mode === "student_housing"
    ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.beds_per_unit * g.current_rent_per_bed * 12, 0)
    : mode === "multifamily"
    ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.current_rent_per_unit * 12, 0)
    : d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit * g.current_rent_per_sf, 0);

  const vacancyLoss = gpr * (d.vacancy_rate / 100);
  const inPlaceVacancyLoss = inPlaceGPR * (d.vacancy_rate / 100);
  const egi = gpr - vacancyLoss;
  const inPlaceEGI = inPlaceGPR - inPlaceVacancyLoss;

  const reimbursements = mode === "commercial" ? d.unit_groups.reduce((s, g) => s + g.unit_count * g.sf_per_unit * g.expense_reimbursement_per_sf, 0) : 0;
  const effectiveRevenue = egi + reimbursements;
  const inPlaceEffectiveRevenue = inPlaceEGI + reimbursements;

  // ── Operating Expenses ──────────────────────────────────────────────────────
  const mgmtFee = egi * (d.management_fee_pct / 100);
  const inPlaceMgmtFee = inPlaceEGI * (d.management_fee_pct / 100);
  const fixedOpEx = d.taxes_annual + d.insurance_annual + d.repairs_annual + d.utilities_annual + d.other_expenses_annual;
  const totalOpEx = mgmtFee + fixedOpEx;
  const inPlaceTotalOpEx = inPlaceMgmtFee + fixedOpEx;

  // ── NOI ─────────────────────────────────────────────────────────────────────
  const noi = effectiveRevenue - totalOpEx;
  const inPlaceNOI = inPlaceEffectiveRevenue - inPlaceTotalOpEx;

  // ── Cost Basis ──────────────────────────────────────────────────────────────
  const renovationCost = d.unit_groups.reduce((s, g) => s + (g.will_renovate ? g.unit_count * g.renovation_cost_per_unit : 0), 0);
  const capexTotal = d.capex_items.reduce((s, c) => s + c.quantity * c.cost_per_unit, 0);
  const closingCosts = d.purchase_price * (d.closing_costs_pct / 100);
  const totalCost = d.purchase_price + closingCosts + renovationCost + capexTotal;

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

  return {
    totalSF, totalBeds, totalUnits,
    gpr, inPlaceGPR, vacancyLoss, inPlaceVacancyLoss, egi, inPlaceEGI,
    reimbursements, effectiveRevenue, inPlaceEffectiveRevenue,
    mgmtFee, inPlaceMgmtFee, totalOpEx, inPlaceTotalOpEx,
    noi, inPlaceNOI,
    renovationCost, capexTotal, closingCosts, totalCost,
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
          className="flex-1 px-2 py-1.5 text-sm outline-none bg-transparent" placeholder="0" />
        {suffix && <span className="px-2 text-sm text-muted-foreground bg-muted border-l">{suffix}</span>}
      </div>
    </div>
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

function TR({ label, val, per, muted, bold, hi }: { label: string; val: number; per?: number; muted?: boolean; bold?: boolean; hi?: boolean; }) {
  const neg = val < 0;
  const abs = Math.abs(val);
  const formatted = neg ? `(${fc(abs)})` : fc(abs);
  const perVal = per && per > 0 ? abs / per : 0;
  const perFormatted = perVal > 0 ? (neg ? `(${fc(perVal)})` : fc(perVal)) : "—";
  return (
    <tr className={`${bold ? "font-semibold" : ""} ${hi ? "bg-primary/5" : "hover:bg-muted/20"}`}>
      <td className={`px-5 py-1.5 ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{label}</td>
      <td className={`px-5 py-1.5 text-right tabular-nums ${muted ? "text-muted-foreground" : ""} ${hi ? "text-primary" : ""}`}>{formatted}</td>
      {per !== undefined && <td className={`px-5 py-1.5 text-right tabular-nums text-xs ${muted ? "text-muted-foreground" : "text-muted-foreground"}`}>{perFormatted}</td>}
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
  const [docs, setDocs] = useState<Array<{ id: string; original_name: string }>>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [deal, setDeal] = useState<{ name: string; property_type?: string } | null>(null);
  const isSH = deal?.property_type === "student_housing";
  const isMF = deal?.property_type === "multifamily" || isSH;
  const calcMode = isSH ? "student_housing" as const : isMF ? "multifamily" as const : "commercial" as const;

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()),
    ]).then(([dr, ur]) => {
      setDeal(dr.data);
      if (ur.data?.data) {
        const raw = ur.data.data;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
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
      const items = (json.data as Array<{ label: string; quantity: number; unit: string; cost_per_unit: number; basis: string }>)
        .map(item => ({ ...item, selected: true }));
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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Underwriting</h2>
          <p className="text-sm text-muted-foreground">{deal?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openDocPicker} disabled={autofilling || saving}>
            {autofilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Autofill from Docs
          </Button>
          <Button onClick={save} disabled={saving || autofilling}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MBox label="In-Place NOI" value={fc(m.inPlaceNOI)} sub={`${fc(m.noi)} pro forma`} />
        <MBox label="In-Place Cap Rate" value={m.inPlaceCapRate > 0 ? `${m.inPlaceCapRate.toFixed(2)}%` : "—"} sub="on purchase price" warn={m.inPlaceCapRate > 0 && m.inPlaceCapRate < 4} />
        <MBox label="Market Cap Rate" value={m.marketCapRate > 0 ? `${m.marketCapRate.toFixed(2)}%` : "—"} sub={`${m.yoc.toFixed(2)}% yield on cost`} hi={m.marketCapRate > 5} warn={m.marketCapRate > 0 && m.marketCapRate < 4} />
        <MBox label="Cash-on-Cash" value={m.coc !== 0 ? `${m.coc.toFixed(2)}%` : "—"} sub={data.has_financing ? `DSCR ${m.dscr.toFixed(2)}x` : "No financing"} hi={m.coc > 7} warn={m.coc > 0 && m.coc < 4} />
        <MBox label="Equity Multiple" value={m.em > 0 ? `${m.em.toFixed(2)}x` : "—"} sub={`${data.hold_period_years}yr hold`} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MBox label={isSH ? "Total Beds" : isMF ? "Total Units" : "Total SF"} value={fn(isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF)} sub={isSH ? `${fn(m.totalUnits)} units` : isMF ? undefined : `${fn(m.totalUnits)} units`} />
        <MBox label={isSH ? "Price / Bed" : "Price / Unit"} value={isSH ? (m.pricePerBed > 0 ? fc(m.pricePerBed) : "—") : m.pricePerUnit > 0 ? fc(m.pricePerUnit) : "—"} sub={!isMF && m.pricePerSF > 0 ? `${fc(m.pricePerSF)} / SF` : undefined} />
        <MBox label="Total Investment" value={fc(m.totalCost)} sub={`${fc(m.capexTotal + m.renovationCost)} CapEx + ${fc(m.closingCosts)} closing`} />
        <MBox label="Gross Revenue (PF)" value={fc(m.gpr)} sub={`${fc(m.inPlaceGPR)} in-place`} />
      </div>

      <Section title="Purchase & Cost Basis" icon={<DollarSign className="h-4 w-4 text-green-600" />}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-3">
          <NumInput label="Purchase Price" value={data.purchase_price} onChange={v => set("purchase_price", v)} prefix="$" />
          <NumInput label="Closing Costs" value={data.closing_costs_pct} onChange={v => set("closing_costs_pct", v)} suffix="%" decimals={1} />
          <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Closing Cost $</p><p className="text-sm font-semibold">{fc(m.closingCosts)}</p></div>
        </div>
      </Section>

      <Section title="Revenue — Unit / Space Mix" icon={<Calculator className="h-4 w-4 text-indigo-600" />}>
        <div className="space-y-3 mt-3">
          {data.unit_groups.length === 0 && <p className="text-sm text-muted-foreground py-2">No units added. Click + to add a unit group or space type.</p>}
          {data.unit_groups.map(g => (
            <div key={g.id} className="border rounded-lg p-4 bg-background space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
                  <input type="text" value={g.label} onChange={e => upd(g.id, { label: e.target.value })} placeholder="e.g. Flex Bay, Suite A" className="w-full px-2 py-1.5 text-sm border rounded-md bg-background outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <button onClick={() => del(g.id)} className="text-muted-foreground hover:text-destructive mt-5 shrink-0"><Trash2 className="h-4 w-4" /></button>
              </div>
              {isSH ? (
                /* ── Student Housing: per-bed pricing ── */
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <NumInput label="# Units" value={g.unit_count} onChange={v => upd(g.id, { unit_count: v })} />
                    <NumInput label="Beds / Unit" value={g.beds_per_unit} onChange={v => upd(g.id, { beds_per_unit: v })} />
                    <NumInput label="Current Rent / Bed / Mo" value={g.current_rent_per_bed} onChange={v => upd(g.id, { current_rent_per_bed: v })} prefix="$" decimals={0} />
                    <NumInput label="Market Rent / Bed / Mo" value={g.market_rent_per_bed} onChange={v => upd(g.id, { market_rent_per_bed: v })} prefix="$" decimals={0} />
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-xs max-w-xs">
                    <p className="text-muted-foreground mb-1">Annual Revenue</p>
                    <p className="font-semibold">{fc(g.unit_count * g.beds_per_unit * g.market_rent_per_bed * 12)}</p>
                    <p className="text-muted-foreground">{fn(g.unit_count * g.beds_per_unit)} beds total</p>
                  </div>
                </>
              ) : isMF ? (
                /* ── Multifamily: per-unit pricing ── */
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <NumInput label="# Units" value={g.unit_count} onChange={v => upd(g.id, { unit_count: v })} />
                    <NumInput label="Current Rent / Unit / Mo" value={g.current_rent_per_unit} onChange={v => upd(g.id, { current_rent_per_unit: v })} prefix="$" decimals={0} />
                    <NumInput label="Market Rent / Unit / Mo" value={g.market_rent_per_unit} onChange={v => upd(g.id, { market_rent_per_unit: v })} prefix="$" decimals={0} />
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-xs max-w-xs">
                    <p className="text-muted-foreground mb-1">Annual Revenue</p>
                    <p className="font-semibold">{fc(g.unit_count * g.market_rent_per_unit * 12)}</p>
                    <p className="text-muted-foreground">{fn(g.unit_count)} units</p>
                  </div>
                </>
              ) : (
                /* ── Commercial: per-SF pricing ── */
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <NumInput label="# Units" value={g.unit_count} onChange={v => upd(g.id, { unit_count: v })} />
                    <NumInput label="SF / Unit" value={g.sf_per_unit} onChange={v => upd(g.id, { sf_per_unit: v })} />
                    <NumInput label="Current Rent / SF / Yr" value={g.current_rent_per_sf} onChange={v => upd(g.id, { current_rent_per_sf: v })} prefix="$" decimals={2} />
                    <NumInput label="Market Rent / SF / Yr" value={g.market_rent_per_sf} onChange={v => upd(g.id, { market_rent_per_sf: v })} prefix="$" decimals={2} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Lease Type</label>
                      <select value={g.lease_type} onChange={e => upd(g.id, { lease_type: e.target.value as LeaseType })} className="w-full px-2 py-1.5 text-sm border rounded-md bg-background outline-none focus:ring-2 focus:ring-ring">
                        <option value="NNN">NNN — Triple Net</option>
                        <option value="MG">MG — Modified Gross</option>
                        <option value="Gross">Gross</option>
                        <option value="Modified Gross">Modified Gross (Custom)</option>
                      </select>
                    </div>
                    <NumInput label="Expense Reimb. / SF / Yr" value={g.expense_reimbursement_per_sf} onChange={v => upd(g.id, { expense_reimbursement_per_sf: v })} prefix="$" decimals={2} />
                    <div className="p-3 bg-muted/50 rounded-lg text-xs">
                      <p className="text-muted-foreground mb-1">Annual Revenue</p>
                      <p className="font-semibold">{fc(g.unit_count * g.sf_per_unit * g.market_rent_per_sf)}</p>
                      <p className="text-muted-foreground">{fn(g.unit_count * g.sf_per_unit)} SF total</p>
                    </div>
                  </div>
                </>
              )}
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={g.will_renovate} onChange={e => upd(g.id, { will_renovate: e.target.checked })} className="rounded" />
                Include renovation CapEx
              </label>
              {g.will_renovate && <NumInput label="Renovation Cost / Unit" value={g.renovation_cost_per_unit} onChange={v => upd(g.id, { renovation_cost_per_unit: v })} prefix="$" className="max-w-xs" />}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setData(p => ({ ...p, unit_groups: [...p.unit_groups, newGroup()] }))}>
            <Plus className="h-4 w-4 mr-2" /> {isMF ? "Add Unit Type" : "Add Unit Group / Space"}
          </Button>
        </div>
      </Section>

      <Section title="Capital Expenditures" icon={<Hammer className="h-4 w-4 text-orange-600" />} open={false}>
        <div className="space-y-3 mt-3">
          {data.capex_items.length === 0 && <p className="text-sm text-muted-foreground py-2">No CapEx items. Click + to add.</p>}
          {data.capex_items.map(c => (
            <div key={c.id} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <input type="text" value={c.label} onChange={e => updC(c.id, { label: e.target.value })} placeholder="e.g. Roof, HVAC, Site work" className="w-full px-2 py-1.5 text-sm border rounded-md bg-background outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="w-24"><NumInput label="Qty" value={c.quantity} onChange={v => updC(c.id, { quantity: v })} /></div>
              <div className="w-36"><NumInput label="Cost / Unit" value={c.cost_per_unit} onChange={v => updC(c.id, { cost_per_unit: v })} prefix="$" /></div>
              <div className="pb-1.5 w-24 text-right">
                <p className="text-xs text-muted-foreground mb-1">Total</p>
                <p className="text-sm font-semibold tabular-nums">{fc(c.quantity * c.cost_per_unit)}</p>
              </div>
              <button onClick={() => delC(c.id)} className="text-muted-foreground hover:text-destructive mb-0.5"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setData(p => ({ ...p, capex_items: [...p.capex_items, newCapex()] }))}>
                <Plus className="h-4 w-4 mr-2" /> Add Item
              </Button>
              <Button variant="outline" size="sm" onClick={estimateCapex} disabled={capexEstimating}>
                {capexEstimating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AI Estimate
              </Button>
            </div>
            {data.capex_items.length > 0 && <p className="text-sm font-semibold">Total: {fc(m.capexTotal)}</p>}
          </div>
        </div>
      </Section>

      <Section title="Operating Assumptions" icon={<Calculator className="h-4 w-4 text-blue-600" />}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-3">
          <NumInput label="Vacancy Rate" value={data.vacancy_rate} onChange={v => set("vacancy_rate", v)} suffix="%" decimals={1} />
          <NumInput label="Management Fee" value={data.management_fee_pct} onChange={v => set("management_fee_pct", v)} suffix="% EGI" decimals={1} />
          <NumInput label="Taxes (Annual)" value={data.taxes_annual} onChange={v => set("taxes_annual", v)} prefix="$" />
          <NumInput label="Insurance (Annual)" value={data.insurance_annual} onChange={v => set("insurance_annual", v)} prefix="$" />
          <NumInput label="Repairs (Annual)" value={data.repairs_annual} onChange={v => set("repairs_annual", v)} prefix="$" />
          <NumInput label="Utilities (Annual)" value={data.utilities_annual} onChange={v => set("utilities_annual", v)} prefix="$" />
          <NumInput label="Other Expenses" value={data.other_expenses_annual} onChange={v => set("other_expenses_annual", v)} prefix="$" />
          <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">Total OpEx</p><p className="text-sm font-semibold">{fc(m.totalOpEx)}</p><p className="text-xs text-muted-foreground">{m.egi > 0 ? ((m.totalOpEx / m.egi) * 100).toFixed(0) : 0}% of EGI</p></div>
          <div className="p-3 bg-muted/50 rounded-lg"><p className="text-xs text-muted-foreground mb-1">EGI</p><p className="text-sm font-semibold">{fc(m.egi)}</p><p className="text-xs text-muted-foreground">{fc(m.vacancyLoss)} vacancy loss</p></div>
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
        <div className="px-5 py-3 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Pro Forma Income Statement</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="text-left px-5 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide">Line Item</th>
              <th className="text-right px-5 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide w-36">Annual</th>
              {(isSH ? m.totalBeds > 0 : isMF ? m.totalUnits > 0 : m.totalSF > 0) && <th className="text-right px-5 py-2 font-medium text-xs text-muted-foreground uppercase tracking-wide w-28">{isSH ? "/ Bed" : isMF ? "/ Unit" : "/ SF"}</th>}
            </tr>
          </thead>
          <tbody>
            <TR label="Gross Potential Revenue" val={m.gpr} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} />
            <TR label={`Less Vacancy (${data.vacancy_rate}%)`} val={-m.vacancyLoss} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />
            <TR label="Effective Gross Income" val={m.egi} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} bold />
            {m.reimbursements > 0 && <>
              <TR label="Expense Reimbursements" val={m.reimbursements} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} />
              <TR label="Effective Revenue" val={m.effectiveRevenue} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} bold />
            </>}
            <tr><td colSpan={3} className="px-5"><div className="border-t" /></td></tr>
            <TR label={`Management (${data.management_fee_pct}%)`} val={-m.mgmtFee} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />
            <TR label="Property Taxes" val={-data.taxes_annual} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />
            <TR label="Insurance" val={-data.insurance_annual} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />
            <TR label="Repairs" val={-data.repairs_annual} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />
            {data.utilities_annual > 0 && <TR label="Utilities" val={-data.utilities_annual} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />}
            {data.other_expenses_annual > 0 && <TR label="Other Expenses" val={-data.other_expenses_annual} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />}
            <TR label="Total Operating Expenses" val={-m.totalOpEx} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} />
            <tr><td colSpan={3} className="px-5"><div className="border-t" /></td></tr>
            <TR label="Net Operating Income" val={m.noi} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} bold hi />
            {data.has_financing && <>
              <TR label="Annual Debt Service (Acq)" val={-m.acqDebt} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} muted />
              <tr><td colSpan={3} className="px-5"><div className="border-t" /></td></tr>
              <TR label="Cash Flow Before Tax" val={m.cashFlow} per={isSH ? m.totalBeds : isMF ? m.totalUnits : m.totalSF} bold hi={m.cashFlow > 0} />
            </>}
          </tbody>
        </table>
      </div>

      <div className="border rounded-xl bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">Notes</h3>
        <textarea value={data.notes} onChange={e => set("notes", e.target.value)} rows={3} className="w-full text-sm border rounded-lg p-3 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Assumptions, deal thesis, renovation scope..." />
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
  );
}
