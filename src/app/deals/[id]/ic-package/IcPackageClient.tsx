"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import IcPackageRenderer from "./components/IcPackageRenderer";
import ProseEditorPanel from "./components/ProseEditorPanel";
import { DEMO_DEAL_CONTEXT, DEMO_PROSE } from "./demo-fixture";
import { buildIcPackage } from "@/lib/ic-package-mapper";
import type { DealContext, ProseSections } from "./types";

type SectionKey =
  | "exec"
  | "marketThesis"
  | "thesisCards"
  | "businessPlan"
  | "risks"
  | "callouts"
  | "ask"
  | "scenarios";

interface Props {
  dealId: string;
  /** Deal context derived server-side from the deal record. Null means we
   *  don't have enough data to render a real package yet — fall back to
   *  the demo fixture so the design system is still viewable. */
  dealContext: DealContext | null;
  /** Prose previously saved for this deal, if any. */
  savedProse: ProseSections | null;
  /** Version number of the saved prose (for display only). */
  savedVersion: number | null;
}

/**
 * The interactive IC Package view. Owns the prose state — starts from
 * either saved prose, demo prose (for empty deals), or newly-generated
 * prose — and lets the user edit, regenerate, save, or print.
 */
export default function IcPackageClient({
  dealId,
  dealContext,
  savedProse,
  savedVersion,
}: Props) {
  const inDemoMode = dealContext === null;
  const [prose, setProse] = useState<ProseSections>(
    savedProse ?? DEMO_PROSE
  );
  const [generating, setGenerating] = useState(false);
  const [regenSection, setRegenSection] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState<number | null>(savedVersion);

  const effectiveContext = dealContext ?? DEMO_DEAL_CONTEXT;

  const pkg = useMemo(
    () => buildIcPackage(effectiveContext, prose),
    [effectiveContext, prose]
  );

  function updateProse(next: ProseSections) {
    setProse(next);
    setDirty(true);
  }

  async function generateAll() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-package/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: effectiveContext }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Generation failed");
      }
      const data = (await res.json()) as { prose: ProseSections };
      setProse(data.prose);
      setDirty(true);
      toast.success("Prose regenerated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function regenerate(section: SectionKey) {
    setRegenSection(section);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-package/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: effectiveContext, section }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Regeneration failed");
      }
      const data = (await res.json()) as { prose: Partial<ProseSections> };
      setProse((prev) => ({ ...prev, ...data.prose }));
      setDirty(true);
      toast.success(`${section} redrafted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setRegenSection(null);
    }
  }

  async function save() {
    if (inDemoMode) {
      toast.error("Demo mode — deal not found. Load a real deal to save.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-package`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prose, context: effectiveContext }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Save failed");
      }
      const data = (await res.json()) as { version: number };
      setVersion(data.version);
      setDirty(false);
      toast.success(`Saved v${data.version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function printPackage() {
    window.print();
  }

  const versionBadge = inDemoMode
    ? "DEMO MODE · Crestmont"
    : version != null
    ? `v${version}${dirty ? " · unsaved" : ""}`
    : dirty
    ? "draft · unsaved"
    : "draft";

  return (
    <>
      <div className="ic-editor-toolbar">
        <div>
          IC PACKAGE · {pkg.masthead.dealCode}
          <span style={{ marginLeft: 12, color: dirty ? "var(--ic-accent)" : "var(--ic-muted)" }}>
            {versionBadge}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setEditMode(!editMode)}
            className={editMode ? "ic-primary" : undefined}
          >
            {editMode ? "Exit Edit" : "Edit"}
          </button>
          <button onClick={generateAll} disabled={generating}>
            {generating ? "Generating…" : "Regenerate All"}
          </button>
          <button onClick={save} disabled={saving || inDemoMode || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={printPackage} className="ic-primary">
            Export PDF
          </button>
        </div>
      </div>

      {editMode ? (
        <div className="ic-editor-split">
          <div className="ic-editor-split-left">
            <ProseEditorPanel
              prose={prose}
              onChange={updateProse}
              onRegenerate={regenerate}
              regeneratingSection={regenSection}
            />
          </div>
          <div className="ic-editor-split-right">
            <IcPackageRenderer pkg={pkg} />
          </div>
        </div>
      ) : (
        <IcPackageRenderer pkg={pkg} />
      )}
    </>
  );
}
