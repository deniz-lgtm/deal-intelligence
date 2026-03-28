"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  BookOpen,
  Star,
  StarOff,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  MapPin,
  Target,
  Building2,
  TrendingUp,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  INVESTMENT_THESIS_LABELS,
  INVESTMENT_THESIS_DESCRIPTIONS,
  PREDEFINED_MARKETS,
  type InvestmentThesis,
  type PropertyType,
  type BusinessPlan,
} from "@/lib/types";

const ALL_THESES: InvestmentThesis[] = ["value_add", "ground_up", "core", "core_plus", "opportunistic"];

const PROPERTY_TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "industrial", label: "Industrial" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "multifamily", label: "Multifamily" },
  { value: "student_housing", label: "Student Housing" },
  { value: "mixed_use", label: "Mixed Use" },
  { value: "land", label: "Land" },
  { value: "hospitality", label: "Hospitality" },
  { value: "other", label: "Other" },
];

// ─── Plan Form ─────────────────────────────────────────────────────────────

function PlanForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<BusinessPlan>;
  onSave: (data: Partial<BusinessPlan>) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [theses, setTheses] = useState<InvestmentThesis[]>(initial?.investment_theses ?? []);
  const [markets, setMarkets] = useState<string[]>(initial?.target_markets ?? []);
  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>(initial?.property_types ?? []);
  const [holdMin, setHoldMin] = useState(initial?.hold_period_min?.toString() ?? "");
  const [holdMax, setHoldMax] = useState(initial?.hold_period_max?.toString() ?? "");
  const [irrMin, setIrrMin] = useState(initial?.target_irr_min?.toString() ?? "");
  const [irrMax, setIrrMax] = useState(initial?.target_irr_max?.toString() ?? "");
  const [emMin, setEmMin] = useState(initial?.target_equity_multiple_min?.toString() ?? "");
  const [emMax, setEmMax] = useState(initial?.target_equity_multiple_max?.toString() ?? "");
  const [customMarket, setCustomMarket] = useState("");
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);

  const toggleThesis = (t: InvestmentThesis) =>
    setTheses((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const togglePropertyType = (t: PropertyType) =>
    setPropertyTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const addMarket = (m: string) => {
    const trimmed = m.trim();
    if (trimmed && !markets.includes(trimmed)) {
      setMarkets((prev) => [...prev, trimmed]);
    }
    setCustomMarket("");
    setShowMarketDropdown(false);
  };

  const removeMarket = (m: string) => setMarkets((prev) => prev.filter((x) => x !== m));

  const filteredPredefined = PREDEFINED_MARKETS.filter(
    (m) => !markets.includes(m) && m.toLowerCase().includes(customMarket.toLowerCase())
  );

  async function handleSave() {
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      description: description.trim(),
      is_default: isDefault,
      investment_theses: theses,
      target_markets: markets,
      property_types: propertyTypes,
      hold_period_min: holdMin ? Number(holdMin) : null,
      hold_period_max: holdMax ? Number(holdMax) : null,
      target_irr_min: irrMin ? Number(irrMin) : null,
      target_irr_max: irrMax ? Number(irrMax) : null,
      target_equity_multiple_min: emMin ? Number(emMin) : null,
      target_equity_multiple_max: emMax ? Number(emMax) : null,
    });
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      {/* Plan Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
          Plan Name *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Flexbay Value-Add Strategy"
          className="input-field"
        />
      </div>

      {/* Investment Thesis Checkboxes */}
      <div className="flex flex-col gap-2">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Investment Thesis
        </label>
        <p className="text-2xs text-muted-foreground">Select the strategies that apply to this plan.</p>
        <div className="grid gap-2">
          {ALL_THESES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleThesis(t)}
              className={cn(
                "flex items-start gap-3 text-left px-3.5 py-3 rounded-lg border transition-all duration-150",
                theses.includes(t)
                  ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                  : "bg-muted/20 border-border/40 hover:bg-muted/40"
              )}
            >
              <div className={cn(
                "h-4.5 w-4.5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                theses.includes(t)
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/30"
              )}>
                {theses.includes(t) && <Check className="h-3 w-3" />}
              </div>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", theses.includes(t) && "text-primary")}>
                  {INVESTMENT_THESIS_LABELS[t]}
                </p>
                <p className="text-2xs text-muted-foreground mt-0.5 leading-relaxed">
                  {INVESTMENT_THESIS_DESCRIPTIONS[t]}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Property Types */}
      <div className="flex flex-col gap-2">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Target Property Types
        </label>
        <div className="flex flex-wrap gap-2">
          {PROPERTY_TYPE_OPTIONS.map((pt) => (
            <button
              key={pt.value}
              type="button"
              onClick={() => togglePropertyType(pt.value)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg border transition-all duration-150",
                propertyTypes.includes(pt.value)
                  ? "bg-primary/10 border-primary/30 text-primary font-medium"
                  : "bg-muted/20 border-border/40 text-muted-foreground hover:bg-muted/40"
              )}
            >
              {pt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target Markets */}
      <div className="flex flex-col gap-2">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          Target Markets
        </label>

        {/* Selected markets */}
        {markets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {markets.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"
              >
                {m}
                <button
                  type="button"
                  onClick={() => removeMarket(m)}
                  className="hover:text-red-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Market search/add */}
        <div className="relative">
          <input
            type="text"
            value={customMarket}
            onChange={(e) => {
              setCustomMarket(e.target.value);
              setShowMarketDropdown(true);
            }}
            onFocus={() => setShowMarketDropdown(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customMarket.trim()) {
                e.preventDefault();
                addMarket(customMarket);
              }
            }}
            placeholder="Search or type a custom market..."
            className="input-field text-sm"
          />
          {showMarketDropdown && customMarket.length > 0 && filteredPredefined.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-card border border-border rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
              {filteredPredefined.slice(0, 10).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => addMarket(m)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  {m}
                </button>
              ))}
              {customMarket.trim() && !PREDEFINED_MARKETS.includes(customMarket.trim()) && (
                <button
                  type="button"
                  onClick={() => addMarket(customMarket)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 text-primary font-medium border-t border-border/40"
                >
                  + Add &quot;{customMarket.trim()}&quot;
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Return Targets */}
      <div className="flex flex-col gap-2">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          Return Targets
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-2xs text-muted-foreground">Target IRR (%)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={irrMin}
                onChange={(e) => setIrrMin(e.target.value)}
                placeholder="Min"
                className="input-field text-sm tabular-nums flex-1"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="number"
                step="0.1"
                value={irrMax}
                onChange={(e) => setIrrMax(e.target.value)}
                placeholder="Max"
                className="input-field text-sm tabular-nums flex-1"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-2xs text-muted-foreground">Equity Multiple (x)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={emMin}
                onChange={(e) => setEmMin(e.target.value)}
                placeholder="Min"
                className="input-field text-sm tabular-nums flex-1"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="number"
                step="0.1"
                value={emMax}
                onChange={(e) => setEmMax(e.target.value)}
                placeholder="Max"
                className="input-field text-sm tabular-nums flex-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Hold Period */}
      <div className="flex flex-col gap-2">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Hold Period (years)
        </label>
        <div className="flex items-center gap-2 max-w-xs">
          <input
            type="number"
            value={holdMin}
            onChange={(e) => setHoldMin(e.target.value)}
            placeholder="Min"
            className="input-field text-sm tabular-nums flex-1"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="number"
            value={holdMax}
            onChange={(e) => setHoldMax(e.target.value)}
            placeholder="Max"
            className="input-field text-sm tabular-nums flex-1"
          />
        </div>
      </div>

      {/* Strategy Description */}
      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
          Additional Strategy Notes
        </label>
        <p className="text-2xs text-muted-foreground">
          Additional context the AI should know — constraints, deal-breakers, special instructions.
        </p>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`e.g. We source our own CapEx budgets and do not rely on broker estimates. Vacancy is always intentional at acquisition for value-add deals — do not flag as a risk. Standard due diligence items like environmental Phase I, title, and survey are handled post-LOI.`}
          className="min-h-[100px] resize-none text-sm"
        />
      </div>

      {/* Default toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsDefault((v) => !v)}
          className={cn(
            "flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all duration-150",
            isDefault
              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50"
          )}
        >
          {isDefault ? (
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          ) : (
            <StarOff className="h-3.5 w-3.5" />
          )}
          {isDefault ? "Default plan" : "Not default"}
        </button>
        <span className="text-2xs text-muted-foreground">
          Default plan is auto-selected for new deals.
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? (
            "Saving..."
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Save Plan
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Plan Card ─────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  onUpdate,
  onDelete,
  onSetDefault,
}: {
  plan: BusinessPlan;
  onUpdate: (id: string, data: Partial<BusinessPlan>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  async function handleSave(data: Partial<BusinessPlan>) {
    setSaving(true);
    await onUpdate(plan.id, data);
    setSaving(false);
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${plan.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await onDelete(plan.id);
  }

  async function handleSetDefault() {
    setSettingDefault(true);
    await onSetDefault(plan.id);
    setSettingDefault(false);
  }

  const theses = plan.investment_theses || [];
  const markets = plan.target_markets || [];
  const propTypes = plan.property_types || [];
  const hasReturnTargets = plan.target_irr_min || plan.target_irr_max || plan.target_equity_multiple_min || plan.target_equity_multiple_max;
  const hasHoldPeriod = plan.hold_period_min || plan.hold_period_max;

  return (
    <Card className={cn("transition-all duration-200", plan.is_default && "ring-1 ring-amber-500/30 shadow-lifted")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
              plan.is_default ? "bg-primary/10" : "bg-muted/30"
            )}>
              <BookOpen className={cn("h-4 w-4", plan.is_default ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base leading-tight font-display">{plan.name}</CardTitle>
                {plan.is_default && (
                  <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    Default
                  </span>
                )}
              </div>
              <p className="text-2xs text-muted-foreground mt-0.5">
                Updated {new Date(plan.updated_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {!plan.is_default && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-amber-400"
                onClick={handleSetDefault}
                disabled={settingDefault}
                title="Set as default"
              >
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing((v) => !v)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-400"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {editing ? (
          <PlanForm
            initial={plan}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            saving={saving}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* Thesis badges */}
            {theses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {theses.map((t) => (
                  <span
                    key={t}
                    className="text-2xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium"
                  >
                    {INVESTMENT_THESIS_LABELS[t as InvestmentThesis] || t}
                  </span>
                ))}
              </div>
            )}

            {/* Property types */}
            {propTypes.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Building2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="text-2xs text-muted-foreground">
                  {propTypes.map((p) => {
                    const opt = PROPERTY_TYPE_OPTIONS.find((o) => o.value === p);
                    return opt?.label || p;
                  }).join(", ")}
                </span>
              </div>
            )}

            {/* Markets */}
            {markets.length > 0 && (
              <div className="flex items-start gap-1.5 flex-wrap">
                <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-1">
                  {markets.map((m) => (
                    <span key={m} className="text-2xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Return targets & hold period */}
            <div className="flex items-center gap-4 flex-wrap">
              {hasReturnTargets && (
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3 text-muted-foreground" />
                  <span className="text-2xs text-muted-foreground">
                    {plan.target_irr_min || plan.target_irr_max
                      ? `IRR ${plan.target_irr_min ?? "?"}–${plan.target_irr_max ?? "?"}%`
                      : ""}
                    {(plan.target_irr_min || plan.target_irr_max) && (plan.target_equity_multiple_min || plan.target_equity_multiple_max) ? " · " : ""}
                    {plan.target_equity_multiple_min || plan.target_equity_multiple_max
                      ? `EM ${plan.target_equity_multiple_min ?? "?"}–${plan.target_equity_multiple_max ?? "?"}x`
                      : ""}
                  </span>
                </div>
              )}
              {hasHoldPeriod && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-2xs text-muted-foreground">
                    {plan.hold_period_min && plan.hold_period_max
                      ? `${plan.hold_period_min}–${plan.hold_period_max} yr hold`
                      : plan.hold_period_min
                        ? `${plan.hold_period_min}+ yr hold`
                        : `Up to ${plan.hold_period_max} yr hold`}
                  </span>
                </div>
              )}
            </div>

            {/* Description */}
            {plan.description && (
              <div>
                <div
                  className={cn(
                    "text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap",
                    !expanded && "line-clamp-3"
                  )}
                >
                  {plan.description}
                </div>
                {plan.description.length > 200 && (
                  <button
                    onClick={() => setExpanded((v) => !v)}
                    className="flex items-center gap-1 text-xs text-primary mt-1.5 hover:underline"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        Show more
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function BusinessPlansPage() {
  const [plans, setPlans] = useState<BusinessPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      const res = await fetch("/api/business-plans");
      const json = await res.json();
      if (json.data) setPlans(json.data);
    } catch (err) {
      console.error("Failed to load business plans:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(data: Partial<BusinessPlan>) {
    setSaving(true);
    try {
      const res = await fetch("/api/business-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (data.is_default) {
        await loadPlans();
      } else {
        setPlans((prev) => [json.data, ...prev]);
      }
      setCreating(false);
    } catch (err) {
      console.error("Failed to create plan:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, data: Partial<BusinessPlan>) {
    try {
      const res = await fetch(`/api/business-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if ("is_default" in data) {
        await loadPlans();
      } else {
        setPlans((prev) =>
          prev.map((p) => (p.id === id ? { ...p, ...json.data } : p))
        );
      }
    } catch (err) {
      console.error("Failed to update plan:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/business-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Failed to delete plan:", err);
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/business-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setDefault" }),
      });
      if (!res.ok) throw new Error("Failed to set default");
      await loadPlans();
    } catch (err) {
      console.error("Failed to set default:", err);
    }
  }

  return (
    <div className="min-h-screen bg-background noise">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="h-8 w-8 rounded-lg bg-muted/30 flex items-center justify-center hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="font-display text-sm leading-none">Business Plans</h1>
              <p className="text-2xs text-muted-foreground mt-0.5">Investment strategy library</p>
            </div>
          </div>
          {!creating && (
            <Button
              size="sm"
              className="font-semibold h-8 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Plan
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">
        {/* Explainer */}
        <div className="bg-primary/[0.05] border border-primary/15 rounded-xl p-4 text-sm text-muted-foreground leading-relaxed">
          <p className="font-display text-foreground mb-1">What are Business Plans?</p>
          <p>
            Define your investment strategy once — thesis, target markets, property types, return targets —
            and apply it to deals. The AI uses your plan to calibrate analysis, score deals against your
            criteria, and generate documents that reflect your strategy. The <strong className="text-foreground">default plan</strong> is
            auto-selected when creating new deals.
          </p>
        </div>

        {/* Create form */}
        {creating && (
          <Card className="border-primary/20 bg-primary/[0.03]">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base font-display">
                <Plus className="h-4 w-4 text-primary" />
                New Business Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PlanForm
                onSave={handleCreate}
                onCancel={() => setCreating(false)}
                saving={saving}
              />
            </CardContent>
          </Card>
        )}

        {/* Plans list */}
        {loading ? (
          <div className="flex flex-col gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-36 rounded-xl border border-border/40 bg-card/30 animate-pulse shadow-card" />
            ))}
          </div>
        ) : plans.length === 0 && !creating ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <h2 className="font-display text-lg mb-1.5">No business plans yet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Create a plan to define your investment thesis, target markets, and return criteria.
              Apply it to deals for consistent analysis.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first plan
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
