"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Entry {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/audit");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setEntries(json.data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit Log</h2>
          <p className="text-xs text-neutral-500">Recent admin actions, most recent first.</p>
        </div>
        <button
          onClick={load}
          className="text-xs px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-neutral-500">No audit entries yet.</div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-900 text-neutral-500 uppercase tracking-wide sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Who</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-neutral-900/60">
                  <td className="px-3 py-1.5 text-neutral-500 whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5">{e.user_email ?? e.user_id ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{e.action}</td>
                  <td className="px-3 py-1.5 text-neutral-500">
                    {e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-400">
                    {e.metadata ? (
                      <code className="text-[10px]">{JSON.stringify(e.metadata)}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
