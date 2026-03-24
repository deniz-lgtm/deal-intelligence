"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  FileText,
  CheckSquare,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { Deal, DealStatus, Document, ChecklistItem } from "@/lib/types";
import {
  DEAL_PIPELINE,
  DEAL_STAGE_LABELS,
  STAGE_GATES,
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
    ]).then(([dealRes, docsRes, checklistRes]) => {
      setDeal(dealRes.data);
      setNotesValue(dealRes.data?.notes || "");
      setDocuments(docsRes.data || []);
      setChecklist(checklistRes.data || []);
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

    // Check stage gate
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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
    <div className="space-y-6">
      {/* Gate warning modal */}
      {showGateWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Stage Gate Warning</h3>
                <p className="text-sm text-muted-foreground">{showGateWarning.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowGateWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
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
          <div className="flex items-center gap-3 mb-2">
            <Badge variant={STATUS_BADGE_VARIANT[deal.status]}>
              {DEAL_STAGE_LABELS[deal.status]}
            </Badge>
            <span className="text-sm text-muted-foreground capitalize">
              {deal.property_type?.replace(/_/g, " ")}
            </span>
            {deal.loi_executed && (
              <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                LOI ✓
              </span>
            )}
            {deal.psa_executed && (
              <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                PSA ✓
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold">{deal.name}</h1>
          {(deal.address || deal.city) && (
            <p className="text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-4 w-4" />
              {[deal.address, deal.city, deal.state, deal.zip]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleStar}>
            <Star
              className={`h-5 w-5 ${
                deal.starred
                  ? "text-yellow-500 fill-yellow-500"
                  : "text-muted-foreground"
              }`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={deleteDeal}
            disabled={deleting}
            className="text-destructive hover:text-destructive"
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
      <div className="border rounded-xl p-5 bg-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Deal Pipeline</h3>
          {isDead && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => changeStatus("sourcing")}
            >
              Reactivate
            </Button>
          )}
          {!isDead && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
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
              <div key={stage} className="flex-1 flex flex-col items-center gap-1">
                <button
                  onClick={() => changeStatus(stage)}
                  disabled={advancingTo !== null}
                  className={`w-full h-2 rounded-full transition-all cursor-pointer hover:opacity-80 ${
                    isCompleted
                      ? "bg-primary"
                      : isCurrent
                      ? "bg-primary/60"
                      : isFuture && !isDead
                      ? "bg-muted hover:bg-primary/20"
                      : "bg-muted/40"
                  } ${isDead ? "opacity-40" : ""}`}
                  title={`Move to ${DEAL_STAGE_LABELS[stage]}`}
                />
                <span
                  className={`text-[10px] text-center leading-tight transition-colors ${
                    isCurrent
                      ? "text-primary font-semibold"
                      : isCompleted
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {DEAL_STAGE_LABELS[stage]}
                </span>
              </div>
            );
          })}
        </div>
        {!isDead && (prevStatus || nextStatus) && (
          <div className="flex items-center justify-between mt-2 pt-3 border-t">
            <div>
              {prevStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => changeStatus(prevStatus)}
                  disabled={advancingTo !== null}
                >
                  ← Back to {DEAL_STAGE_LABELS[prevStatus]}
                </Button>
              )}
            </div>
            <div>
              {nextStatus && (
                <Button
                  size="sm"
                  className="text-xs gap-1"
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
        <h3 className="font-semibold text-sm text-muted-foreground">Key Metrics</h3>
        {documents.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1"
            onClick={autoFillFromDocs}
            disabled={autoFilling}
          >
            {autoFilling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            AI Auto-fill from Docs
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
          label="Asking Price"
          value={formatCurrency(deal.asking_price)}
        />
        <MetricCard
          icon={<Maximize2 className="h-5 w-5 text-blue-600" />}
          label="Square Footage"
          value={deal.square_footage ? `${formatNumber(deal.square_footage)} SF` : "—"}
        />
        <MetricCard
          icon={<Building2 className="h-5 w-5 text-purple-600" />}
          label="Units"
          value={deal.units ? String(deal.units) : "—"}
        />
        {deal.bedrooms ? (
          <MetricCard
            icon={<BedDouble className="h-5 w-5 text-indigo-600" />}
            label="Bedrooms"
            value={String(deal.bedrooms)}
          />
        ) : (
          <MetricCard
            icon={<Calendar className="h-5 w-5 text-orange-600" />}
            label="Year Built"
            value={deal.year_built ? String(deal.year_built) : "—"}
          />
        )}
      </div>

      {/* Progress + Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 border rounded-xl p-5 bg-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Diligence Progress</h3>
            <Link href={`/deals/${params.id}/checklist`}>
              <Button variant="ghost" size="sm" className="text-xs gap-1">
                View Checklist <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              {checklistComplete} of {checklistTotal} items complete
            </span>
            <span className="text-sm font-semibold">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-3 mb-3" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="text-green-600 font-medium">
              ✓ {checklistComplete} complete
            </span>
            <span>
              ○ {checklistTotal - checklistComplete - checklistIssues} pending
            </span>
            {checklistIssues > 0 && (
              <span className="text-red-500 font-medium">
                ⚠ {checklistIssues} issues
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="border rounded-xl p-5 bg-card space-y-2">
          <h3 className="font-semibold mb-3">Quick Access</h3>
          {[
            { href: `/deals/${params.id}/underwriting`, icon: <Calculator className="h-4 w-4 text-blue-600 shrink-0" />, label: "Underwriting", sub: "Financial model" },
            { href: `/deals/${params.id}/documents`, icon: <FileText className="h-4 w-4 text-primary shrink-0" />, label: "Documents", sub: `${documents.length} uploaded` },
            { href: `/deals/${params.id}/photos`, icon: <Camera className="h-4 w-4 text-green-600 shrink-0" />, label: "Photos", sub: "Property photos & street view" },
            { href: `/deals/${params.id}/loi`, icon: <FileSignature className="h-4 w-4 text-orange-600 shrink-0" />, label: "LOI", sub: deal.loi_executed ? "Executed ✓" : "Build & track LOI" },
            { href: `/deals/${params.id}/dd-abstract`, icon: <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />, label: "DD Abstract", sub: "AI due diligence summary" },
            { href: `/deals/${params.id}/chat`, icon: <MessageSquare className="h-4 w-4 text-purple-600 shrink-0" />, label: "AI Chat", sub: "Ask about this deal" },
          ].map(({ href, icon, label, sub }) => (
            <Link key={href} href={href} className="block">
              <button className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent transition-colors text-left">
                {icon}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground truncate">{sub}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </Link>
          ))}
        </div>
      </div>

      {/* Document breakdown */}
      {documents.length > 0 && (
        <div className="border rounded-xl p-5 bg-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Documents by Category</h3>
            <Link href={`/deals/${params.id}/documents`}>
              <Button variant="ghost" size="sm" className="text-xs gap-1">
                Manage <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(docsByCategory).map(([cat, count]) => (
              <div key={cat} className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">
                  {cat.replace(/_/g, " ")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="border rounded-xl p-5 bg-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Notes</h3>
          </div>
          {!editingNotes ? (
            <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditingNotes(false); setNotesValue(deal.notes || ""); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveNotes}>Save</Button>
            </div>
          )}
        </div>
        {editingNotes ? (
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            rows={4}
            className="w-full text-sm border rounded-lg p-3 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Investment thesis, deal source, key considerations..."
          />
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
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
    <div className="border rounded-xl p-4 bg-card">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
