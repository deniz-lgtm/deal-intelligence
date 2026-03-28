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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatNumber, titleCase } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { Deal, DealStatus, Document, ChecklistItem, BusinessPlan, InvestmentThesis } from "@/lib/types";
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
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [advancingTo, setAdvancingTo] = useState<DealStatus | null>(null);
  const [showGateWarning, setShowGateWarning] = useState<{ status: DealStatus; message: string } | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [autoFilling, setAutoFilling] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then((r) => r.json()),
      fetch(`/api/deals/${params.id}/documents`).then((r) => r.json()),
      fetch(`/api/checklist?deal_id=${params.id}`).then((r) => r.json()),
    ]).then(async ([dealRes, docsRes, checklistRes]) => {
      const d = dealRes.data;
      setDeal(d);
      setNotesValue(d?.notes || "");
      setDocuments(docsRes.data || []);
      setChecklist(checklistRes.data || []);
      // Load linked business plan
      if (d?.business_plan_id) {
        try {
          const bpRes = await fetch(`/api/business-plans/${d.business_plan_id}`);
          const bpJson = await bpRes.json();
          if (bpJson.data) setBusinessPlan(bpJson.data);
        } catch { /* ignore */ }
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

  const saveNotes = async () => {
    if (!deal) return;
    await fetch(`/api/deals/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesValue }),
    });
    setDeal({ ...deal, notes: notesValue });
    setEditingNotes(false);
    toast.success("Notes saved");
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
  const nextStatus = !isDead && currentPipelineIdx >= 0 && currentPipelineIdx < DEAL_PIPELINE.length - 1
    ? DEAL_PIPELINE[currentPipelineIdx + 1]
    : null;
  const prevStatus = !isDead && currentPipelineIdx > 0 ? DEAL_PIPELINE[currentPipelineIdx - 1] : null;

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

      {/* Deal header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <Badge variant={STATUS_BADGE_VARIANT[deal.status]}>
              {DEAL_STAGE_LABELS[deal.status]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {deal.property_type ? titleCase(deal.property_type) : ""}
            </span>
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
          <h1 className="font-display text-2xl tracking-tight">{deal.name}</h1>
          {(deal.address || deal.city) && (
            <p className="text-muted-foreground text-sm flex items-center gap-1.5 mt-1">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground/40" />
              {[deal.address, deal.city, deal.state, deal.zip]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggleStar} className="h-9 w-9">
            <Star
              className={`h-4 w-4 ${
                deal.starred
                  ? "text-amber-400 fill-amber-400"
                  : "text-muted-foreground"
              }`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={deleteDeal}
            disabled={deleting}
            className="text-muted-foreground hover:text-destructive h-9 w-9"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Deal Pipeline */}
      <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm">Deal Pipeline</h3>
          {isDead && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => changeStatus("sourcing")}
            >
              Reactivate
            </Button>
          )}
          {!isDead && (
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
            const isCompleted = !isDead && currentPipelineIdx > i;
            const isCurrent = !isDead && currentPipelineIdx === i;
            const isFuture = isDead || currentPipelineIdx < i;
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
                      : isFuture && !isDead
                      ? "bg-muted hover:bg-primary/20"
                      : "bg-muted/40"
                  } ${isDead ? "opacity-30" : ""}`}
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
        {!isDead && (prevStatus || nextStatus) && (
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

      {/* Key metrics */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xs text-muted-foreground uppercase tracking-wider">Key Metrics</h3>
        {documents.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 h-7"
            onClick={autoFillFromDocs}
            disabled={autoFilling}
          >
            {autoFilling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            AI Auto-fill
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      {/* Business Plan */}
      {businessPlan && (
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
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{businessPlan.name}</p>
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
              {(businessPlan.hold_period_min || businessPlan.hold_period_max) && (
                <span>{businessPlan.hold_period_min}–{businessPlan.hold_period_max} yr hold</span>
              )}
            </div>
            {businessPlan.description && (
              <p className="text-2xs text-muted-foreground leading-relaxed line-clamp-2">{businessPlan.description}</p>
            )}
          </div>
        </div>
      )}

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

      {/* Notes */}
      <div className="border border-border/60 rounded-xl p-5 bg-card shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="font-display text-sm">Notes</h3>
          </div>
          {!editingNotes ? (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setEditingNotes(true)}>
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setEditingNotes(false); setNotesValue(deal.notes || ""); }}>
                Cancel
              </Button>
              <Button size="sm" className="text-xs h-7" onClick={saveNotes}>Save</Button>
            </div>
          )}
        </div>
        {editingNotes ? (
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            rows={4}
            className="input-field resize-none"
            placeholder="Investment thesis, deal source, key considerations..."
          />
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {deal.notes || "No notes yet. Click Edit to add."}
          </p>
        )}
      </div>
    </div>
  );
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
    <div className="border border-border/60 rounded-xl p-4 bg-card shadow-card">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-2xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
