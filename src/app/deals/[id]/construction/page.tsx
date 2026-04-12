"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  HardHat,
  DollarSign,
  Wallet,
  FileCheck,
  Users,
  ChevronRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  ClipboardCheck,
  FileWarning,
  Camera,
  Sparkles,
  Calendar,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EXECUTION_PHASES,
  EXECUTION_PHASE_CONFIG,
} from "@/lib/types";
import type { ExecutionPhase, HardCostItem, Draw, Permit, Vendor, ProgressReport } from "@/lib/types";

interface DealInfo {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  property_type: string;
  investment_strategy: string | null;
  execution_phase: ExecutionPhase | null;
  execution_started_at: string | null;
}

interface Photo {
  id: string;
  is_cover: boolean;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

function relTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ConstructionDashboard({ params }: { params: { id: string } }) {
  const [deal, setDeal] = useState<DealInfo | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [costs, setCosts] = useState<HardCostItem[]>([]);
  const [draws, setDraws] = useState<Draw[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [phaseUpdating, setPhaseUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dealRes, photosRes, costsRes, drawsRes, permitsRes, vendorsRes, reportsRes] = await Promise.all([
        fetch(`/api/deals/${params.id}`).then((r) => r.json()),
        fetch(`/api/deals/${params.id}/photos`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/hardcost-items`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/draws`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/permits`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/vendors`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${params.id}/progress-reports`).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      setDeal(dealRes.data);
      setPhotos(photosRes.data ?? []);
      setCosts(costsRes.data ?? []);
      setDraws(drawsRes.data ?? []);
      setPermits(permitsRes.data ?? []);
      setVendors(vendorsRes.data ?? []);
      setReports(reportsRes.data ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const advancePhase = async (phase: ExecutionPhase) => {
    setPhaseUpdating(true);
    try {
      await fetch(`/api/deals/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execution_phase: phase }),
      });
      setDeal((prev) => prev ? { ...prev, execution_phase: phase } : prev);
    } catch (err) { console.error(err); }
    finally { setPhaseUpdating(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  // Budget aggregates
  const totalBudget = costs.reduce((s, c) => s + Number(c.amount || 0), 0);
  const committed = costs.filter((c) => ["committed", "incurred", "paid"].includes(c.status)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const paid = costs.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0);
  const contingencyItems = costs.filter((c) => c.category === "Contingency");
  const contingencyTotal = contingencyItems.reduce((s, c) => s + Number(c.amount || 0), 0);
  const contingencyUsed = contingencyItems.filter((c) => ["incurred", "paid"].includes(c.status)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalDrawn = draws.filter((d) => d.status === "funded").reduce((s, d) => s + Number(d.amount_approved ?? d.amount_requested ?? 0), 0);
  const pendingDraws = draws.filter((d) => ["draft", "submitted"].includes(d.status));
  const permitsApproved = permits.filter((p) => p.status === "approved").length;
  const permitsPending = permits.filter((p) => ["submitted", "in_review"].includes(p.status)).length;
  const latestReport = reports.length > 0 ? reports[0] : null;
  const coverPhoto = photos.find((p) => p.is_cover) || photos[0];

  const currentPhase = deal?.execution_phase;
  const currentPhaseIdx = currentPhase ? EXECUTION_PHASES.indexOf(currentPhase) : -1;
  const daysInExecution = deal?.execution_started_at
    ? Math.floor((Date.now() - new Date(deal.execution_started_at).getTime()) / 86400000)
    : null;
  const basePath = `/deals/${params.id}/construction`;
  const pctCommitted = totalBudget > 0 ? Math.round((committed / totalBudget) * 100) : 0;

  // Recent activity items
  const recentActivity: Array<{ icon: typeof DollarSign; label: string; date: string; color: string }> = [];
  const sortedDraws = [...draws].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  if (sortedDraws[0]) recentActivity.push({ icon: Wallet, label: `Draw #${sortedDraws[0].draw_number} — ${sortedDraws[0].status}`, date: sortedDraws[0].updated_at, color: "text-blue-400" });
  const sortedPermits = [...permits].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  if (sortedPermits[0]) recentActivity.push({ icon: FileCheck, label: `${sortedPermits[0].permit_type} — ${sortedPermits[0].status}`, date: sortedPermits[0].updated_at, color: "text-amber-400" });
  if (latestReport) recentActivity.push({ icon: ClipboardCheck, label: `${latestReport.title} — ${latestReport.status}`, date: latestReport.updated_at, color: "text-purple-400" });
  recentActivity.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div className="space-y-6">
      {/* ── Hero Section ── */}
      <div className={cn(
        "relative rounded-xl overflow-hidden border border-border/40",
        coverPhoto ? "min-h-[180px]" : "bg-gradient-to-br from-card/80 to-card/40"
      )}>
        {coverPhoto && (
          <>
            <img src={`/api/photos/${coverPhoto.id}`} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
          </>
        )}
        <div className={cn("relative p-6", coverPhoto ? "pt-20" : "py-6")}>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold font-display text-white drop-shadow-sm">{deal?.name}</h1>
              <p className="text-sm text-white/70 mt-1">
                {deal?.address}{deal?.city ? `, ${deal.city}` : ""}{deal?.state ? `, ${deal.state}` : ""}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {deal?.property_type && (
                  <span className="text-2xs px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-medium capitalize">
                    {deal.property_type.replace(/_/g, " ")}
                  </span>
                )}
                {deal?.investment_strategy && (
                  <span className="text-2xs px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-medium capitalize">
                    {deal.investment_strategy.replace(/_/g, " ")}
                  </span>
                )}
                {currentPhase && (
                  <span className={cn("text-2xs px-2 py-0.5 rounded-full font-medium", EXECUTION_PHASE_CONFIG[currentPhase].color)}>
                    {EXECUTION_PHASE_CONFIG[currentPhase].label}
                  </span>
                )}
              </div>
            </div>
            {daysInExecution != null && (
              <div className="text-right flex-shrink-0">
                <p className="text-2xl font-bold text-white tabular-nums">{daysInExecution}</p>
                <p className="text-2xs text-white/60">days in execution</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Phase Stepper ── */}
      <div className="flex items-center gap-0">
        {EXECUTION_PHASES.map((phase, i) => {
          const config = EXECUTION_PHASE_CONFIG[phase];
          const isCurrent = phase === currentPhase;
          const isPast = currentPhaseIdx >= 0 && i < currentPhaseIdx;
          return (
            <div key={phase} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => advancePhase(phase)}
                disabled={phaseUpdating}
                className={cn(
                  "flex-1 py-2 px-1.5 rounded-md text-2xs font-medium text-center transition-all truncate",
                  isCurrent ? config.color + " ring-2 ring-primary/30 shadow-sm" :
                  isPast ? "bg-emerald-500/10 text-emerald-400" :
                  "bg-muted/20 text-muted-foreground hover:bg-muted/40"
                )}
              >
                {isPast && <CheckCircle2 className="h-3 w-3 inline mr-0.5" />}
                {config.label}
              </button>
              {i < EXECUTION_PHASES.length - 1 && (
                <div className={cn("w-4 h-px flex-shrink-0 mx-0.5", isPast ? "bg-emerald-500/40" : "bg-border/40")} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Key Metrics Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Budget", value: fc(totalBudget), sub: `${costs.length} items`, color: "text-foreground" },
          { label: "Committed", value: fc(committed), sub: `${pctCommitted}% of budget`, color: pctCommitted > 90 ? "text-red-400" : pctCommitted > 70 ? "text-amber-400" : "text-blue-400" },
          { label: "Paid", value: fc(paid), sub: totalBudget > 0 ? `${Math.round((paid / totalBudget) * 100)}%` : "—", color: "text-emerald-400" },
          { label: "Drawn", value: fc(totalDrawn), sub: `${draws.length} draws`, color: "text-blue-400" },
          { label: "Contingency Left", value: fc(contingencyTotal - contingencyUsed), sub: contingencyTotal > 0 ? `${Math.round((contingencyUsed / contingencyTotal) * 100)}% used` : "—", color: contingencyTotal > 0 && contingencyUsed / contingencyTotal > 0.7 ? "text-red-400" : "text-foreground" },
          { label: "% Complete", value: latestReport?.pct_complete != null ? `${latestReport.pct_complete}%` : "—", sub: latestReport ? "per last report" : "no reports", color: "text-primary" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-border/40 bg-card/50 p-3">
            <div className="text-2xs text-muted-foreground mb-1">{m.label}</div>
            <div className={cn("text-lg font-bold tabular-nums", m.color)}>{m.value}</div>
            <div className="text-2xs text-muted-foreground/60 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Two-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column (3/5) */}
        <div className="lg:col-span-3 space-y-5">
          {/* Budget Health */}
          <div className="rounded-xl border border-border/40 bg-card/50 p-4">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Budget Health
            </h3>
            {totalBudget > 0 ? (
              <div className="space-y-3">
                <div className="h-3 rounded-full bg-muted/30 overflow-hidden flex">
                  <div className="h-full bg-emerald-500/60 transition-all" style={{ width: `${Math.round((paid / totalBudget) * 100)}%` }} title={`Paid: ${fc(paid)}`} />
                  <div className="h-full bg-blue-500/40 transition-all" style={{ width: `${Math.max(Math.round(((committed - paid) / totalBudget) * 100), 0)}%` }} title={`Committed: ${fc(committed - paid)}`} />
                </div>
                <div className="flex items-center gap-4 text-2xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/60" /> Paid {fc(paid)}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500/40" /> Committed {fc(committed - paid)}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted/30" /> Remaining {fc(totalBudget - committed)}</span>
                </div>
                {contingencyTotal > 0 && contingencyUsed / contingencyTotal > 0.7 && (
                  <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-md px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    Contingency is {Math.round((contingencyUsed / contingencyTotal) * 100)}% consumed ({fc(contingencyTotal - contingencyUsed)} remaining)
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No budget items yet. <Link href={`${basePath}/budget`} className="text-primary hover:underline">Add hard costs</Link></p>
            )}
          </div>

          {/* Recent Activity */}
          <div className="rounded-xl border border-border/40 bg-card/50 p-4">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Recent Activity
            </h3>
            {recentActivity.length > 0 ? (
              <div className="space-y-2">
                {recentActivity.map((act, i) => {
                  const Icon = act.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", act.color)} />
                      <span className="text-xs text-foreground flex-1 truncate">{act.label}</span>
                      <span className="text-2xs text-muted-foreground flex-shrink-0">{relTime(act.date)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No activity yet.</p>
            )}
          </div>

          {/* Latest Report */}
          {latestReport && (
            <div className="rounded-xl border border-border/40 bg-card/50 p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Latest Report
                <span className="text-2xs text-muted-foreground ml-auto">{latestReport.title}</span>
              </h3>
              <div className="space-y-2 text-sm">
                {latestReport.summary && <p className="text-foreground">{latestReport.summary}</p>}
                {latestReport.ai_executive_summary && (
                  <div className="bg-primary/5 border border-primary/10 rounded-md p-3">
                    <div className="flex items-center gap-1 text-2xs text-primary mb-1"><Sparkles className="h-3 w-3" /> AI Summary</div>
                    <p className="text-xs text-foreground">{latestReport.ai_executive_summary}</p>
                  </div>
                )}
                {latestReport.issues && (
                  <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/5 rounded-md p-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    {latestReport.issues}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (2/5) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Quick Links */}
          <div className="rounded-xl border border-border/40 bg-card/50 p-4">
            <h3 className="text-sm font-medium mb-3">Quick Links</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: `${basePath}/budget`, label: "Hard Costs", icon: DollarSign, color: "text-emerald-400 bg-emerald-500/10" },
                { href: `${basePath}/draws`, label: "Draws", icon: Wallet, color: "text-blue-400 bg-blue-500/10" },
                { href: `${basePath}/permits`, label: "Permits", icon: FileCheck, color: "text-amber-400 bg-amber-500/10" },
                { href: `${basePath}/vendors`, label: "Vendors", icon: Users, color: "text-cyan-400 bg-cyan-500/10" },
                { href: `${basePath}/reports`, label: "Reports", icon: ClipboardCheck, color: "text-purple-400 bg-purple-500/10" },
                { href: `${basePath}/change-orders`, label: "Change Orders", icon: FileWarning, color: "text-orange-400 bg-orange-500/10" },
              ].map((link) => {
                const Icon = link.icon;
                return (
                  <Link key={link.href} href={link.href} className="flex items-center gap-2 rounded-lg border border-border/30 bg-card/30 p-2.5 hover:bg-card/80 hover:border-border/60 transition-all group">
                    <div className={cn("h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0", link.color)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Permits Summary */}
          <div className="rounded-xl border border-border/40 bg-card/50 p-4">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-amber-400" />
              Permits
            </h3>
            {permits.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Approved</span>
                  <span className="text-emerald-400 font-medium">{permitsApproved}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Pending</span>
                  <span className="text-amber-400 font-medium">{permitsPending}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">{permits.length}</span>
                </div>
                {permits.length > 0 && (
                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden mt-1">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((permitsApproved / permits.length) * 100)}%` }} />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No permits tracked yet.</p>
            )}
          </div>

          {/* Vendors Summary */}
          <div className="rounded-xl border border-border/40 bg-card/50 p-4">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-400" />
              Vendors
            </h3>
            {vendors.length > 0 ? (
              <div className="space-y-1.5">
                {vendors.slice(0, 5).map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-xs">
                    <span className="text-foreground truncate">{v.name}</span>
                    <span className="text-muted-foreground text-2xs flex-shrink-0 ml-2">{v.role}</span>
                  </div>
                ))}
                {vendors.length > 5 && (
                  <Link href={`${basePath}/vendors`} className="text-2xs text-primary hover:underline">
                    +{vendors.length - 5} more
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No vendors added yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
