"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Inbox as InboxIcon,
  RefreshCw,
  Settings,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  FolderOpen,
  Save,
  AlertCircle,
  Cloud,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import type { BusinessPlan, InvestmentThesis, PropertyType } from "@/lib/types";
import { INVESTMENT_THESIS_LABELS } from "@/lib/types";

// AI Deal Sourcing inbox. Polls a watched Dropbox folder on demand and
// auto-creates draft deals for any new OM files it finds. Each card shows
// the extracted headline (name, address, price, units) and lets the analyst
// Open (review in the deal detail page) or Dismiss (mark reviewed + move to
// dead stage).

interface InboxItem {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  property_type: string | null;
  investment_strategy: string | null;
  business_plan_id: string | null;
  asking_price: number | null;
  units: number | null;
  square_footage: number | null;
  year_built: number | null;
  created_at: string;
  ingested_from_path: string | null;
  notes: string | null;
  // Surfaced by the inbox query — present only if analysis has been started
  analysis_id: string | null;
  analysis_status: "pending" | "processing" | "complete" | "error" | null;
  analysis_deal_score: number | null;
}

const PROPERTY_TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "multifamily", label: "Multifamily" },
  { value: "student_housing", label: "Student Housing" },
  { value: "industrial", label: "Industrial" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "mixed_use", label: "Mixed Use" },
  { value: "land", label: "Land" },
  { value: "hospitality", label: "Hospitality" },
  { value: "other", label: "Other" },
];

const INVESTMENT_STRATEGY_OPTIONS: { value: InvestmentThesis; label: string }[] = [
  { value: "value_add", label: INVESTMENT_THESIS_LABELS.value_add },
  { value: "ground_up", label: INVESTMENT_THESIS_LABELS.ground_up },
  { value: "core", label: INVESTMENT_THESIS_LABELS.core },
  { value: "core_plus", label: INVESTMENT_THESIS_LABELS.core_plus },
  { value: "opportunistic", label: INVESTMENT_THESIS_LABELS.opportunistic },
];

interface InboxSettings {
  connected: boolean;
  display_name: string | null;
  email: string | null;
  watched_folder_path: string | null;
  last_polled_at: string | null;
  pending_count: number;
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [plans, setPlans] = useState<BusinessPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const autoPolledRef = useRef(false);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/items");
      const json = await res.json();
      setItems(json.data || []);
    } catch {
      toast.error("Failed to load inbox");
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/settings");
      const json = await res.json();
      setSettings(json.data || null);
      if (json.data?.watched_folder_path) {
        setFolderDraft(json.data.watched_folder_path);
      }
    } catch {
      toast.error("Failed to load settings");
    }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/business-plans");
      const json = await res.json();
      setPlans(json.data || []);
    } catch {
      // Non-fatal — the Start Analysis card will show a prompt to create one.
    }
  }, []);

  useEffect(() => {
    Promise.all([loadItems(), loadSettings(), loadPlans()]).finally(() =>
      setLoading(false)
    );
  }, [loadItems, loadSettings, loadPlans]);

  async function handlePoll(opts: { silent?: boolean } = {}) {
    setPolling(true);
    try {
      const res = await fetch("/api/inbox/poll", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (!opts.silent) {
          toast.error(json.error || "Polling failed");
        }
        // Still refresh settings to show the connection / folder state
        loadSettings();
        return;
      }
      const { ingested, skipped_duplicate, errors } = json.data;
      await Promise.all([loadItems(), loadSettings()]);
      if (!opts.silent) {
        if (ingested > 0) {
          toast.success(
            `Ingested ${ingested} new OM${ingested === 1 ? "" : "s"}` +
              (errors > 0 ? ` (${errors} failed)` : "")
          );
        } else if (skipped_duplicate > 0) {
          toast(`No new files (${skipped_duplicate} already ingested)`);
        } else {
          toast("No new files in the watched folder");
        }
      }
    } finally {
      setPolling(false);
    }
  }

  // Auto-poll once on first load if the user has a folder configured and
  // the last poll was more than 60 seconds ago (or never).
  useEffect(() => {
    if (autoPolledRef.current) return;
    if (!settings?.connected || !settings?.watched_folder_path) return;
    const lastMs = settings.last_polled_at
      ? new Date(settings.last_polled_at).getTime()
      : 0;
    const ageSec = (Date.now() - lastMs) / 1000;
    if (ageSec > 60) {
      autoPolledRef.current = true;
      handlePoll({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.connected, settings?.watched_folder_path]);

  async function handleReview(id: string, dismiss: boolean) {
    try {
      const res = await fetch(`/api/inbox/items/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismiss }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "Failed to update item");
        return;
      }
      toast.success(dismiss ? "Dismissed" : "Marked reviewed");
      loadItems();
    } catch {
      toast.error("Failed to update item");
    }
  }

  async function handleSaveFolder() {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/inbox/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watched_folder_path: folderDraft || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to save folder");
        return;
      }
      toast.success("Watched folder updated");
      loadSettings();
    } finally {
      setSavingSettings(false);
    }
  }

  const lastPolledLabel = settings?.last_polled_at
    ? formatRelative(settings.last_polled_at)
    : "never";

  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <header className="relative overflow-hidden border-b border-border/40 shrink-0">
          <div className="absolute inset-0 gradient-mesh" />
          <div className="relative max-w-full mx-auto px-6 sm:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-3">
                <InboxIcon className="h-4 w-4 text-primary" />
                <span className="font-display text-base text-foreground tracking-tight">
                  Inbox
                </span>
                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  AI Deal Sourcing · {items.length} pending
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSettingsOpen((v) => !v)}
                >
                  <Settings className="h-3.5 w-3.5 mr-1.5" />
                  Settings
                </Button>
                <Button
                  size="sm"
                  onClick={() => handlePoll()}
                  disabled={
                    polling ||
                    !settings?.connected ||
                    !settings?.watched_folder_path
                  }
                >
                  {polling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Poll Now
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Settings panel */}
        {settingsOpen && (
          <div className="shrink-0 border-b border-border/30 bg-card/30 backdrop-blur-sm animate-fade-up">
            <div className="max-w-full mx-auto px-6 sm:px-8 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <Cloud className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  {settings?.connected ? (
                    <div className="text-xs">
                      <div className="text-foreground font-medium">
                        Dropbox connected
                      </div>
                      <div className="text-muted-foreground">
                        {settings.display_name || settings.email || "Account"}{" "}
                        · Last polled: {lastPolledLabel}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs">
                      <div className="text-foreground font-medium">
                        Dropbox not connected
                      </div>
                      <div className="text-muted-foreground">
                        Connect a Dropbox account to watch a folder for
                        incoming OMs.
                      </div>
                      <a
                        href="/api/dropbox/auth?return=inbox"
                        className="inline-flex items-center gap-1 mt-2 text-primary hover:underline"
                      >
                        Connect Dropbox <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {settings?.connected && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                      Watched Folder Path
                    </label>
                    <div className="flex items-center border border-border/40 rounded-lg bg-muted/20 overflow-hidden">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground ml-3" />
                      <input
                        type="text"
                        value={folderDraft}
                        onChange={(e) => setFolderDraft(e.target.value)}
                        placeholder="/OM Inbox"
                        className="flex-1 px-3 py-1.5 text-xs bg-transparent outline-none font-mono"
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Absolute path starting with <code>/</code>. Create a
                      folder in your Dropbox and drop OMs into it.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSaveFolder}
                    disabled={
                      savingSettings ||
                      folderDraft === (settings.watched_folder_path || "")
                    }
                  >
                    {savingSettings ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 max-w-5xl mx-auto w-full px-6 sm:px-8 py-6 space-y-3">
          {/* Guardrail banners */}
          {!loading && !settings?.connected && !settingsOpen && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-300" />
              <div className="flex-1">
                <div className="text-foreground font-medium">
                  Dropbox not connected
                </div>
                <div className="text-muted-foreground">
                  Open Settings above to connect a Dropbox account and pick a
                  folder to watch for OMs.
                </div>
              </div>
            </div>
          )}
          {!loading &&
            settings?.connected &&
            !settings.watched_folder_path &&
            !settingsOpen && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-300" />
                <div className="flex-1">
                  <div className="text-foreground font-medium">
                    No watched folder
                  </div>
                  <div className="text-muted-foreground">
                    Pick a Dropbox folder in Settings to start auto-ingesting.
                  </div>
                </div>
              </div>
            )}

          {/* Items list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              connected={settings?.connected ?? false}
              hasFolder={!!settings?.watched_folder_path}
              onOpenSettings={() => setSettingsOpen(true)}
              onPoll={() => handlePoll()}
              polling={polling}
            />
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  plans={plans}
                  onAnalysisStarted={() => loadItems()}
                  onOpen={(id) => handleReview(id, false)}
                  onDismiss={(id) => handleReview(id, true)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

function InboxCard({
  item,
  plans,
  onAnalysisStarted,
  onOpen,
  onDismiss,
}: {
  item: InboxItem;
  plans: BusinessPlan[];
  onAnalysisStarted: () => void;
  onOpen: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const loc = [item.city, item.state].filter(Boolean).join(", ");
  const analysisStarted = item.analysis_status != null;

  return (
    <div className="border border-border/40 rounded-xl bg-card p-4 hover:border-border/70 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="font-medium text-foreground truncate">
              {item.name || "Untitled OM"}
            </div>
            <StatusBadge status={item.analysis_status} />
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {item.address ? `${item.address}${loc ? ", " + loc : ""}` : loc || "—"}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
            {item.asking_price != null && (
              <span>
                <span className="text-foreground font-medium">
                  {formatCurrency(item.asking_price)}
                </span>{" "}
                ask
              </span>
            )}
            {item.units != null && item.units > 0 && (
              <span>
                <span className="text-foreground font-medium">{item.units}</span>{" "}
                units
              </span>
            )}
            {item.square_footage != null && item.square_footage > 0 && (
              <span>
                <span className="text-foreground font-medium">
                  {Math.round(item.square_footage).toLocaleString()}
                </span>{" "}
                SF
              </span>
            )}
            {item.year_built != null && item.year_built > 0 && (
              <span>
                Built{" "}
                <span className="text-foreground font-medium">
                  {item.year_built}
                </span>
              </span>
            )}
          </div>
          {item.ingested_from_path && (
            <div className="mt-1.5 text-[10px] text-muted-foreground/70 truncate font-mono">
              {item.ingested_from_path}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {analysisStarted ? (
            <Link
              href={`/deals/${item.id}/om-analysis`}
              onClick={() => onOpen(item.id)}
            >
              <Button size="sm" variant="outline">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Review
              </Button>
            </Link>
          ) : null}
          <button
            onClick={() => onDismiss(item.id)}
            className="p-2 text-muted-foreground hover:text-red-400 transition-colors"
            title="Dismiss (move to dead)"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!analysisStarted && (
        <StartAnalysisPanel
          item={item}
          plans={plans}
          onStarted={onAnalysisStarted}
        />
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: InboxItem["analysis_status"];
}) {
  if (status == null) {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase tracking-wide">
        New
      </span>
    );
  }
  if (status === "processing" || status === "pending") {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 font-medium uppercase tracking-wide inline-flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Analyzing
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 font-medium uppercase tracking-wide">
        Ready
      </span>
    );
  }
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-300 font-medium uppercase tracking-wide">
      Error
    </span>
  );
}

function StartAnalysisPanel({
  item,
  plans,
  onStarted,
}: {
  item: InboxItem;
  plans: BusinessPlan[];
  onStarted: () => void;
}) {
  // Prefill from whatever stage-1 extraction or ingest suggested.
  const [businessPlanId, setBusinessPlanId] = useState<string>(
    item.business_plan_id || plans.find((p) => p.is_default)?.id || ""
  );
  const [propertyType, setPropertyType] = useState<string>(
    item.property_type || ""
  );
  const [investmentStrategy, setInvestmentStrategy] = useState<string>(
    item.investment_strategy || ""
  );
  const [starting, setStarting] = useState(false);

  // Re-sync when plans arrive after initial render.
  useEffect(() => {
    if (!businessPlanId) {
      const def = plans.find((p) => p.is_default);
      if (def) setBusinessPlanId(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans.length]);

  const canStart =
    !!businessPlanId && !!propertyType && !!investmentStrategy && !starting;

  async function handleStart() {
    setStarting(true);
    try {
      const res = await fetch(`/api/inbox/items/${item.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_plan_id: businessPlanId,
          property_type: propertyType,
          investment_strategy: investmentStrategy,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Failed to start analysis");
        return;
      }
      toast.success("Analysis started — it'll appear here when ready");
      onStarted();
    } catch {
      toast.error("Failed to start analysis");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/40 grid gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <DropdownField
          label="Business Plan"
          value={businessPlanId}
          onChange={setBusinessPlanId}
          placeholder={plans.length === 0 ? "No plans — create one" : "Select…"}
          disabled={plans.length === 0}
          options={plans.map((p) => ({
            value: p.id,
            label: p.name + (p.is_default ? " ★" : ""),
          }))}
        />
        <DropdownField
          label="Property Type"
          value={propertyType}
          onChange={setPropertyType}
          placeholder="Select…"
          options={PROPERTY_TYPE_OPTIONS.map((p) => ({
            value: p.value,
            label: p.label,
          }))}
        />
        <DropdownField
          label="Investment Strategy"
          value={investmentStrategy}
          onChange={setInvestmentStrategy}
          placeholder="Select…"
          options={INVESTMENT_STRATEGY_OPTIONS.map((s) => ({
            value: s.value,
            label: s.label,
          }))}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {plans.length === 0 ? (
          <Link
            href="/business-plans"
            className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
          >
            Create a business plan <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            Pick a plan, property type, and strategy to calibrate analysis.
          </div>
        )}
        <Button size="sm" onClick={handleStart} disabled={!canStart}>
          {starting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          )}
          Start Analysis
        </Button>
      </div>
    </div>
  );
}

function DropdownField({
  label,
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border/40 bg-muted/20 outline-none focus:border-primary/40 disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyState({
  connected,
  hasFolder,
  onOpenSettings,
  onPoll,
  polling,
}: {
  connected: boolean;
  hasFolder: boolean;
  onOpenSettings: () => void;
  onPoll: () => void;
  polling: boolean;
}) {
  return (
    <div className="text-center py-20 max-w-lg mx-auto space-y-4">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <InboxIcon className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-lg font-display font-semibold">
        {connected && hasFolder ? "Inbox is empty" : "Set up your inbox"}
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Drop offering memorandums into your watched Dropbox folder and
        they&apos;ll appear here as draft deals with auto-extracted fields.
        Review each one, then the deal moves into your pipeline.
      </p>
      <div className="flex items-center justify-center gap-2">
        {!connected || !hasFolder ? (
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Open Settings
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onPoll}
            disabled={polling}
          >
            {polling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Poll Now
          </Button>
        )}
      </div>
    </div>
  );
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

