"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface AiPrompt {
  key: string;
  label: string;
  description: string | null;
  default_prompt: string;
  prompt: string;
}

interface AiConfig {
  model: string;
  availableModels: string[];
  prompts: AiPrompt[];
}

export default function AiConfigPanel() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai-config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setConfig(json.data);
      setDrafts(Object.fromEntries(json.data.prompts.map((p: AiPrompt) => [p.key, p.prompt])));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function changeModel(model: string) {
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update model");
      setConfig(json.data);
      toast.success(`Model set to ${model}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function savePrompt(key: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: [{ key, prompt: drafts[key] }] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save prompt");
      setConfig(json.data);
      toast.success("Prompt saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetPrompt(key: string) {
    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPrompt: key }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to reset");
      setConfig(json.data);
      const updated = json.data.prompts.find((p: AiPrompt) => p.key === key);
      if (updated) setDrafts((d) => ({ ...d, [key]: updated.prompt }));
      toast.success("Prompt reset to default");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">AI Configuration</h2>
        <p className="text-xs text-neutral-500">Pick the Claude model and edit system prompts without redeploying.</p>
      </div>

      {loading || !config ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-400">Model</label>
            <select
              value={config.model}
              onChange={(e) => changeModel(e.target.value)}
              className="bg-neutral-950 border border-neutral-700 rounded px-3 py-1.5 text-sm"
            >
              {config.availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {config.prompts.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              No editable prompts yet. They&apos;ll appear here automatically the first time the
              corresponding feature is used.
            </p>
          ) : (
            <div className="space-y-4">
              {config.prompts.map((p) => (
                <div key={p.key} className="border border-neutral-800 rounded-lg p-3 space-y-2">
                  <div>
                    <div className="text-sm font-medium">{p.label}</div>
                    {p.description && (
                      <div className="text-xs text-neutral-500">{p.description}</div>
                    )}
                  </div>
                  <textarea
                    value={drafts[p.key] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                    rows={8}
                    className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 text-xs font-mono"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => savePrompt(p.key)}
                      disabled={saving || drafts[p.key] === p.prompt}
                      className="text-xs px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => resetPrompt(p.key)}
                      className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800"
                    >
                      Reset to default
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
