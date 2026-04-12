"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  FileText,
  Calendar,
  Loader2,
  Edit2,
  Sparkles,
  Link2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Camera,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { REPORT_STATUS_CONFIG } from "@/lib/types";
import type { ProgressReport, ReportType, ReportStatus, ProgressReportPhoto } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  dealId: string;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function periodLabel(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

interface Invite {
  id: string;
  email: string;
  name: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function ProgressReports({ dealId }: Props) {
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPhotos, setExpandedPhotos] = useState<Record<string, ProgressReportPhoto[]>>({});

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  // Forms
  const [reportForm, setReportForm] = useState({
    report_type: "weekly" as ReportType,
    title: "",
    period_start: "",
    period_end: "",
  });
  const [inviteForm, setInviteForm] = useState({ email: "", name: "" });

  const load = useCallback(async () => {
    try {
      const [reportsRes, invitesRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/progress-reports`).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/deals/${dealId}/progress-reports/invites`).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      setReports(reportsRes.data ?? []);
      setInvites(invitesRes.data ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!expandedPhotos[id]) {
      try {
        const res = await fetch(`/api/deals/${dealId}/progress-reports/${id}/photos`);
        const json = await res.json();
        setExpandedPhotos((prev) => ({ ...prev, [id]: json.data ?? [] }));
      } catch { /* ignore */ }
    }
  };

  const createReport = async () => {
    if (!reportForm.period_start || !reportForm.period_end) return;
    try {
      const title = reportForm.title || `${reportForm.report_type === "weekly" ? "Weekly" : "Monthly"} Report – ${periodLabel(reportForm.period_start, reportForm.period_end)}`;
      const res = await fetch(`/api/deals/${dealId}/progress-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reportForm, title }),
      });
      const json = await res.json();
      setReports((prev) => [json.data, ...prev]);
      setCreateOpen(false);
      setReportForm({ report_type: "weekly", title: "", period_start: "", period_end: "" });
      toast.success("Report created");
    } catch (err) {
      toast.error("Failed to create report");
      console.error(err);
    }
  };

  const deleteReport = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/progress-reports/${id}`, { method: "DELETE" });
      setReports((prev) => prev.filter((r) => r.id !== id));
      toast.success("Report deleted");
    } catch { toast.error("Failed to delete"); }
  };

  const updateStatus = async (id: string, status: ReportStatus) => {
    try {
      const body: Record<string, unknown> = { status };
      if (status === "published") body.published_at = new Date().toISOString();
      const res = await fetch(`/api/deals/${dealId}/progress-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setReports((prev) => prev.map((r) => (r.id === id ? json.data : r)));
    } catch { toast.error("Failed to update status"); }
  };

  const generateAI = async (id: string) => {
    setGenerating(id);
    try {
      const res = await fetch(`/api/deals/${dealId}/progress-reports/${id}/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.data) {
        setReports((prev) => prev.map((r) => (r.id === id ? json.data : r)));
        toast.success("AI narratives generated");
      } else {
        toast.error(json.error || "Generation failed");
      }
    } catch {
      toast.error("AI generation failed");
    } finally {
      setGenerating(null);
    }
  };

  const createInvite = async () => {
    if (!inviteForm.email.trim()) return;
    try {
      const res = await fetch(`/api/deals/${dealId}/progress-reports/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteForm),
      });
      const json = await res.json();
      setInvites((prev) => [json.data, ...prev]);
      const token = json.token;
      if (token) {
        setNewToken(`${window.location.origin}/report-submit/${token}`);
      }
      setInviteForm({ email: "", name: "" });
      toast.success("Invite created");
    } catch { toast.error("Failed to create invite"); }
  };

  const revokeInvite = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/progress-reports/invites`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: id }),
      });
      setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, revoked_at: new Date().toISOString() } : i)));
      toast.success("Invite revoked");
    } catch { toast.error("Failed to revoke"); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(text);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading reports...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm text-muted-foreground">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Contractor Link
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Report
          </Button>
        </div>
      </div>

      {/* Active Invites */}
      {invites.filter((i) => !i.revoked_at).length > 0 && (
        <div className="rounded-lg border border-border/40 bg-card/50 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Active Contractor Links</div>
          <div className="space-y-1">
            {invites.filter((i) => !i.revoked_at).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground">{inv.name || inv.email}</span>
                <span className="text-muted-foreground">{inv.email}</span>
                <button onClick={() => revokeInvite(inv.id)} className="text-red-400 hover:text-red-300 text-2xs">
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No reports yet. Create a weekly or monthly report to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const statusConfig = REPORT_STATUS_CONFIG[report.status];
            const isExpanded = expandedId === report.id;
            const photos = expandedPhotos[report.id] ?? [];

            return (
              <div key={report.id} className="rounded-lg border border-border/40 bg-card/50">
                {/* Report Header */}
                <button
                  onClick={() => toggleExpand(report.id)}
                  className="w-full p-4 flex items-start gap-3 text-left"
                >
                  <div className="pt-0.5">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-foreground">{report.title}</span>
                      <span className={cn("text-2xs px-1.5 py-0.5 rounded-full font-medium", report.report_type === "weekly" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300")}>
                        {report.report_type}
                      </span>
                      <span className={cn("text-2xs px-1.5 py-0.5 rounded-full font-medium", statusConfig?.color)}>
                        {statusConfig?.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-2xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {periodLabel(report.period_start, report.period_end)}
                      </span>
                      {report.pct_complete != null && (
                        <span>{report.pct_complete}% complete</span>
                      )}
                      {report.submitted_by_email && (
                        <span>Submitted by {report.submitted_by_email}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => generateAI(report.id)}
                      disabled={generating === report.id}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Generate AI narratives"
                    >
                      {generating === report.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => deleteReport(report.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border/30">
                    {/* Status Actions */}
                    <div className="flex items-center gap-2 py-3 mb-3 border-b border-border/20">
                      <span className="text-xs text-muted-foreground mr-2">Status:</span>
                      {(["draft", "submitted", "reviewed", "published"] as ReportStatus[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(report.id, s)}
                          className={cn(
                            "text-2xs px-2 py-1 rounded-md transition-colors",
                            report.status === s
                              ? REPORT_STATUS_CONFIG[s].color
                              : "text-muted-foreground hover:bg-muted/30"
                          )}
                        >
                          {REPORT_STATUS_CONFIG[s].label}
                        </button>
                      ))}
                    </div>

                    {/* Contractor Input */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">Contractor Input</h4>
                        <div className="space-y-2 text-sm">
                          {report.summary && <div><span className="text-2xs text-muted-foreground">Summary:</span><p className="text-foreground">{report.summary}</p></div>}
                          {report.work_completed && <div><span className="text-2xs text-muted-foreground">Work Completed:</span><p className="text-foreground">{report.work_completed}</p></div>}
                          {report.work_planned && <div><span className="text-2xs text-muted-foreground">Work Planned:</span><p className="text-foreground">{report.work_planned}</p></div>}
                          {report.issues && <div><span className="text-2xs text-muted-foreground">Issues:</span><p className="text-foreground text-amber-300">{report.issues}</p></div>}
                          {report.weather_delays != null && <div><span className="text-2xs text-muted-foreground">Weather Delays:</span><span className="text-foreground ml-1">{report.weather_delays} days</span></div>}
                          {!report.summary && !report.work_completed && (
                            <p className="text-muted-foreground/60 text-xs italic">Contractor has not submitted yet. Share the contractor link to request input.</p>
                          )}
                        </div>
                      </div>

                      {/* AI Narratives */}
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          AI-Generated Narratives
                        </h4>
                        <div className="space-y-2 text-sm">
                          {report.ai_executive_summary && <div><span className="text-2xs text-muted-foreground">Executive Summary:</span><p className="text-foreground">{report.ai_executive_summary}</p></div>}
                          {report.ai_budget_narrative && <div><span className="text-2xs text-muted-foreground">Budget:</span><p className="text-foreground">{report.ai_budget_narrative}</p></div>}
                          {report.ai_schedule_narrative && <div><span className="text-2xs text-muted-foreground">Schedule:</span><p className="text-foreground">{report.ai_schedule_narrative}</p></div>}
                          {report.ai_risk_narrative && <div><span className="text-2xs text-muted-foreground">Risks:</span><p className="text-foreground">{report.ai_risk_narrative}</p></div>}
                          {!report.ai_executive_summary && (
                            <button
                              onClick={() => generateAI(report.id)}
                              disabled={generating === report.id}
                              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                            >
                              {generating === report.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                              Generate AI narratives
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Photos */}
                    {photos.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                          <Camera className="h-3 w-3" />
                          Photos ({photos.length})
                        </h4>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                          {photos.map((photo) => (
                            <div key={photo.id} className="aspect-square rounded-md overflow-hidden bg-muted/20 relative group">
                              <img
                                src={`/api/photos/${photo.id}`}
                                alt={photo.caption || photo.original_name}
                                className="w-full h-full object-cover"
                              />
                              {photo.caption && (
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-2xs text-white truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                  {photo.caption}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Report Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Progress Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <select
                value={reportForm.report_type}
                onChange={(e) => setReportForm({ ...reportForm, report_type: e.target.value as ReportType })}
                className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title (optional)</label>
              <input
                type="text"
                value={reportForm.title}
                onChange={(e) => setReportForm({ ...reportForm, title: e.target.value })}
                className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                placeholder="Auto-generated from dates if left blank"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Period Start *</label>
                <input
                  type="date"
                  value={reportForm.period_start}
                  onChange={(e) => setReportForm({ ...reportForm, period_start: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Period End *</label>
                <input
                  type="date"
                  value={reportForm.period_end}
                  onChange={(e) => setReportForm({ ...reportForm, period_end: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createReport} disabled={!reportForm.period_start || !reportForm.period_end}>
              Create Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contractor Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) { setNewToken(null); setInviteForm({ email: "", name: "" }); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contractor Submission Link</DialogTitle>
          </DialogHeader>

          {newToken ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Share this link with your contractor. They can submit progress updates and photos without creating an account.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newToken}
                  readOnly
                  className="flex-1 bg-card border border-border/40 rounded-md px-3 py-2 text-xs font-mono"
                />
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(newToken)}>
                  {copiedToken === newToken ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-2xs text-amber-400">This link will only be shown once. Copy it now.</p>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contractor Email *</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                  placeholder="contractor@example.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                  placeholder="GC name"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {newToken ? (
              <Button onClick={() => setInviteOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={createInvite} disabled={!inviteForm.email.trim()}>
                  Generate Link
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
