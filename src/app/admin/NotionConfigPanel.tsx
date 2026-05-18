"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

interface NotionSourceStatus {
  key: string;
  label: string;
  env: string;
  id: string;
  configured_from_env: boolean;
  status: "ok" | "error" | "not_checked";
  notion_name: string | null;
  error: string | null;
}

interface NotionRegistryStatus {
  api_key_configured: boolean;
  sources: NotionSourceStatus[];
}

export default function NotionConfigPanel() {
  const [config, setConfig] = useState<NotionRegistryStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notion-config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load Notion mapping");
      setConfig(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Notion mapping");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const okCount = config?.sources.filter((source) => source.status === "ok").length ?? 0;
  const errorCount = config?.sources.filter((source) => source.status === "error").length ?? 0;

  return (
    <section className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Notion Database Mapping</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">
            These are the Notion databases Deal Intelligence uses when it creates Pipeline projects
            and pushes approved tasks, RFIs, risks, notes, documents, and playbook records. Pipeline
            is the required relation for every downstream push.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Check
        </button>
      </div>

      {loading && !config ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking Notion data sources
        </div>
      ) : config ? (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <SummaryPill label="API key" value={config.api_key_configured ? "Configured" : "Missing"} tone={config.api_key_configured ? "ok" : "bad"} />
            <SummaryPill label="Reachable" value={String(okCount)} tone={okCount > 0 ? "ok" : "neutral"} />
            <SummaryPill label="Needs attention" value={String(errorCount)} tone={errorCount > 0 ? "bad" : "neutral"} />
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <div className="grid grid-cols-[1.05fr_1fr_1.35fr_90px] border-b border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
              <span>Database</span>
              <span>Env variable</span>
              <span>Data source ID</span>
              <span>Status</span>
            </div>
            {config.sources.map((source) => (
              <div
                key={source.key}
                className="grid grid-cols-[1.05fr_1fr_1.35fr_90px] items-center gap-3 border-b border-neutral-800/70 px-3 py-3 text-xs last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="font-medium text-neutral-100">{source.label}</div>
                  <div className="mt-0.5 truncate text-[11px] text-neutral-500">
                    {source.notion_name || (source.configured_from_env ? "Configured from env" : "Using default ID")}
                  </div>
                </div>
                <code className="truncate text-[11px] text-neutral-400">{source.env}</code>
                <code className="truncate text-[11px] text-neutral-500">{source.id}</code>
                <StatusBadge status={source.status} error={source.error} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: "ok" | "bad" | "neutral" }) {
  const colors =
    tone === "ok"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
      : tone === "bad"
        ? "border-red-500/25 bg-red-500/10 text-red-200"
        : "border-neutral-800 bg-neutral-950/40 text-neutral-300";
  return (
    <div className={`rounded-lg border px-3 py-2 ${colors}`}>
      <div className="text-[10px] uppercase tracking-[0.14em] opacity-70">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: NotionSourceStatus["status"]; error: string | null }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center justify-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        OK
      </span>
    );
  }

  return (
    <span
      title={error || undefined}
      className="inline-flex items-center justify-center gap-1 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-200"
    >
      <TriangleAlert className="h-3 w-3" />
      Check
    </span>
  );
}
