"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Loader2,
  Plus,
  User,
  Building2,
  Mail,
  Phone,
  Trash2,
  ExternalLink,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import ContactPicker from "@/components/ContactPicker";
import { STAKEHOLDER_LABELS } from "@/lib/types";
import type { Contact, DealContactLink, StakeholderType } from "@/lib/types";

export default function DealContactsPage({ params }: { params: { id: string } }) {
  const [links, setLinks] = useState<DealContactLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [pickedContact, setPickedContact] = useState<Contact | null>(null);
  const [roleOnDeal, setRoleOnDeal] = useState("");
  const [linkNotes, setLinkNotes] = useState("");
  const [linking, setLinking] = useState(false);

  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ role_on_deal: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/contacts`);
      const json = await res.json();
      setLinks(json.data || []);
    } catch (err) {
      console.error("Failed to load deal contacts:", err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const linkContact = async () => {
    if (!pickedContact) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: pickedContact.id,
          role_on_deal: roleOnDeal.trim() || null,
          notes: linkNotes.trim() || null,
        }),
      });
      if (res.status === 409) {
        alert("This contact is already linked to this deal.");
      }
      setLinkDialogOpen(false);
      setPickedContact(null);
      setRoleOnDeal("");
      setLinkNotes("");
      load();
    } catch (err) {
      console.error("Failed to link contact:", err);
    } finally {
      setLinking(false);
    }
  };

  const unlink = async (linkId: string) => {
    if (!confirm("Unlink this contact from the deal? The contact stays in your directory.")) return;
    await fetch(`/api/deals/${params.id}/contacts/${linkId}`, { method: "DELETE" });
    load();
  };

  const startEdit = (link: DealContactLink) => {
    setEditingLinkId(link.link_id);
    setEditForm({
      role_on_deal: link.role_on_deal || "",
      notes: link.link_notes || "",
    });
  };

  const saveEdit = async () => {
    if (!editingLinkId) return;
    await fetch(`/api/deals/${params.id}/contacts/${editingLinkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role_on_deal: editForm.role_on_deal.trim() || null,
        notes: editForm.notes.trim() || null,
      }),
    });
    setEditingLinkId(null);
    load();
  };

  // Group by stakeholder role for nicer display
  const grouped = links.reduce<Record<StakeholderType, DealContactLink[]>>((acc, l) => {
    const key = l.role;
    if (!acc[key]) acc[key] = [];
    acc[key].push(l);
    return acc;
  }, {} as Record<StakeholderType, DealContactLink[]>);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            People associated with this deal. Pulled from the workspace{" "}
            <Link href="/contacts" className="text-primary hover:underline">
              contact directory
            </Link>
            .
          </p>
        </div>
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Link Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Link a contact to this deal</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Contact</label>
                <ContactPicker
                  value={pickedContact?.id}
                  onChange={setPickedContact}
                  placeholder="Search or create a contact..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Role on this deal (optional)
                </label>
                <input
                  type="text"
                  value={roleOnDeal}
                  onChange={(e) => setRoleOnDeal(e.target.value)}
                  placeholder="e.g. Selling broker, buyer's attorney, lead lender"
                  className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <textarea
                  value={linkNotes}
                  onChange={(e) => setLinkNotes(e.target.value)}
                  rows={2}
                  placeholder="Anything specific about this person's role on this deal..."
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={linkContact} disabled={!pickedContact || linking}>
                  {linking && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Link
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : links.length === 0 ? (
        <div className="border border-border/60 rounded-xl bg-card p-10 text-center shadow-card">
          <User className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
          <p className="text-sm text-muted-foreground">No contacts linked to this deal yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Link the broker, seller, lender, attorneys, and others involved.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(Object.keys(STAKEHOLDER_LABELS) as StakeholderType[])
            .filter((role) => grouped[role]?.length > 0)
            .map((role) => (
              <div
                key={role}
                className="border border-border/60 rounded-xl bg-card overflow-hidden shadow-card"
              >
                <div className="px-4 py-2.5 border-b border-border/30 bg-muted/10">
                  <h3 className="font-display text-sm">{STAKEHOLDER_LABELS[role]}</h3>
                </div>
                <div className="divide-y divide-border/20">
                  {grouped[role].map((link) => (
                    <div
                      key={link.link_id}
                      className="px-4 py-3 hover:bg-muted/10 transition-colors group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full gradient-gold flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
                          {link.name
                            .split(" ")
                            .map((s) => s[0])
                            .filter(Boolean)
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{link.name}</span>
                            {link.role_on_deal && (
                              <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                {link.role_on_deal}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                            {link.company && (
                              <span className="flex items-center gap-1">
                                <Building2 className="h-3 w-3" />
                                {link.company}
                                {link.title && <span> · {link.title}</span>}
                              </span>
                            )}
                            {link.email && (
                              <a
                                href={`mailto:${link.email}`}
                                className="flex items-center gap-1 hover:text-foreground"
                              >
                                <Mail className="h-3 w-3" />
                                {link.email}
                              </a>
                            )}
                            {link.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {link.phone}
                              </span>
                            )}
                          </div>

                          {editingLinkId === link.link_id ? (
                            <div className="mt-2 space-y-2">
                              <input
                                type="text"
                                value={editForm.role_on_deal}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, role_on_deal: e.target.value })
                                }
                                placeholder="Role on this deal"
                                className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm"
                              />
                              <textarea
                                value={editForm.notes}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, notes: e.target.value })
                                }
                                rows={2}
                                placeholder="Notes"
                                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="h-7 text-xs" onClick={saveEdit}>
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => setEditingLinkId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            link.link_notes && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {link.link_notes}
                              </p>
                            )
                          )}
                        </div>

                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <Link
                            href={`/contacts?focus=${link.id}`}
                            title="Open in directory"
                            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            onClick={() => startEdit(link)}
                            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                            aria-label="Edit role"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => unlink(link.link_id)}
                            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-red-400"
                            aria-label="Unlink"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
