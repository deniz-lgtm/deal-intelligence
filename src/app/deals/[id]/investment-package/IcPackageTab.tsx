"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import GenerateToLibraryButton from "@/components/GenerateToLibraryButton";
import IcPackageRenderer from "@/components/ic-package/components/IcPackageRenderer";
import ProseEditorPanel from "@/components/ic-package/components/ProseEditorPanel";
import {
  DEMO_DEAL_CONTEXT,
  DEMO_PROSE,
} from "@/components/ic-package/demo-fixture";
import { buildIcPackage } from "@/lib/ic-package-mapper";
import type {
  DealContext,
  ProseSections,
} from "@/components/ic-package/types";
import "@/components/ic-package/styles/ic-tokens.css";

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
  dealContext: DealContext | null;
}

/**
 * IC Package authoring surface rendered inside the Investment Package
 * wizard when the user picks the "IC Package" format. Mirrors what the
 * now-deleted standalone /ic-package route used to provide, but plugs
 * into the unified Generate → Library flow instead of its own Export
 * endpoints.
 */
export default function IcPackageTab({ dealId, dealContext }: Props) {
  const inDemoMode = dealContext === null;
  const effectiveContext = dealContext ?? DEMO_DEAL_CONTEXT;

  const [prose, setProse] = useState<ProseSections>(DEMO_PROSE);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenSection, setRegenSection] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    if (inDemoMode) {
      setLoaded(true);
      return;
    }
    // Hydrate from whatever prose was last saved for this deal so users
    // pick up where they left off.
    fetch(`/api/deals/${dealId}/ic-package-prose`)
      .then((r) => r.json())
      .then((data) => {
        if (data.prose) setProse(data.prose as ProseSections);
        if (data.version) setVersion(data.version);
      })
      .catch(() => {
        // Keep demo prose as a starting point — better than an empty page.
      })
      .finally(() => setLoaded(true));
  }, [dealId, inDemoMode]);

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
      const res = await fetch(`/api/deals/${dealId}/ic-package-prose/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: effectiveContext }),
      });
      if (!res.ok) throw new Error(await res.text());
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
      const res = await fetch(
        `/api/deals/${dealId}/ic-package-prose/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: effectiveContext, section }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
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

  async function saveDraft() {
    if (inDemoMode) {
      toast.error("Demo mode — load a real deal to save drafts.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/ic-package-prose`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prose, context: effectiveContext }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { version: number };
      setVersion(data.version);
      setDirty(false);
      toast.success(`Draft saved · v${data.version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {inDemoMode ? (
            <>Demo mode · Crestmont reference</>
          ) : (
            <>
              Draft {version != null ? `v${version}` : ""}
              {dirty ? " · unsaved" : ""}
            </>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode(!editMode)}
          >
            {editMode ? "Exit Edit" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={generateAll}
            disabled={generating}
          >
            {generating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Regenerate All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={saveDraft}
            disabled={saving || inDemoMode || !dirty}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Draft
          </Button>
          <GenerateToLibraryButton
            dealId={dealId}
            kind="ic_package"
            getPayload={() => ({
              prose,
              context: effectiveContext,
            })}
            size="sm"
            label="Generate → Library"
          />
        </div>
      </div>

      {!loaded ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : editMode ? (
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
    </div>
  );
}
