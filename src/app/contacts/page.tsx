"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Loader2,
  Plus,
  Search,
  User,
  Building2,
  Mail,
  Phone,
  Trash2,
  Pencil,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STAKEHOLDER_LABELS } from "@/lib/types";
import type { Contact, StakeholderType } from "@/lib/types";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<StakeholderType | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    name: "",
    email: "",
    phone: "",
    role: "broker" as StakeholderType,
    company: "",
    title: "",
    notes: "",
    tags: "",
  };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (roleFilter !== "all") params.set("role", roleFilter);
      const res = await fetch(`/api/contacts?${params.toString()}`);
      const json = await res.json();
      setContacts(json.data || []);
    } catch (err) {
      console.error("Failed to load contacts:", err);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (c: Contact) => {
    setEditing(c);
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
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
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
      const url = editing ? `/api/contacts/${editing.id}` : `/api/contacts`;
      const method = editing ? "PATCH" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDialogOpen(false);
      load();
    } catch (err) {
      console.error("Failed to save contact:", err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this contact? It will be unlinked from all deals.")) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="min-h-screen bg-background noise">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-xl">
        <div className="px-4 sm:px-6">
          <div className="flex items-center gap-3 h-12">
            <Link href="/">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Deals</span>
              </button>
            </Link>
            <span className="text-border text-xs">/</span>
            <span className="font-nameplate text-base leading-none tracking-tight">Contacts</span>
            <span className="text-2xs text-muted-foreground ml-1 tabular-nums">{contacts.length}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="font-nameplate text-3xl leading-none tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Workspace-shared directory of brokers, sellers, lenders, attorneys, and other stakeholders.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 h-9 flex-1 min-w-[200px] max-w-md">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or company..."
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as StakeholderType | "all")}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="all">All roles</option>
            {Object.entries(STAKEHOLDER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New Contact
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit contact" : "New contact"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Name" required>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Jane Doe"
                      className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                    />
                  </FormField>
                  <FormField label="Role">
                    <select
                      value={form.role}
                      onChange={(e) =>
                        setForm({ ...form, role: e.target.value as StakeholderType })
                      }
                      className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                    >
                      {Object.entries(STAKEHOLDER_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Company">
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      placeholder="CBRE"
                      className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                    />
                  </FormField>
                  <FormField label="Title">
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Senior Vice President"
                      className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Email">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="jane@cbre.com"
                      className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                    />
                  </FormField>
                  <FormField label="Phone">
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="(555) 123-4567"
                      className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                    />
                  </FormField>
                </div>

                <FormField label="Tags (comma-separated)">
                  <input
                    type="text"
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    placeholder="industrial, california, key relationship"
                    className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                  />
                </FormField>

                <FormField label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    placeholder="Background, relationship history, preferences..."
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  />
                </FormField>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={saving || !form.name.trim()}>
                    {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    {editing ? "Save" : "Create"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Contact list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="border border-border/60 rounded-xl bg-card p-10 text-center shadow-card">
            <User className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-muted-foreground">
              {search || roleFilter !== "all"
                ? "No contacts match your filters."
                : "No contacts yet."}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Build your team&apos;s shared directory of brokers, sellers, lenders, and other stakeholders.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {contacts.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                onEdit={() => openEdit(c)}
                onDelete={() => remove(c.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ContactCard({
  contact,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-border/60 rounded-xl bg-card p-4 shadow-card hover:border-border transition-colors group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full gradient-gold flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
            {contact.name
              .split(" ")
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{contact.name}</div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground">
              {STAKEHOLDER_LABELS[contact.role]}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"
            aria-label="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-red-400"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {contact.company && (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {contact.company}
              {contact.title && <span className="text-muted-foreground/70"> · {contact.title}</span>}
            </span>
          </div>
        )}
        {contact.email && (
          <div className="flex items-center gap-1.5">
            <Mail className="h-3 w-3 shrink-0" />
            <a
              href={`mailto:${contact.email}`}
              className="truncate hover:text-foreground"
            >
              {contact.email}
            </a>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3 w-3 shrink-0" />
            <span className="truncate">{contact.phone}</span>
          </div>
        )}
      </div>

      {contact.tags && contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/30">
          {contact.tags.map((t) => (
            <span
              key={t}
              className="text-2xs px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {contact.notes && (
        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/30 line-clamp-2">
          {contact.notes}
        </p>
      )}
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
