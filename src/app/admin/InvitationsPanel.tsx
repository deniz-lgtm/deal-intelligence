"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Invitation {
  id: string;
  email_address: string;
  status: string;
  created_at: number;
  url?: string;
}

export default function InvitationsPanel() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/invitations");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setInvitations(json.data ?? []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function invite() {
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to invite");
      toast.success(`Invited ${email.trim()}`);
      setEmail("");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    try {
      const res = await fetch(`/api/admin/invitations?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to revoke");
      toast.success("Invitation revoked");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const pending = invitations.filter((i) => i.status === "pending");

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Invitations</h2>
        <p className="text-xs text-neutral-500">
          Send sign-in invitations via Clerk. The invitee receives an email link and can then sign in.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && invite()}
          className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={invite}
          disabled={submitting || !email.trim()}
          className="px-4 py-2 text-sm rounded bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send invite"}
        </button>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          Pending ({pending.length})
        </div>
        {loading ? (
          <div className="text-sm text-neutral-500">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="text-sm text-neutral-500">No pending invitations.</div>
        ) : (
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-lg overflow-hidden">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <div className="text-neutral-100">{inv.email_address}</div>
                  <div className="text-xs text-neutral-500">
                    Sent {new Date(inv.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => revoke(inv.id)}
                  className="text-xs text-rose-300 hover:text-rose-200"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
