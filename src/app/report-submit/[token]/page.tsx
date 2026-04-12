"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Camera,
  Upload,
  CheckCircle2,
  FileText,
  AlertTriangle,
  Loader2,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────

interface InviteInfo {
  email: string;
  name: string | null;
  deal_name: string;
  deal_address: string | null;
  deal_city: string | null;
  deal_state: string | null;
}

interface Report {
  id: string;
  title: string;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  summary: string | null;
  work_completed: string | null;
  work_planned: string | null;
  issues: string | null;
  weather_delays: number | null;
  pct_complete: number | null;
}

interface ReportPhoto {
  id: string;
  original_name: string;
  file_path: string;
  mime_type: string;
}

// ── Page Component ───────────────────────────────────────────────────────

export default function ReportSubmitPage({
  params,
}: {
  params: { token: string };
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/report-submit/${params.token}`);
      if (!res.ok) {
        setError("This link is invalid or has expired.");
        return;
      }
      const json = await res.json();
      setInvite(json.invite);
      setReports(json.reports || []);
    } catch {
      setError("Failed to load. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-md space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            Access not available
          </h1>
          <p className="text-sm text-muted-foreground">
            {error || "This link is invalid, expired, or has been revoked."}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-md space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            Report Submitted
          </h1>
          <p className="text-sm text-muted-foreground">
            Thank you, your progress report has been submitted successfully. The
            deal team will review it shortly.
          </p>
          <button
            onClick={() => {
              setSubmitted(false);
              setSelectedReport(null);
              load();
            }}
            className="text-sm text-primary hover:underline"
          >
            Submit another report
          </button>
        </div>
      </div>
    );
  }

  const dealLocation = [invite.deal_city, invite.deal_state]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-gold flex items-center justify-center flex-shrink-0">
            <Building2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {invite.deal_name}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {invite.deal_address
                ? `${invite.deal_address}${dealLocation ? ` \u00B7 ${dealLocation}` : ""}`
                : dealLocation || "Progress Report Submission"}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">
            Progress Report Submission
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {invite.name ? `Welcome, ${invite.name}` : `Submitting as ${invite.email}`}
            . Select a report below to submit your update.
          </p>
        </div>

        {!selectedReport ? (
          /* Report list */
          <div className="space-y-3">
            {reports.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border/40 rounded-xl">
                <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No reports are currently assigned for submission.
                </p>
              </div>
            ) : (
              reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className={cn(
                    "w-full text-left border rounded-xl p-4 transition-all duration-200",
                    "hover:border-primary/40 hover:bg-card/60",
                    report.status === "submitted"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border/40 bg-card/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">
                          {report.title || "Untitled Report"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {report.report_type === "weekly"
                          ? "Weekly"
                          : report.report_type === "monthly"
                            ? "Monthly"
                            : report.report_type}
                        {report.period_start && report.period_end
                          ? ` \u00B7 ${formatDate(report.period_start)} \u2013 ${formatDate(report.period_end)}`
                          : ""}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded-full flex-shrink-0",
                        report.status === "submitted"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      )}
                    >
                      {report.status}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          /* Report submission form */
          <ReportForm
            token={params.token}
            report={selectedReport}
            onBack={() => setSelectedReport(null)}
            onSubmitted={() => setSubmitted(true)}
          />
        )}
      </main>
    </div>
  );
}

// ── Report Form ──────────────────────────────────────────────────────────

function ReportForm({
  token,
  report,
  onBack,
  onSubmitted,
}: {
  token: string;
  report: Report;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const [summary, setSummary] = useState(report.summary || "");
  const [workCompleted, setWorkCompleted] = useState(
    report.work_completed || ""
  );
  const [workPlanned, setWorkPlanned] = useState(report.work_planned || "");
  const [issues, setIssues] = useState(report.issues || "");
  const [weatherDelays, setWeatherDelays] = useState<number>(
    report.weather_delays ?? 0
  );
  const [pctComplete, setPctComplete] = useState<number>(
    report.pct_complete ?? 0
  );
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<ReportPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing photos for this report
  useEffect(() => {
    async function loadPhotos() {
      try {
        const res = await fetch(`/api/report-submit/${token}`);
        if (!res.ok) return;
        const json = await res.json();
        // Photos would need a separate endpoint; for now we note they exist
        // via the report data. We leave existingPhotos empty unless we extend
        // the GET endpoint.
        void json;
      } catch {
        // Silently ignore
      }
    }
    loadPhotos();
  }, [token, report.id]);

  // Generate previews
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function handleFilesSelected(selected: FileList | null) {
    if (!selected) return;
    const imageFiles = Array.from(selected).filter((f) =>
      f.type.startsWith("image/")
    );
    setFiles((prev) => [...prev, ...imageFiles]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Submit the report data
      const reportRes = await fetch(`/api/report-submit/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: report.id,
          summary,
          work_completed: workCompleted,
          work_planned: workPlanned,
          issues,
          weather_delays: weatherDelays,
          pct_complete: pctComplete,
        }),
      });

      if (!reportRes.ok) {
        const err = await reportRes.json();
        setErrorMsg(err.error || "Failed to submit report.");
        return;
      }

      // 2. Upload photos if any
      if (files.length > 0) {
        const formData = new FormData();
        formData.append("report_id", report.id);
        for (const file of files) {
          formData.append("files", file);
        }

        const photoRes = await fetch(
          `/api/report-submit/${token}/photos`,
          { method: "POST", body: formData }
        );

        if (!photoRes.ok) {
          // Report was submitted but photos failed — still count as success
          console.error("Photo upload failed but report was submitted");
        }
      }

      onSubmitted();
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to reports
        </button>
        <span className="text-border/40">|</span>
        <span className="text-sm font-medium text-foreground truncate">
          {report.title || "Untitled Report"}
        </span>
      </div>

      {/* Form fields */}
      <div className="space-y-5">
        {/* Summary */}
        <FieldGroup label="Summary">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Brief summary of progress this period..."
            rows={3}
            className={cn(
              "w-full rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-sm",
              "placeholder:text-muted-foreground/40 outline-none",
              "focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            )}
          />
        </FieldGroup>

        {/* Work Completed */}
        <FieldGroup label="Work Completed This Period">
          <textarea
            value={workCompleted}
            onChange={(e) => setWorkCompleted(e.target.value)}
            placeholder="Describe work completed during this reporting period..."
            rows={4}
            className={cn(
              "w-full rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-sm",
              "placeholder:text-muted-foreground/40 outline-none",
              "focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            )}
          />
        </FieldGroup>

        {/* Work Planned */}
        <FieldGroup label="Work Planned Next Period">
          <textarea
            value={workPlanned}
            onChange={(e) => setWorkPlanned(e.target.value)}
            placeholder="Describe work planned for the next reporting period..."
            rows={4}
            className={cn(
              "w-full rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-sm",
              "placeholder:text-muted-foreground/40 outline-none",
              "focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            )}
          />
        </FieldGroup>

        {/* Issues */}
        <FieldGroup label="Issues & Concerns">
          <textarea
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            placeholder="Note any issues, delays, or concerns..."
            rows={3}
            className={cn(
              "w-full rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-sm",
              "placeholder:text-muted-foreground/40 outline-none",
              "focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            )}
          />
        </FieldGroup>

        {/* Weather Delays + % Complete row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FieldGroup label="Weather Delay Days">
            <input
              type="number"
              min={0}
              value={weatherDelays}
              onChange={(e) =>
                setWeatherDelays(Math.max(0, parseInt(e.target.value) || 0))
              }
              className={cn(
                "w-full rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-sm",
                "outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              )}
            />
          </FieldGroup>

          <FieldGroup label={`Overall % Complete: ${pctComplete}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={pctComplete}
              onChange={(e) => setPctComplete(parseInt(e.target.value))}
              className="w-full accent-primary h-2 rounded-full cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </FieldGroup>
        </div>

        {/* Photo upload */}
        <FieldGroup label="Photos">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFilesSelected(e.dataTransfer.files);
            }}
            className={cn(
              "border-2 border-dashed border-border/40 rounded-xl p-6 text-center cursor-pointer",
              "hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-muted/20 flex items-center justify-center">
                <Camera className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="text-primary font-medium">Click to upload</span>{" "}
                or drag and drop
              </div>
              <div className="text-xs text-muted-foreground/60">
                PNG, JPG, HEIC up to 25MB each
              </div>
            </div>
          </div>

          {/* Existing photos */}
          {existingPhotos.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">
                Previously uploaded
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {existingPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className="aspect-square rounded-lg overflow-hidden border border-border/40 bg-muted/10"
                  >
                    <img
                      src={photo.file_path}
                      alt={photo.original_name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New file previews */}
          {previews.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">
                New photos ({files.length})
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {previews.map((url, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded-lg overflow-hidden border border-border/40 bg-muted/10 group"
                  >
                    <img
                      src={url}
                      alt={files[i]?.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                      className={cn(
                        "absolute top-1 right-1 w-5 h-5 rounded-full",
                        "bg-black/60 text-white text-xs flex items-center justify-center",
                        "opacity-0 group-hover:opacity-100 transition-opacity"
                      )}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </FieldGroup>

        {/* Error */}
        {errorMsg && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {errorMsg}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={cn(
            "w-full h-11 rounded-lg text-sm font-medium transition-all duration-200",
            "gradient-gold text-primary-foreground shadow-md",
            "hover:shadow-lg hover:brightness-110 active:scale-[0.98]",
            "disabled:opacity-40 disabled:pointer-events-none",
            "flex items-center justify-center gap-2"
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Submit Progress Report
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
