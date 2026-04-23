"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, FileText, Loader2, Sparkles, XCircle, BookOpen, Star, ChevronDown, ExternalLink, Target, MapPin, TrendingUp, Clock, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DealStatus, PropertyType, BusinessPlan, InvestmentThesis, DealScope } from "@/lib/types";
import {
  INVESTMENT_THESIS_LABELS,
  INVESTMENT_THESIS_DESCRIPTIONS,
  DEAL_SCOPE_LABELS,
  DEAL_SCOPE_DESCRIPTIONS,
  suggestScopeFromStrategy,
} from "@/lib/types";

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "multifamily", label: "Multifamily" },
  { value: "sfr", label: "SFR" },
  { value: "student_housing", label: "Student Housing" },
  { value: "industrial", label: "Industrial" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "mixed_use", label: "Mixed Use" },
  { value: "land", label: "Land" },
  { value: "hospitality", label: "Hospitality" },
  { value: "other", label: "Other" },
];

const STATUSES: { value: DealStatus; label: string }[] = [
  { value: "sourcing", label: "Sourcing" },
  { value: "screening", label: "Screening" },
  { value: "loi", label: "LOI" },
  { value: "under_contract", label: "Under Contract" },
  { value: "diligence", label: "Diligence" },
  { value: "closing", label: "Closing" },
];

const STRATEGY_OPTIONS: { value: InvestmentThesis; label: string; desc: string }[] = [
  { value: "value_add", label: INVESTMENT_THESIS_LABELS.value_add, desc: INVESTMENT_THESIS_DESCRIPTIONS.value_add },
  { value: "ground_up", label: INVESTMENT_THESIS_LABELS.ground_up, desc: INVESTMENT_THESIS_DESCRIPTIONS.ground_up },
  { value: "core", label: INVESTMENT_THESIS_LABELS.core, desc: INVESTMENT_THESIS_DESCRIPTIONS.core },
  { value: "core_plus", label: INVESTMENT_THESIS_LABELS.core_plus, desc: INVESTMENT_THESIS_DESCRIPTIONS.core_plus },
  { value: "opportunistic", label: INVESTMENT_THESIS_LABELS.opportunistic, desc: INVESTMENT_THESIS_DESCRIPTIONS.opportunistic },
];

const SCOPE_OPTIONS: { value: DealScope; label: string; desc: string }[] = [
  { value: "acquisition", label: DEAL_SCOPE_LABELS.acquisition, desc: DEAL_SCOPE_DESCRIPTIONS.acquisition },
  { value: "value_add_expansion", label: DEAL_SCOPE_LABELS.value_add_expansion, desc: DEAL_SCOPE_DESCRIPTIONS.value_add_expansion },
  { value: "ground_up", label: DEAL_SCOPE_LABELS.ground_up, desc: DEAL_SCOPE_DESCRIPTIONS.ground_up },
];

// Only fields that actually flow into downstream features. Legacy fields that
// were never read (entitlement_status, environmental_phase, demolition_required,
// expected_delivery, bedrooms) have been removed — those are tracked on the
// diligence checklist, dev schedule, or underwriting where they're actually used.
const EMPTY_FORM = {
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  property_type: "multifamily" as PropertyType,
  investment_strategy: "" as string,
  deal_scope: "" as string,
  status: "sourcing" as DealStatus,
  asking_price: "",
  square_footage: "",
  units: "",
  year_built: "",
  notes: "",
  land_acres: "",
};

export default function NewDealPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [omFile, setOmFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [listingUrl, setListingUrl] = useState("");
  const [extractingUrl, setExtractingUrl] = useState(false);
  const [enrichingAddress, setEnrichingAddress] = useState(false);

  // Business plan state
  const [plans, setPlans] = useState<BusinessPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [showPlanDropdown, setShowPlanDropdown] = useState(false);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/business-plans");
        const json = await res.json();
        if (json.data) {
          setPlans(json.data);
          const defaultPlan = json.data.find((p: BusinessPlan) => p.is_default);
          if (defaultPlan) setSelectedPlanId(defaultPlan.id);
        }
      } catch {
        // ignore
      } finally {
        setLoadingPlans(false);
      }
    }
    loadPlans();
  }, []);

  const set = (field: string, value: string) =>
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // When a user picks (or an extractor sets) an investment strategy, suggest
      // the matching scope — but only if the user hasn't already chosen one.
      if (field === "investment_strategy" && !prev.deal_scope) {
        const suggested = suggestScopeFromStrategy(value as InvestmentThesis | "");
        if (suggested) next.deal_scope = suggested;
      }
      return next;
    });

  async function handleOmFile(file: File) {
    if (!file.name.match(/\.(pdf|docx?)$/i)) {
      setExtractError("Only PDF or DOCX files are supported");
      return;
    }
    setOmFile(file);
    setExtracting(true);
    setExtractError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/om-extract", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed");

      const d = json.data;
      setForm((prev) => ({
        ...prev,
        name: d.name || prev.name,
        address: d.address || prev.address,
        city: d.city || prev.city,
        state: d.state || prev.state,
        zip: d.zip || prev.zip,
        property_type: d.property_type || prev.property_type,
        year_built: d.year_built ? String(d.year_built) : prev.year_built,
        square_footage: d.square_footage ? String(d.square_footage) : prev.square_footage,
        units: d.units ? String(d.units) : prev.units,
        asking_price: d.asking_price ? String(d.asking_price) : prev.asking_price,
      }));
      toast.success("OM data extracted — review and edit below");
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  // Enrich from address when the user has no OM and no listing URL. Uses
  // Claude web_search against public records / listing aggregators. Only fills
  // blanks — never overwrites fields the user has already typed.
  async function handleEnrichAddress() {
    const { address, city, state, zip, property_type } = form;
    if (!address || !city || !state) {
      toast.error("Enter address, city, and state first");
      return;
    }
    setEnrichingAddress(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/address-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, city, state, zip, property_type }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Enrichment failed");

      const d = json.data;
      const filled: string[] = [];
      setForm((prev) => {
        const next = { ...prev };
        // Only fill blanks — don't overwrite user-entered values.
        if (!prev.name && d.name) { next.name = d.name; filled.push("name"); }
        if (prev.property_type === "multifamily" && d.property_type) { next.property_type = d.property_type; filled.push("property type"); }
        if (!prev.year_built && d.year_built) { next.year_built = String(d.year_built); filled.push("year built"); }
        if (!prev.square_footage && d.square_footage) { next.square_footage = String(d.square_footage); filled.push("SF"); }
        if (!prev.units && d.units) { next.units = String(d.units); filled.push("units"); }
        if (!prev.asking_price && d.asking_price) { next.asking_price = String(d.asking_price); filled.push("asking price"); }
        if (!prev.notes && d.description) { next.notes = `Public-records lookup:\n${d.description}${d.notes ? `\n\n${d.notes}` : ""}`; }
        return next;
      });

      if (filled.length === 0) {
        toast(d.notes || "No additional details found for this address");
      } else {
        toast.success(`Filled: ${filled.join(", ")}`);
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Failed to enrich from address");
    } finally {
      setEnrichingAddress(false);
    }
  }

  async function handleListingUrl(url: string) {
    if (!url.trim()) return;
    setExtractingUrl(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/listing-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed");

      const d = json.data;
      setForm((prev) => ({
        ...prev,
        name: d.name || prev.name,
        address: d.address || prev.address,
        city: d.city || prev.city,
        state: d.state || prev.state,
        zip: d.zip || prev.zip,
        property_type: d.property_type || prev.property_type,
        investment_strategy: d.investment_strategy || prev.investment_strategy,
        year_built: d.year_built ? String(d.year_built) : prev.year_built,
        square_footage: d.square_footage ? String(d.square_footage) : prev.square_footage,
        units: d.units ? String(d.units) : prev.units,
        asking_price: d.asking_price ? String(d.asking_price) : prev.asking_price,
        notes: d.description ? `${prev.notes ? prev.notes + "\n" : ""}Source: ${url.trim()}\n${d.description}` : prev.notes,
      }));
      toast.success("Listing data extracted — review and edit below");
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Failed to extract listing");
    } finally {
      setExtractingUrl(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Deal name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          square_footage: form.square_footage ? Number(form.square_footage) : null,
          units: form.units ? Number(form.units) : null,
          year_built: form.year_built ? Number(form.year_built) : null,
          land_acres: form.land_acres ? Number(form.land_acres) : null,
          investment_strategy: form.investment_strategy || null,
          deal_scope: form.deal_scope || null,
          business_plan_id: selectedPlanId,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.data) {
        toast.error(json.error || "Failed to create deal");
        setSaving(false);
        return;
      }

      const dealId = json.data.id;

      if (omFile) {
        const fd = new FormData();
        fd.append("file", omFile);
        // Pass business plan context so initial OM analysis is calibrated to strategy
        if (selectedPlanId) {
          const plan = plans.find(p => p.id === selectedPlanId);
          if (plan) {
            const ctxParts: string[] = [`BASE BUSINESS PLAN — ${plan.name}:`];
            if ((plan.investment_theses || []).length > 0) ctxParts.push(`Investment Thesis: ${plan.investment_theses.map((t: string) => t.replace(/_/g, ' ')).join(', ')}`);
            if ((plan.target_markets || []).length > 0) ctxParts.push(`Target Markets: ${plan.target_markets.join(', ')}`);
            if ((plan.property_types || []).length > 0) ctxParts.push(`Property Types: ${plan.property_types.join(', ')}`);
            if (plan.target_irr_min || plan.target_irr_max) ctxParts.push(`Target IRR: ${plan.target_irr_min ?? '?'}% – ${plan.target_irr_max ?? '?'}%`);
            if (plan.hold_period_min || plan.hold_period_max) ctxParts.push(`Hold Period: ${plan.hold_period_min ?? '?'}–${plan.hold_period_max ?? '?'} years`);
            if (plan.description?.trim()) ctxParts.push(`Strategy Notes: ${plan.description.trim()}`);
            fd.append("deal_context", ctxParts.join('\n'));
          }
        }
        await fetch(`/api/deals/${dealId}/om-init`, { method: "POST", body: fd });
        router.push(`/deals/${dealId}/om-analysis`);
      } else {
        // Auto-run AI zoning report when the scope involves new construction
        // (ground-up scope is the primary signal; legacy ground_up strategy still triggers it).
        const wantsZoningReport =
          form.deal_scope === "ground_up" ||
          (!form.deal_scope && form.investment_strategy === "ground_up");
        if (wantsZoningReport && form.address) {
          toast.success("Deal created — running AI zoning report...");
          fetch(`/api/deals/${dealId}/zoning-report`, { method: "POST" }).catch(() => {});
          router.push(`/deals/${dealId}/site-zoning`);
        } else {
          toast.success("Deal created with diligence checklist");
          router.push(`/deals/${dealId}`);
        }
      }
    } catch {
      toast.error("Something went wrong");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background noise">
      <header className="border-b border-border/40 bg-card/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-xs h-8">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back
            </Button>
          </Link>
          <div className="h-4 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h1 className="font-nameplate text-base leading-none tracking-tight">New Deal</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="font-nameplate text-3xl leading-none tracking-tight">Create a new deal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            A diligence checklist with 65+ items will be automatically created.
          </p>
        </div>

        {/* OM Upload Zone */}
        <div className="mb-8">
          {omFile ? (
            <div
              className={cn(
                "border border-border/60 rounded-xl p-4 flex items-center gap-3 transition-colors",
                extracting
                  ? "bg-primary/5 border-primary/20"
                  : "bg-emerald-500/10 border-emerald-500/20"
              )}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                  extracting ? "bg-primary/10" : "bg-emerald-500/10"
                )}
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{omFile.name}</p>
                <p className="text-2xs text-muted-foreground">
                  {extracting
                    ? "Extracting deal details from OM..."
                    : "Fields auto-filled from OM — review below"}
                </p>
              </div>
              {!extracting && (
                <button
                  type="button"
                  onClick={() => {
                    setOmFile(null);
                    setExtractError(null);
                    setForm(EMPTY_FORM);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all duration-200",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border/60 hover:border-primary/40 hover:bg-muted/20"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleOmFile(file);
              }}
              onClick={() => inputRef.current?.click()}
            >
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  Upload OM to auto-fill details{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </p>
                <p className="text-2xs text-muted-foreground mt-1">
                  Drag & drop or click — PDF or DOCX. AI extracts address, price, size, and more.
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleOmFile(file);
                }}
              />
            </div>
          )}
          {/* Listing URL input */}
          {!omFile && !extracting && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-2xs text-muted-foreground uppercase tracking-wider">or paste a listing link</span>
                <div className="flex-1 h-px bg-border/40" />
              </div>
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex-1 flex items-center gap-2 border rounded-lg px-3 py-2 transition-colors",
                  extractingUrl ? "bg-primary/5 border-primary/20" : "border-border/60 hover:border-primary/40"
                )}>
                  <Link2 className={cn("h-4 w-4 flex-shrink-0", extractingUrl ? "text-primary" : "text-muted-foreground")} />
                  <input
                    type="url"
                    value={listingUrl}
                    onChange={(e) => setListingUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleListingUrl(listingUrl); } }}
                    placeholder="https://www.loopnet.com/listing/... or any listing URL"
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
                    disabled={extractingUrl}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleListingUrl(listingUrl)}
                  disabled={extractingUrl || !listingUrl.trim()}
                  className="h-[38px] shrink-0"
                >
                  {extractingUrl ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Extracting...</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Extract</>
                  )}
                </Button>
              </div>
              <p className="text-2xs text-muted-foreground mt-1.5">
                LoopNet, Crexi, CoStar, or any property listing — AI extracts deal details automatically
              </p>
            </div>
          )}
          {extractError && (
            <p className="text-2xs text-red-400 mt-2 flex items-center gap-1">
              <XCircle className="h-3 w-3" />
              {extractError}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Business Plan Selection */}
          <Section title="Business Plan">
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Optionally link a business plan to this deal. The plan&apos;s strategy will be used for analysis and documentation.
              </p>
              {loadingPlans ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading plans...
                </div>
              ) : plans.length === 0 ? (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">No business plans created yet.</span>
                  <Link href="/business-plans" target="_blank" className="text-xs text-primary hover:underline flex items-center gap-1 ml-auto">
                    <ExternalLink className="h-3 w-3" />
                    Create one
                  </Link>
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPlanDropdown((v) => !v)}
                    className={cn(
                      "w-full text-left flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg border transition-all",
                      selectedPlan
                        ? "bg-primary/5 border-primary/20"
                        : "bg-muted/20 border-border/40 hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BookOpen className={cn("h-4 w-4 flex-shrink-0", selectedPlan ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-sm truncate", selectedPlan ? "font-medium" : "text-muted-foreground")}>
                        {selectedPlan ? selectedPlan.name : "No business plan (optional)"}
                      </span>
                      {selectedPlan?.is_default && (
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400 flex-shrink-0" />
                      )}
                    </div>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showPlanDropdown && "rotate-180")} />
                  </button>
                  {showPlanDropdown && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-lg py-1 max-h-72 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => { setSelectedPlanId(null); setShowPlanDropdown(false); }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-muted/50 text-sm text-muted-foreground"
                      >
                        No business plan
                      </button>
                      {plans.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setSelectedPlanId(p.id); setShowPlanDropdown(false); }}
                          className={cn(
                            "w-full text-left px-3.5 py-2.5 hover:bg-muted/50 transition-colors",
                            selectedPlanId === p.id && "bg-primary/5"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {p.is_default && <Star className="h-3 w-3 fill-amber-400 text-amber-400 flex-shrink-0" />}
                            <span className="text-sm font-medium truncate">{p.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {(p.investment_theses || []).map((t) => (
                              <span key={t} className="text-2xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                {INVESTMENT_THESIS_LABELS[t as InvestmentThesis] || t}
                              </span>
                            ))}
                            {(p.target_markets || []).length > 0 && (
                              <span className="text-2xs text-muted-foreground">
                                {(p.target_markets || []).slice(0, 3).join(", ")}
                                {(p.target_markets || []).length > 3 && ` +${(p.target_markets || []).length - 3}`}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Selected plan summary — only show if plan has structured data */}
              {selectedPlan && ((selectedPlan.investment_theses || []).length > 0 || (selectedPlan.target_markets || []).length > 0 || selectedPlan.target_irr_min || selectedPlan.description) && (
                <div className="rounded-lg border border-primary/15 bg-primary/[0.03] p-3 flex flex-col gap-2">
                  {(selectedPlan.investment_theses || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedPlan.investment_theses || []).map((t) => (
                        <span key={t} className="text-2xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium">
                          {INVESTMENT_THESIS_LABELS[t as InvestmentThesis] || t}
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedPlan.description && (
                    <p className="text-2xs text-muted-foreground leading-relaxed line-clamp-2">{selectedPlan.description}</p>
                  )}
                  <div className="flex items-center gap-4 flex-wrap text-2xs text-muted-foreground">
                    {(selectedPlan.target_markets || []).length > 0 && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {(selectedPlan.target_markets || []).join(", ")}
                      </span>
                    )}
                    {(selectedPlan.target_irr_min || selectedPlan.target_irr_max) && (
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        IRR {selectedPlan.target_irr_min ?? "?"}–{selectedPlan.target_irr_max ?? "?"}%
                      </span>
                    )}
                    {(selectedPlan.hold_period_min || selectedPlan.hold_period_max) && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {selectedPlan.hold_period_min}–{selectedPlan.hold_period_max} yr
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Basic Info */}
          <Section title="Basic Information">
            <div className="grid gap-4">
              <Field label="Deal Name *">
                <input
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Hawthorne Industrial, 123 Main St"
                  className="input-field"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Property Type">
                  <select
                    value={form.property_type}
                    onChange={(e) => set("property_type", e.target.value)}
                    className="input-field"
                  >
                    {PROPERTY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={form.status}
                    onChange={(e) => set("status", e.target.value)}
                    className="input-field"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Investment Strategy">
                  <select
                    value={form.investment_strategy}
                    onChange={(e) => set("investment_strategy", e.target.value)}
                    className="input-field"
                  >
                    <option value="">Select strategy...</option>
                    {STRATEGY_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Deal Scope">
                  <select
                    value={form.deal_scope}
                    onChange={(e) => setForm((prev) => ({ ...prev, deal_scope: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">Select scope...</option>
                    {SCOPE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {form.deal_scope && (() => {
                // Surface an explicit Redevelopment indicator so the user
                // knows WHY the Redevelopment Inputs section below appears
                // (or doesn't). Acquisitions get a matching "no redev" note.
                const isRedev =
                  form.deal_scope === "ground_up" || form.deal_scope === "value_add_expansion";
                return (
                  <div className="flex items-center gap-2 -mt-2">
                    <span
                      className={`text-2xs font-medium px-2 py-0.5 rounded-full border ${
                        isRedev
                          ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                          : "bg-muted/30 text-muted-foreground border-border/40"
                      }`}
                    >
                      {isRedev ? "Redevelopment" : "No redevelopment"}
                    </span>
                    <p className="text-2xs text-muted-foreground">
                      {isRedev
                        ? DEAL_SCOPE_DESCRIPTIONS[form.deal_scope as DealScope]
                        : "Site / development inputs are hidden — just the underwriting fundamentals."}
                    </p>
                  </div>
                );
              })()}
            </div>
          </Section>

          {/* Location */}
          <Section title="Location">
            <div className="grid gap-4">
              <Field label="Street Address">
                <input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="123 Industrial Ave"
                  className="input-field"
                />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="City" className="col-span-1">
                  <input
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Hawthorne"
                    className="input-field"
                  />
                </Field>
                <Field label="State">
                  <input
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                    placeholder="CA"
                    maxLength={2}
                    className="input-field"
                  />
                </Field>
                <Field label="ZIP">
                  <input
                    value={form.zip}
                    onChange={(e) => set("zip", e.target.value)}
                    placeholder="90250"
                    className="input-field"
                  />
                </Field>
              </div>
              {/* AI enrichment from address — for deals with no OM and no listing URL. */}
              {!omFile && (
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
                  <div className="text-2xs text-muted-foreground">
                    No OM or listing URL? Let AI look up public records + listings for this address.
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleEnrichAddress}
                    disabled={enrichingAddress || !form.address || !form.city || !form.state}
                    className="h-8 shrink-0"
                  >
                    {enrichingAddress ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Looking up...</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Enrich from address</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </Section>

          {/* Property Snapshot — optional financial/physical details. */}
          <Section title="Property Snapshot">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Asking Price ($)">
                <input
                  type="number"
                  value={form.asking_price}
                  onChange={(e) => set("asking_price", e.target.value)}
                  placeholder="5000000"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Square Footage (SF)">
                <input
                  type="number"
                  value={form.square_footage}
                  onChange={(e) => set("square_footage", e.target.value)}
                  placeholder="25000"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Units">
                <input
                  type="number"
                  value={form.units}
                  onChange={(e) => set("units", e.target.value)}
                  placeholder="24"
                  className="input-field tabular-nums"
                />
              </Field>
              <Field label="Year Built">
                <input
                  type="number"
                  value={form.year_built}
                  onChange={(e) => set("year_built", e.target.value)}
                  placeholder="1985"
                  className="input-field tabular-nums"
                />
              </Field>
            </div>
          </Section>

          {/* Redevelopment Inputs — only when the scope adds or alters
              buildings (ground_up or value_add_expansion). Acquisitions
              skip this block entirely so the create flow stays lean.
              Entitlement / environmental / demolition / delivery tracking
              lives on the diligence checklist + dev schedule. */}
          {(form.deal_scope === "ground_up" || form.deal_scope === "value_add_expansion") && (
          <Section title="Redevelopment Inputs">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Land (Acres)">
                <input
                  type="number"
                  step="0.01"
                  value={form.land_acres}
                  onChange={(e) => set("land_acres", e.target.value)}
                  placeholder="2.5"
                  className="input-field tabular-nums"
                />
              </Field>
            </div>
          </Section>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving || extracting}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {omFile ? "Creating & analyzing..." : "Creating..."}
                </>
              ) : (
                "Create Deal"
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card space-y-4">
      <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {children}
    </div>
  );
}
