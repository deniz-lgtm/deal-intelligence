"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Allowlist {
  domains: string[];
  emails: string[];
  env_domains_set?: boolean;
}

export default function SignupAllowlistPanel() {
  const [list, setList] = useState<Allowlist>({ domains: [], emails: [] });
  const [loading, setLoading] = useState(true);
  const [domainsText, setDomainsText] = useState("");
  const [emailsText, setEmailsText] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/signup-allowlist");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setList(json.data);
      setDomainsText((json.data.domains ?? []).join("\n"));
      setEmailsText((json.data.emails ?? []).join("\n"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/signup-allowlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: domainsText.split(/\s|,/).map((s) => s.trim()).filter(Boolean),
          emails: emailsText.split(/\s|,/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setList(json.data);
      toast.success("Allowlist updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const restricted = list.domains.length > 0 || list.emails.length > 0;

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Signup Allowlist</h2>
        <p className="text-xs text-neutral-500">
          Restrict who can create an account. New users whose email isn&apos;t on this list are
          auto-disabled on first login. Leave both lists empty to allow anyone to sign up.
        </p>
        {list.env_domains_set && (
          <p className="text-xs text-amber-300/80 mt-1">
            Note: <code>ALLOWED_EMAIL_DOMAINS</code> env var is also set and unioned with this list.
          </p>
        )}
        <p className={`text-xs mt-1 ${restricted ? "text-emerald-300" : "text-rose-300"}`}>
          {restricted ? "✓ Signup is restricted" : "⚠ Signup is open to anyone"}
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-neutral-500 mb-1 block">
              Allowed Email Domains
            </label>
            <textarea
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              placeholder="acme.com&#10;djaco.dev"
              rows={6}
              className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 text-sm font-mono"
            />
            <p className="text-xs text-neutral-500 mt-1">One per line. Anyone @ these domains can sign up.</p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-neutral-500 mb-1 block">
              Allowed Individual Emails
            </label>
            <textarea
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder="alice@example.com&#10;bob@partner.io"
              rows={6}
              className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 text-sm font-mono"
            />
            <p className="text-xs text-neutral-500 mt-1">One per line. Use this for one-off invites.</p>
          </div>
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="text-sm px-4 py-2 rounded bg-indigo-500 hover:bg-indigo-400 text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save allowlist"}
      </button>
    </section>
  );
}
