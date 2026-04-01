"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  FileText,
  MessageSquare,
  MapPin,
  Star,
  Edit2,
  DollarSign,
  Calendar,
  Maximize2,
  ArrowRight,
  Trash2,
  Loader2,
  ChevronRight,
  AlertTriangle,
  BedDouble,
  Calculator,
  Camera,
  FileSignature,
  Sparkles,
  BookOpen,
  Archive,
  TrendingUp,
  Percent,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import DealNotes from "@/components/DealNotes";
import { formatCurrency, formatNumber, titleCase } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { Deal, DealStatus, Document, ChecklistItem, BusinessPlan, InvestmentThesis, Photo, UnderwritingData } from "@/lib/types";
import {
  DEAL_PIPELINE,
  DEAL_STAGE_LABELS,
  STAGE_GATES,
  INVESTMENT_THESIS_LABELS,
} from "@/lib/types";

const STATUS_BADGE_VARIANT: Record<DealStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "issue"> = {
  sourcing: "secondary",
  screening: "info",
  loi: "warning",
  under_contract: "warning",
  diligence: "default",
  closing: "success",
  closed: "success",
  dead: "issue",
  archived: "outline",
};

export default function DealOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [businessPlan, setBusinessPlan] = useState<BusinessPlan | null>(null);
  const [allPlans, setAllPlans] = useState<BusinessPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [changingPlan, setChangingPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [advancingTo, setAdvancingTo] = useState<DealStatus | null>(null);
  const [showGateWarning, setShowGateWarning] = useState<{ status: DealStatus; message: string } | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [underwriting, setUnderwriting] = useState<UnderwritingData | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then((r) => r.json()),
      fetch(`/api/deals/${params.id}/documents`).then((r) => r.json()),
      fetch(`/api/checklist?deal_id=${params.id}`).then((r) => r.json()),
      fetch("/api/business-plans").then((r) => r.json()),
      fetch(`/api/deals/${params.id}/photos`).then((r) => r.json()),
      fetch(`/api/underwriting?deal_id=${params.id}`).then((r) => r.json()),
    ]).then(async ([dealRes, docsRes, checklistRes, plansRes, photosRes, uwRes]) => {
      const d = dealRes.data;
      setDeal(d);
      setDocuments(docsRes.data || []);
      setChecklist(checklistRes.data || []);
      setPhotos(photosRes.data || []);
      if (uwRes.data?.data) {
        try {
          const parsed = typeof uwRes.data.data === "string" ? JSON.parse(uwRes.data.data) : uwRes.data.data;
          setUnderwriting(parsed);
        } catch { /* ignore parse errors */ }
      }
      const plans = plansRes.data || [];
      setAllPlans(plans);
      setSelectedPlanId(d?.business_plan_id || "");
      // Load linked business plan
      if (d?.business_plan_id) {
        const linked = plans.find((p: BusinessPlan) => p.id === d.business_plan_id);
        if (linked) setBusinessPlan(linked);
        else {
          try {
            const bpRes = await fetch(`/api/business-plans/${d.business_plan_id}`);
            const bpJson = await bpRes.json();
            if (bpJson.data) setBusinessPlan(bpJson.data);
          } catch { /* ignore */ }
        }
      }
      setLoading(false);
    });
  }, [params.id]);

  const toggleStar = async () => {
    if (!deal) return;
    const newStarred = !deal.starred;
    setDeal({ ...deal, starred: newStarred });
    await fetch(`/api/deals/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: newStarred }),
    });
    toast.success(newStarred ? "Deal starred" : "Star removed");
  };

  const deleteDeal = async () => {
    if (!confirm("Delete this deal and all its documents? This cannot be undone.")) return;
    setDeleting(true);
    await fetch(`/api/deals/${params.id}`, { method: "DELETE" });
    toast.success("Deal deleted");
    router.push("/");
  };

  const changeStatus = async (newStatus: DealStatus, force = false) => {
    if (!deal) return;

    if (!force) {
      const gate = STAGE_GATES[newStatus];
      if (gate && !deal[gate.flag]) {
        setShowGateWarning({ status: newStatus, message: gate.message });
        return;
      }
    }

    setAdvancingTo(newStatus);
    const res = await fetch(`/api/deals/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    const json = await res.json();
    if (json.data) {
      setDeal(json.data as Deal);
      toast.success(`Moved to ${DEAL_STAGE_LABELS[newStatus]}`);
    }
    setAdvancingTo(null);
    setShowGateWarning(null);
  };

  const autoFillFromDocs = async () => {
    if (!deal || documents.length === 0) return;
    setAutoFilling(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/autofill`, { method: "POST" });
      const json = await res.json();
      if (res.ok && json.data) {
        setDeal(json.data as Deal);
        toast.success(`Auto-filled ${json.filled_count} field${json.filled_count !== 1 ? "s" : ""} from documents`);
      } else {
        toast.error(json.error || "Auto-fill failed");
      }
    } catch {
      toast.error("Auto-fill failed");
    } finally {
      setAutoFilling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Deal not found</p>
        <Link href="/">
          <Button className="mt-4">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const checklistTotal = checklist.length;
  const checklistComplete = checklist.filter((i) => i.status === "complete").length;
  const checklistIssues = checklist.filter((i) => i.status === "issue").length;
  const progressPct = checklistTotal > 0 ? Math.round((checklistComplete / checklistTotal) * 100) : 0;

  const docsByCategory = documents.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] || 0) + 1;
    return acc;
  }, {});

  const currentPipelineIdx = DEAL_PIPELINE.indexOf(deal.status);
  const isDead = deal.status === "dead";
  const isArchived = deal.status === "archived";
  const isOffPipeline = isDead || isArchived;
  const nextStatus = !isOffPipeline && currentPipelineIdx >= 0 && currentPipelineIdx < DEAL_PIPELINE.length - 1
    ? DEAL_PIPELINE[currentPipelineIdx + 1]
    : null;
  const prevStatus = !isOffPipeline && currentPipelineIdx > 0 ? DEAL_PIPELINE[currentPipelineIdx - 1] : null;

  // Compute financial highlights from underwriting data
  const highlights = computeHighlights(underwriting, deal);
  const coverPhoto = photos.length > 0 ? photos[0] : null;
  const addressString = [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
  const hasAddress = deal.address || deal.city;
  const mapsEmbedUrl = hasAddress
    ? `https://maps.google.com/maps?q=${encodeURIComponent(addressString)}&output=embed&layer=c`
    : null;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Gate warning modal */}
      {showGateWarning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-lifted animate-slide-up">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4.5 w-4.5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-display font-semibold mb-1">Stage Gate Warning</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{showGateWarning.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowGateWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => changeStatus(showGateWarning.status, true)}
              >
                Move Anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cover Photo Hero */}
      <div className="relative rounded-2xl overflow-hidden border border-border/60 shadow-card z-0">
        {coverPhoto ? (
          <div className="relative h-48 md:h-64">
            <img
              src={`/api/photos/${coverPhoto.id}`}
              alt={coverPhoto.caption || deal.name}
              className="w-full h-full object-cover"
            />
            {photos.length > 1 && (
              <Link href={`/deals/${params.id}/photos`}>
                <button className="absolute top-3 right-3 flex items-center gap-1.5 text-2xs text-white/80 bg-black/40 backdrop-blur-sm px-2.5 py-1.5 rounded-lg hover:bg-black/60 transition-colors z-10">
                  <ImageIcon className="h-3 w-3" />
                  {photos.length} photos
                </button>
              </Link>
            )}
          </div>
        ) : (
          <div className="relative h-48 md:h-64 overflow-hidden">
            {mapsEmbedUrl ? (
              <iframe
                src={mapsEmbedUrl}
                className="absolute inset-0 w-full h-full border-0 pointer-events-none"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Property street view"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-muted/80 to-muted/30" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              {hasAddress && (
                <a
                  href={`https://www.google.com/maps?layer=c&q=${encodeURIComponent(addressString)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-2xs text-white/80 bg-black/40 backdrop-blur-sm px-2.5 py-1.5 rounded-lg hover:bg-black/60 transition-colors"
                >
                  <MapPin className="h-3 w-3" />
                  Street View
                </a>
              )}
              <Link href={`/deals/${params.id}/photos`}>
                <button className="flex items-center gap-1.5 text-2xs text-white/80 bg-black/40 backdrop-blur-sm px-2.5 py-1.5 rounded-lg hover:bg-black/60 transition-colors">
                  <Camera className="h-3 w-3" /> Add Photos
                </button>
              </Link>
            </div>
          </div>
        )}
        {/* Deal info below hero */}
        <div className="px-5 py-4 bg-card border-t border-border/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant={STATUS_BADGE_VARIANT[deal.status]}>
                  {DEAL_STAGE_LABELS[deal.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {deal.property_type ? titleCase(deal.property_type) : ""}
                </span>
                {deal.investment_strategy && (
                  <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {INVESTMENT_THESIS_LABELS[deal.investment_strategy as InvestmentThesis] || titleCase(deal.investment_strategy)}
                  </span>
                )}
                {deal.loi_executed && (
                  <span className="text-2xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    LOI ✓
                  </span>
                )}
                {deal.psa_executed && (
                  <span className="text-2xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    PSA ✓
                  </span>
                )}
              </div>
              <h1 className="font-display text-3xl tracking-tight">{deal.name}</h1>
              {hasAddress && (
                <p className="text-muted-foreground text-sm flex items-center gap-1.5 mt-1">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground/40" />
                  {addressString}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={toggleStar} className="h-9 w-9">
                <Star className={`h-4 w-4 ${deal.starred ? "text-amber-400 fill-amber-400" : "text-muted-foreground"}`} />
              </Button>
            </div>
          </div>
        </div>
        {/* Action bar */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-card border-t border-border/40">
          <div className="flex items-center gap-1.5">
            {deal.status !== "archived" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeStatus("archived")}
                disabled={advancingTo !== null}
                className="text-xs text-muted-foreground hover:text-foreground h-7 gap-1"
              >
                <Archive className="h-3 w-3" /> Archive
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeStatus("sourcing")}
                disabled={advancingTo !== null}
                className="text-xs h-7"
              >
                Unarchive
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteDeal}
              disabled={deleting}
              className="text-xs text-muted-foreground hover:text-destructive h-7 gap-1"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Delete
            </Button>
          </div>
          {documents.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-7"
              onClick={autoFillFromDocs}
              disabled={autoFilling}
            >
              {autoFilling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              AI Auto-fill
            </Button>
          )}
        </div>
      </div>

      {/* Deal Pipeline */}
      <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm">Deal Pipeline</h3>
          {isOffPipeline && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => changeStatus("sourcing")}
            >
              Reactivate
            </Button>
          )}
          {!isOffPipeline && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-muted-foreground hover:text-destructive"
              onClick={() => changeStatus("dead")}
            >
              Mark Dead
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1 mb-3">
          {DEAL_PIPELINE.map((stage, i) => {
            const isCompleted = !isOffPipeline && currentPipelineIdx > i;
            const isCurrent = !isOffPipeline && currentPipelineIdx === i;
            const isFuture = isOffPipeline || currentPipelineIdx < i;
            return (
              <div key={stage} className="flex-1 flex flex-col items-center gap-1.5">
                <button
                  onClick={() => changeStatus(stage)}
                  disabled={advancingTo !== null}
                  className={`w-full h-1.5 rounded-full transition-all cursor-pointer hover:opacity-80 ${
                    isCompleted
                      ? "gradient-gold"
                      : isCurrent
                      ? "bg-primary/30"
                      : isFuture && !isOffPipeline
                      ? "bg-muted hover:bg-primary/20"
                      : "bg-muted/40"
                  } ${isOffPipeline ? "opacity-30" : ""}`}
                  title={`Move to ${DEAL_STAGE_LABELS[stage]}`}
                />
                <span
                  className={`text-[10px] text-center leading-tight transition-colors ${
                    isCurrent
                      ? "text-primary font-semibold"
                      : isCompleted
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {DEAL_STAGE_LABELS[stage]}
                </span>
              </div>
            );
          })}
        </div>
        {!isOffPipeline && (prevStatus || nextStatus) && (
          <div className="flex items-center justify-between mt-2 pt-3 border-t border-border/40">
            <div>
              {prevStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground h-7"
                  onClick={() => changeStatus(prevStatus)}
                  disabled={advancingTo !== null}
                >
                  ← {DEAL_STAGE_LABELS[prevStatus]}
                </Button>
              )}
            </div>
            <div>
              {nextStatus && (
                <Button
                  size="sm"
                  className="text-xs gap-1 h-8"
                  onClick={() => changeStatus(nextStatus)}
                  disabled={advancingTo !== null}
                >
                  {advancingTo === nextStatus ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Advance to {DEAL_STAGE_LABELS[nextStatus]}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Property Metrics + Deal Metrics side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Property Metrics */}
        <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
          <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wider mb-3">Property</h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={<DollarSign className="h-4 w-4 text-emerald-400" />}
              label="Asking Price"
              value={formatCurrency(deal.asking_price)}
            />
            <MetricCard
              icon={<Maximize2 className="h-4 w-4 text-blue-400" />}
              label="Square Footage"
              value={deal.square_footage ? `${formatNumber(deal.square_footage)} SF` : "—"}
            />
            <MetricCard
              icon={<Building2 className="h-4 w-4 text-purple-400" />}
              label="Units"
              value={deal.units ? formatNumber(deal.units) : "—"}
            />
            {deal.bedrooms ? (
              <MetricCard
                icon={<BedDouble className="h-4 w-4 text-indigo-400" />}
                label="Bedrooms"
                value={formatNumber(deal.bedrooms)}
              />
            ) : (
              <MetricCard
                icon={<Calendar className="h-4 w-4 text-orange-400" />}
                label="Year Built"
                value={deal.year_built ? String(deal.year_built) : "—"}
              />
            )}
          </div>
          {/* Land Acres */}
          <div className="mt-3 pt-3 border-t border-border/40">
            <label className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">Land (Acres)</label>
            <input
              type="number"
              step="0.01"
              value={deal.land_acres ?? ""}
              placeholder="—"
              onChange={(e) => {
                const val = e.target.value ? parseFloat(e.target.value) : null;
                setDeal((prev: any) => prev ? { ...prev, land_acres: val } : prev);
              }}
              onBlur={async () => {
                try {
                  await fetch(`/api/deals/${params.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ land_acres: deal.land_acres }),
                  });
                } catch { /* ignore */ }
              }}
              className="mt-1 w-full text-sm bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 outline-none focus:border-primary/40 transition-colors"
            />
          </div>
          {/* Investment Strategy */}
          <div className="mt-3 pt-3 border-t border-border/40">
            <label className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">Investment Strategy</label>
            <select
              value={deal.investment_strategy || ""}
              onChange={async (e) => {
                const strategy = e.target.value || null;
                setDeal((prev: any) => prev ? { ...prev, investment_strategy: strategy } : prev);
                try {
                  await fetch(`/api/deals/${params.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ investment_strategy: strategy }),
                  });
                } catch { /* ignore */ }
              }}
              className="mt-1 w-full text-sm bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 outline-none focus:border-primary/40 transition-colors"
            >
              <option value="">Not set</option>
              {(["value_add", "ground_up", "core", "core_plus", "opportunistic"] as InvestmentThesis[]).map((s) => (
                <option key={s} value={s}>{INVESTMENT_THESIS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Financial Highlights from Underwriting */}
        <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wider">Financial Highlights</h3>
            <Link href={`/deals/${params.id}/underwriting`}>
              <Button variant="ghost" size="sm" className="text-2xs gap-1 h-6">
                Underwriting <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          {highlights ? (
            <div className="grid grid-cols-2 gap-3">
              {highlights.capRate != null && (
                <MetricCard
                  icon={<Percent className="h-4 w-4 text-amber-400" />}
                  label="Cap Rate"
                  value={`${highlights.capRate.toFixed(1)}%`}
                />
              )}
              {highlights.noi != null && (
                <MetricCard
                  icon={<DollarSign className="h-4 w-4 text-emerald-400" />}
                  label="NOI"
                  value={formatCurrency(highlights.noi)}
                />
              )}
              {highlights.pricePerUnit != null && (
                <MetricCard
                  icon={<Building2 className="h-4 w-4 text-blue-400" />}
                  label={highlights.pricePerUnitLabel}
                  value={formatCurrency(highlights.pricePerUnit)}
                />
              )}
              {highlights.cashOnCash != null && (
                <MetricCard
                  icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
                  label="Cash-on-Cash"
                  value={`${highlights.cashOnCash.toFixed(1)}%`}
                />
              )}
              {highlights.dscr != null && (
                <MetricCard
                  icon={<Calculator className="h-4 w-4 text-cyan-400" />}
                  label="DSCR"
                  value={`${highlights.dscr.toFixed(2)}x`}
                />
              )}
              {highlights.equityMultiple != null && (
                <MetricCard
                  icon={<TrendingUp className="h-4 w-4 text-orange-400" />}
                  label="Equity Multiple"
                  value={`${highlights.equityMultiple.toFixed(2)}x`}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Calculator className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No underwriting data yet</p>
              <Link href={`/deals/${params.id}/underwriting`}>
                <Button variant="outline" size="sm" className="text-xs mt-2 h-7">
                  Start Underwriting
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Site & Development — Ground-Up Only */}
      {deal.investment_strategy === "ground_up" && (
        <SiteDevelopmentCard
          deal={deal}
          underwriting={underwriting}
          dealId={params.id}
          onUnderwritingUpdate={(updates) => setUnderwriting(prev => prev ? { ...prev, ...updates } : updates as any)}
        />
      )}

      {/* Business Plan */}
      <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <h3 className="font-display text-sm">Business Plan</h3>
          </div>
          <Link href="/business-plans">
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-7">
              Manage <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
        {/* Plan selector dropdown */}
        <div className="mb-3">
          <select
            value={selectedPlanId}
            onChange={(e) => {
              const newVal = e.target.value;
              const planId = newVal || null;
              // Optimistic update
              setSelectedPlanId(newVal);
              const linked = planId ? allPlans.find((p) => p.id === planId) || null : null;
              setBusinessPlan(linked);
              // Persist
              setChangingPlan(true);
              fetch(`/api/deals/${params.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ business_plan_id: planId }),
              })
                .then(r => r.json())
                .then(json => {
                  if (json.data) {
                    setDeal(json.data as Deal);
                    toast.success(planId ? "Business plan linked" : "Business plan removed");
                  } else {
                    // Revert on failure
                    setSelectedPlanId(deal.business_plan_id || "");
                    toast.error("Failed to update business plan");
                  }
                })
                .catch(() => {
                  setSelectedPlanId(deal.business_plan_id || "");
                  toast.error("Failed to update business plan");
                })
                .finally(() => setChangingPlan(false));
            }}
            disabled={changingPlan}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">No business plan</option>
            {allPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_default ? " (Default)" : ""}
              </option>
            ))}
          </select>
        </div>
        {/* Plan details */}
        {businessPlan ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(businessPlan.investment_theses || []).map((t) => (
                <span
                  key={t}
                  className="text-2xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium"
                >
                  {INVESTMENT_THESIS_LABELS[t as InvestmentThesis] || t}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-4 flex-wrap text-2xs text-muted-foreground">
              {(businessPlan.target_markets || []).length > 0 && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {(businessPlan.target_markets || []).join(", ")}
                </span>
              )}
              {(businessPlan.target_irr_min || businessPlan.target_irr_max) && (
                <span>IRR {businessPlan.target_irr_min ?? "?"}–{businessPlan.target_irr_max ?? "?"}%</span>
              )}
              {(businessPlan.target_equity_multiple_min || businessPlan.target_equity_multiple_max) && (
                <span>EM {businessPlan.target_equity_multiple_min ?? "?"}–{businessPlan.target_equity_multiple_max ?? "?"}x</span>
              )}
              {(businessPlan.hold_period_min || businessPlan.hold_period_max) && (
                <span>{businessPlan.hold_period_min}–{businessPlan.hold_period_max} yr hold</span>
              )}
            </div>
            {businessPlan.description && (
              <p className="text-2xs text-muted-foreground leading-relaxed line-clamp-2">{businessPlan.description}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No plan linked. Select one above to guide analysis.</p>
        )}
      </div>

      {/* Progress + Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 border border-border/60 rounded-xl p-5 bg-card shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm">Diligence Progress</h3>
            <Link href={`/deals/${params.id}/checklist`}>
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-7">
                View Checklist <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">
              {checklistComplete} of {checklistTotal} items complete
            </span>
            <span className="text-xs font-bold tabular-nums">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-2 mb-3" />
          <div className="flex gap-4 text-2xs text-muted-foreground">
            <span className="text-emerald-400 font-medium">
              ✓ {checklistComplete} complete
            </span>
            <span>
              ○ {checklistTotal - checklistComplete - checklistIssues} pending
            </span>
            {checklistIssues > 0 && (
              <span className="text-red-400 font-medium">
                ⚠ {checklistIssues} issues
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
          <h3 className="font-display text-sm mb-3">Quick Access</h3>
          <div className="space-y-1">
            {[
              { href: `/deals/${params.id}/underwriting`, icon: <Calculator className="h-3.5 w-3.5 text-blue-400 shrink-0" />, label: "Underwriting", sub: "Financial model" },
              { href: `/deals/${params.id}/documents`, icon: <FileText className="h-3.5 w-3.5 text-primary shrink-0" />, label: "Documents", sub: `${documents.length} uploaded` },
              { href: `/deals/${params.id}/photos`, icon: <Camera className="h-3.5 w-3.5 text-emerald-400 shrink-0" />, label: "Photos", sub: "Property photos" },
              { href: `/deals/${params.id}/loi`, icon: <FileSignature className="h-3.5 w-3.5 text-orange-400 shrink-0" />, label: "LOI", sub: deal.loi_executed ? "Executed ✓" : "Build & track" },
              { href: `/deals/${params.id}/dd-abstract`, icon: <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />, label: "DD Abstract", sub: "AI summary" },
              { href: `/deals/${params.id}/chat`, icon: <MessageSquare className="h-3.5 w-3.5 text-purple-400 shrink-0" />, label: "AI Chat", sub: "Ask about this deal" },
            ].map(({ href, icon, label, sub }) => (
              <Link key={href} href={href} className="block">
                <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left group/item">
                  {icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-2xs text-muted-foreground truncate">{sub}</p>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/20 group-hover/item:text-muted-foreground transition-colors" />
                </button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Document breakdown */}
      {documents.length > 0 && (
        <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm">Documents by Category</h3>
            <Link href={`/deals/${params.id}/documents`}>
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-7">
                Manage <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(docsByCategory).map(([cat, count]) => (
              <div key={cat} className="bg-muted/30 rounded-lg p-3 text-center border border-border/30">
                <p className="text-xl font-bold tabular-nums">{count}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {titleCase(cat)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal Notes */}
      <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
        <div className="flex items-center gap-2 mb-3">
          <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="font-display text-sm">Deal Notes</h3>
        </div>
        <DealNotes dealId={params.id} />
      </div>
    </div>
  );
}

const EFFICIENCY_DEFAULTS: Record<string, number> = {
  industrial: 98, multifamily: 80, student_housing: 78,
  office: 87, retail: 95, mixed_use: 85, other: 90,
};

function SiteDevelopmentCard({ deal, underwriting, dealId, onUnderwritingUpdate }: {
  deal: Deal;
  underwriting: UnderwritingData | null;
  dealId: string;
  onUnderwritingUpdate: (updates: Partial<UnderwritingData>) => void;
}) {
  const isIndustrial = deal.property_type === "industrial";
  const isMF = ["multifamily", "student_housing"].includes(deal.property_type || "");
  const landAcres = deal.land_acres || 0;
  const landSF = landAcres * 43560;

  // Read current values from underwriting or use defaults
  const lotCoverage = underwriting?.lot_coverage_pct ?? (isIndustrial ? 40 : 0);
  const far = underwriting?.far ?? 0;
  const heightLimit = underwriting?.height_limit_stories ?? 0;
  const efficiencyDefault = EFFICIENCY_DEFAULTS[deal.property_type || "other"] ?? 90;
  const efficiency = underwriting?.efficiency_pct ?? efficiencyDefault;

  // Calculate max GSF
  let maxGSF = 0;
  if (isIndustrial && landSF > 0 && lotCoverage > 0) {
    maxGSF = Math.round(landSF * (lotCoverage / 100));
  } else if (landSF > 0 && far > 0) {
    maxGSF = Math.round(landSF * far);
  }
  const maxNRSF = Math.round(maxGSF * (efficiency / 100));

  const saveToUW = async (updates: Record<string, unknown>) => {
    onUnderwritingUpdate(updates as Partial<UnderwritingData>);
    try {
      // Fetch current UW, merge, save
      const uwRes = await fetch(`/api/underwriting?deal_id=${dealId}`);
      const uwJson = await uwRes.json();
      const currentData = uwJson.data?.data
        ? (typeof uwJson.data.data === "string" ? JSON.parse(uwJson.data.data) : uwJson.data.data)
        : {};
      const merged = { ...currentData, ...updates, development_mode: true, max_gsf: updates.max_gsf ?? maxGSF, max_nrsf: updates.max_nrsf ?? maxNRSF };
      await fetch("/api/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, data: merged }),
      });
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wider">Site & Development Parameters</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Land info (read-only, comes from deal) */}
        <div className="p-3 bg-muted/30 rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Land</p>
          <p className="text-sm font-semibold">{landAcres > 0 ? `${landAcres.toFixed(2)} AC` : "—"}</p>
          {landSF > 0 && <p className="text-[10px] text-muted-foreground">{Math.round(landSF).toLocaleString()} SF</p>}
        </div>

        {/* Property-type-specific inputs */}
        {isIndustrial ? (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Lot Coverage %</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={lotCoverage || ""}
              placeholder="40"
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                const newGSF = Math.round(landSF * (val / 100));
                const newNRSF = Math.round(newGSF * (efficiency / 100));
                saveToUW({ lot_coverage_pct: val, max_gsf: newGSF, max_nrsf: newNRSF });
              }}
              className="mt-1 w-full text-sm bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 outline-none focus:border-primary/40"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">FAR</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={far || ""}
                placeholder="0.0"
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  const newGSF = Math.round(landSF * val);
                  const newNRSF = Math.round(newGSF * (efficiency / 100));
                  saveToUW({ far: val, max_gsf: newGSF, max_nrsf: newNRSF });
                }}
                className="mt-1 w-full text-sm bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 outline-none focus:border-primary/40"
              />
            </div>
            {isMF && (
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Height Limit (Stories)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={heightLimit || ""}
                  placeholder="0"
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    saveToUW({ height_limit_stories: val });
                  }}
                  className="mt-1 w-full text-sm bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 outline-none focus:border-primary/40"
                />
              </div>
            )}
          </>
        )}

        {/* Efficiency */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Efficiency (GSF → NRSF)</label>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            value={efficiency || ""}
            placeholder={String(efficiencyDefault)}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0;
              const newNRSF = Math.round(maxGSF * (val / 100));
              saveToUW({ efficiency_pct: val, max_nrsf: newNRSF });
            }}
            className="mt-1 w-full text-sm bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 outline-none focus:border-primary/40"
          />
        </div>
      </div>

      {/* Calculated results */}
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Max Gross SF (GSF)</p>
          <p className="text-lg font-bold">{maxGSF > 0 ? maxGSF.toLocaleString() : "—"}</p>
          {isIndustrial && maxGSF > 0 && <p className="text-[10px] text-muted-foreground">{lotCoverage}% lot coverage</p>}
          {!isIndustrial && maxGSF > 0 && <p className="text-[10px] text-muted-foreground">{far}x FAR</p>}
        </div>
        <div className="p-3 bg-primary/10 rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Max Net Rentable SF (NRSF)</p>
          <p className="text-lg font-bold text-primary">{maxNRSF > 0 ? maxNRSF.toLocaleString() : "—"}</p>
          {maxNRSF > 0 && <p className="text-[10px] text-muted-foreground">{efficiency}% efficiency</p>}
        </div>
      </div>
    </div>
  );
}

interface FinancialHighlights {
  capRate: number | null;
  noi: number | null;
  pricePerUnit: number | null;
  pricePerUnitLabel: string;
  cashOnCash: number | null;
  dscr: number | null;
  equityMultiple: number | null;
}

function computeHighlights(uw: UnderwritingData | null, deal: Deal): FinancialHighlights | null {
  if (!uw) return null;

  const price = uw.purchase_price || deal.asking_price;
  if (!price) return null;

  const isCommercial = !["multifamily", "student_housing"].includes(deal.property_type || "");
  const groups = uw.unit_groups || [];
  const totalUnits = groups.reduce((s, g) => s + (g.unit_count || 0), 0);

  // Compute gross potential rent
  let annualGPR = 0;
  for (const g of groups) {
    if (isCommercial) {
      const sf = (g.sf_per_unit || 0) * (g.unit_count || 0);
      annualGPR += sf * (g.market_rent_per_sf || g.current_rent_per_sf || 0);
    } else {
      const beds = (g.beds_per_unit || 1) * (g.unit_count || 0);
      annualGPR += beds * (g.market_rent_per_bed || g.current_rent_per_bed || 0) * 12;
    }
  }

  const vacancy = uw.vacancy_rate || 5;
  const egi = annualGPR * (1 - vacancy / 100);

  // OpEx
  const mgmt = egi * (uw.management_fee_pct || 0) / 100;
  const opex = mgmt + (uw.taxes_annual || 0) + (uw.insurance_annual || 0)
    + (uw.repairs_per_unit_annual || 0) * totalUnits
    + (uw.utilities_annual || 0) + (uw.other_expenses_annual || 0);

  const noi = egi - opex;
  const capRate = price > 0 ? (noi / price) * 100 : null;

  // Price per unit/SF
  let pricePerUnit: number | null = null;
  let pricePerUnitLabel = "Price / Unit";
  if (isCommercial) {
    const totalSF = groups.reduce((s, g) => s + (g.sf_per_unit || 0) * (g.unit_count || 0), 0);
    if (totalSF > 0) {
      pricePerUnit = price / totalSF;
      pricePerUnitLabel = "Price / SF";
    }
  } else if (totalUnits > 0) {
    pricePerUnit = price / totalUnits;
    pricePerUnitLabel = deal.property_type === "student_housing" ? "Price / Bed" : "Price / Unit";
  }

  // Debt service
  let annualDebtService: number | null = null;
  if (uw.has_financing && uw.loan_to_value > 0 && uw.interest_rate > 0) {
    const loanAmt = price * (uw.loan_to_value / 100);
    const closingCosts = price * ((uw.closing_costs_pct || 2) / 100);
    const r = uw.interest_rate / 100 / 12;
    const n = (uw.amortization_years || 30) * 12;
    const monthlyPayment = uw.io_period_years && uw.io_period_years > 0
      ? loanAmt * r  // IO period
      : loanAmt * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    annualDebtService = monthlyPayment * 12;

    const equity = price + closingCosts - loanAmt;
    const cashFlow = noi - annualDebtService;

    const cashOnCash = equity > 0 ? (cashFlow / equity) * 100 : null;
    const dscr = annualDebtService > 0 ? noi / annualDebtService : null;

    // Simple equity multiple: (cumulative CF + exit equity) / initial equity
    const holdYears = uw.hold_period_years || 5;
    const exitCap = uw.exit_cap_rate || 0;
    let equityMultiple: number | null = null;
    if (exitCap > 0 && equity > 0) {
      const exitValue = noi / (exitCap / 100);
      // Rough loan balance (simplified — assume IO for simplicity)
      const exitEquity = exitValue - loanAmt;
      const totalCF = cashFlow * holdYears + exitEquity;
      equityMultiple = totalCF / equity;
    }

    return {
      capRate: capRate && capRate > 0 ? capRate : null,
      noi: noi > 0 ? noi : null,
      pricePerUnit,
      pricePerUnitLabel,
      cashOnCash: cashOnCash && cashOnCash !== 0 ? cashOnCash : null,
      dscr: dscr && dscr > 0 ? dscr : null,
      equityMultiple: equityMultiple && equityMultiple > 0 ? equityMultiple : null,
    };
  }

  // No financing — just return property-level metrics
  return {
    capRate: capRate && capRate > 0 ? capRate : null,
    noi: noi > 0 ? noi : null,
    pricePerUnit,
    pricePerUnitLabel,
    cashOnCash: null,
    dscr: null,
    equityMultiple: null,
  };
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-border/40 rounded-lg p-3 bg-muted/20">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-2xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-base font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
