"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Stage {
  id: string;
  label: string;
  sort_order: number;
  color: string | null;
  is_terminal: boolean;
}

export default function PipelinePanel() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pipeline");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setStages(json.data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(id: string, patch: Partial<Stage>) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function move(id: string, direction: -1 | 1) {
    setStages((prev) => {
      const sorted = [...prev].sort((a, b) => a.sort_order - b.sort_order);
      const idx = sorted.findIndex((s) => s.id === id);
      if (idx < 0 || idx + direction < 0 || idx + direction >= sorted.length) return prev;
      const swapped = [...sorted];
      [swapped[idx], swapped[idx + direction]] = [swapped[idx + direction], swapped[idx]];
      return swapped.map((s, i) => ({ ...s, sort_order: i }));
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/pipeline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setStages(json.data);
      toast.success("Pipeline updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Pipeline Stages</h2>
        <p className="text-xs text-neutral-500">
          Rename and reorder kanban columns. Stage IDs are fixed (the underlying deal status string),
          but the displayed label and order are editable.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : (
        <>
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-lg overflow-hidden">
            {sorted.map((stage, i) => (
              <li key={stage.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex flex-col">
                  <button
                    onClick={() => move(stage.id, -1)}
                    disabled={i === 0}
                    className="text-neutral-500 hover:text-neutral-200 disabled:opacity-30 text-xs"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(stage.id, 1)}
                    disabled={i === sorted.length - 1}
                    className="text-neutral-500 hover:text-neutral-200 disabled:opacity-30 text-xs"
                  >
                    ▼
                  </button>
                </div>
                <code className="text-xs text-neutral-500 w-32 truncate">{stage.id}</code>
                <input
                  value={stage.label}
                  onChange={(e) => update(stage.id, { label: e.target.value })}
                  className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  placeholder="#color"
                  value={stage.color ?? ""}
                  onChange={(e) => update(stage.id, { color: e.target.value || null })}
                  className="w-24 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs"
                />
                <label className="text-xs text-neutral-400 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={stage.is_terminal}
                    onChange={(e) => update(stage.id, { is_terminal: e.target.checked })}
                  />
                  terminal
                </label>
              </li>
            ))}
          </ul>
          <button
            onClick={save}
            disabled={saving}
            className="text-sm px-4 py-2 rounded bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save pipeline"}
          </button>
        </>
      )}
    </section>
  );
}
