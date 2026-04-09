"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { STAKEHOLDER_LABELS } from "@/lib/types";
import type { Contact, StakeholderType } from "@/lib/types";

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  role: "broker" as StakeholderType,
  company: "",
  title: "",
  notes: "",
  tags: "",
};

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<StakeholderType | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (roleFilter !== "all") params.set("role", roleFilter);
      const res = await fetch(`/api/contacts?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setContacts(json.data || []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const startNew = () => {
    setEditingId("new");
    setForm(EMPTY_FORM);
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      email: c.email || "",
      phone: c.phone || "",
      role: c.role,
      company: c.company || "",
      title: c.title || "",
      notes: c.notes || "",
      tags: (c.tags || []).join(", "),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        role: form.role,
        company: form.company.trim() || null,
        title: form.title.trim() || null,
        notes: form.notes.trim() || null,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const isNew = editingId === "new";
      const res = await fetch(
        isNew ? "/api/contacts" : `/api/contacts/${editingId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      toast.success(isNew ? "Contact created" : "Contact updated");
      setEditingId(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete contact "${name}"? They will be unlinked from all deals.`)) return;
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");
      toast.success("Contact deleted");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Contacts Directory</h2>
          <p className="text-xs text-neutral-500">
            Workspace-shared contacts. Edit anything here as an admin — changes are visible to all users.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startNew}
            className="px-3 py-1.5 text-sm rounded bg-indigo-500 hover:bg-indigo-400 text-white shrink-0"
          >
            + New contact
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search by name, email, or company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as StakeholderType | "all")}
          className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
        >
          <option value="all">All roles</option>
          {Object.entries(STAKEHOLDER_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Edit form (shown when editing or creating) */}
      {editingId !== null && (
        <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-4 space-y-3">
          <div className="text-xs font-medium text-indigo-300">
            {editingId === "new" ? "New contact" : "Editing contact"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label="Name *">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Doe"
                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
              />
            </AdminField>
            <AdminField label="Role">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as StakeholderType })}
                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
              >
                {Object.entries(STAKEHOLDER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Company">
              <input
                type="text"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="CBRE"
                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
              />
            </AdminField>
            <AdminField label="Title">
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Senior Vice President"
                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
              />
            </AdminField>
            <AdminField label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@cbre.com"
                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
              />
            </AdminField>
            <AdminField label="Phone">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(555) 123-4567"
                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
              />
            </AdminField>
          </div>
          <AdminField label="Tags (comma-separated)">
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="industrial, california, key relationship"
              className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
            />
          </AdminField>
          <AdminField label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Background, preferences, relationship history..."
              className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1.5 text-sm"
            />
          </AdminField>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={cancelEdit}
              className="px-3 py-1.5 text-sm rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !form.name.trim()}
              className="px-3 py-1.5 text-sm rounded bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId === "new" ? "Create" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : contacts.length === 0 ? (
        <div className="text-sm text-neutral-500 py-4 text-center">
          {search || roleFilter !== "all" ? "No contacts match your filters." : "No contacts yet."}
        </div>
      ) : (
        <div className="border border-neutral-800 rounded-lg overflow-hidden max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/80 text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-left px-3 py-2 font-medium">Company</th>
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Phone</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-neutral-900/40">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-neutral-400">{STAKEHOLDER_LABELS[c.role]}</td>
                  <td className="px-3 py-2 text-neutral-400">
                    {c.company || "—"}
                    {c.title && <span className="text-neutral-600"> · {c.title}</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{c.email || "—"}</td>
                  <td className="px-3 py-2 text-neutral-400">{c.phone || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => startEdit(c)}
                      className="text-xs text-indigo-300 hover:text-indigo-200 mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(c.id, c.name)}
                      className="text-xs text-rose-300 hover:text-rose-200"
                    >
                      Delete
                    </button>
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

function AdminField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
