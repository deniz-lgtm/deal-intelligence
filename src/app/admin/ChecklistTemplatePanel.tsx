"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Item {
  id: string;
  category: string;
  item: string;
  sort_order: number;
}

export default function ChecklistTemplatePanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState("");
  const [newItem, setNewItem] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/checklist-template");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setItems(json.data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!newCategory.trim() || !newItem.trim()) return;
    try {
      const res = await fetch("/api/admin/checklist-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory.trim(), item: newItem.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add");
      setItems(json.data);
      setNewItem("");
      toast.success("Item added");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this checklist item from the template?")) return;
    try {
      const res = await fetch(`/api/admin/checklist-template?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");
      setItems(json.data);
      toast.success("Removed");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  // Group by category
  const grouped: Record<string, Item[]> = {};
  for (const it of items) {
    (grouped[it.category] = grouped[it.category] || []).push(it);
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Diligence Checklist Template</h2>
        <p className="text-xs text-neutral-500">
          Items here are seeded into every newly created deal. Existing deals are not affected.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          placeholder="Category"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="w-44 bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
          list="checklist-categories"
        />
        <datalist id="checklist-categories">
          {Object.keys(grouped).map((c) => <option key={c} value={c} />)}
        </datalist>
        <input
          placeholder="Checklist item"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={!newCategory.trim() || !newItem.trim()}
          className="px-3 py-1.5 text-sm rounded bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : (
        <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
          {Object.entries(grouped).map(([category, list]) => (
            <div key={category}>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                {category} ({list.length})
              </div>
              <ul className="border border-neutral-800 rounded-lg divide-y divide-neutral-800">
                {list.map((it) => (
                  <li key={it.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span>{it.item}</span>
                    <button
                      onClick={() => remove(it.id)}
                      className="text-xs text-rose-300 hover:text-rose-200"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
