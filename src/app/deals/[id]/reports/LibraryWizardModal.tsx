"use client";

/**
 * LibraryWizardModal
 *
 * Generates a new artifact directly from the Reports library. Replaces
 * the old flow of sending users to /deals/[id]/investment-package to
 * author + export. The library is now the hub: pick audience, pick
 * format, click Generate, the artifact lands here.
 *
 * Server-side orchestration is two API calls:
 *   1. Ask Claude to fill in the content (sections for memo/deck/one-
 *      pager, prose for IC Package)
 *   2. Hand that content to /api/deals/[id]/artifacts which runs the
 *      kind-specific generator (htmlToPdf or pdf-lib) and persists the
 *      row
 *
 * The deeper per-section authoring surface still lives at
 * /deals/[id]/investment-package for analysts who want to hand-edit
 * before generating, but the library flow never has to go there.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dealToContext } from "@/lib/ic-package-deal-adapter";
import type { Deal } from "@/lib/types";

// ─── Format + audience config ────────────────────────────────────────────────
// Duplicated from src/app/deals/[id]/investment-package/page.tsx so the
// library modal stays self-contained. Keep these in sync when adding
// new formats or audience presets.

const ALL_SECTIONS = [
  { id: "cover", title: "Cover Page", description: "Deal name, property photo, sponsor info" },
  { id: "exec_summary", title: "Executive Summary", description: "Investment thesis, key highlights, target returns" },
  { id: "property_overview", title: "Property Overview", description: "Location, unit count, SF, year built, description" },
  { id: "location_market", title: "Location & Market Analysis", description: "Submarket, comps, rent growth, demand drivers" },
  { id: "financial_summary", title: "Financial Summary", description: "Purchase price, NOI, cap rate, debt terms, returns" },
  { id: "unit_mix", title: "Unit Mix & Revenue", description: "Unit types, in-place vs market rents, projections" },
  { id: "affordability_strategy", title: "Affordability & Incentives", description: "AMI tiers, tax exemptions, density bonuses, entitlement programs" },
  { id: "rent_comps", title: "Rent Comp Analysis", description: "Comparable properties, market positioning" },
  { id: "value_add", title: "Value-Add Strategy", description: "Renovation plan, CapEx budget, rent premium targets" },
  { id: "operating_plan", title: "Operating Plan", description: "Management, expense reduction, occupancy targets" },
  { id: "capital_structure", title: "Capital Structure", description: "Debt, equity, sources & uses, waterfall" },
  { id: "returns_analysis", title: "Returns Analysis", description: "IRR, equity multiple, CoC, DSCR, sensitivity" },
  { id: "exit_strategy", title: "Exit Strategy", description: "Hold period, exit cap rate, disposition plan" },
  { id: "development_schedule", title: "Development Schedule", description: "Phase timeline from acquisition through stabilization" },
  { id: "predev_budget", title: "Pre-Development Budget", description: "Itemized pre-dev costs by category with approval gates" },
  { id: "risk_factors", title: "Risk Factors & Mitigants", description: "Key risks and how they're addressed" },
  { id: "photos", title: "Property Photos", description: "Property images and captions" },
  { id: "appendix", title: "Appendix", description: "Documents, floor plans, additional data" },
];

const FORMAT_SECTIONS: Record<string, string[]> = {
  pitch_deck: ["cover", "exec_summary", "property_overview", "financial_summary", "unit_mix", "value_add", "capital_structure", "returns_analysis", "development_schedule", "predev_budget", "exit_strategy", "photos"],
  investment_memo: ALL_SECTIONS.map((s) => s.id),
  one_pager: ["exec_summary", "financial_summary", "photos"],
  ic_package: [],
};

const AUDIENCES = [
  { id: "lp_investor", label: "LP / Outside Investor", desc: "Formal, return-focused" },
  { id: "investment_committee", label: "Investment Committee", desc: "Analytical, assumption-driven" },
  { id: "lender", label: "Lender / Debt Partner", desc: "Coverage-focused, conservative" },
  { id: "internal_review", label: "Internal Review", desc: "Direct, flag concerns" },
];

const FORMATS = [
  { id: "pitch_deck", label: "Pitch Deck", desc: "Bullet-heavy slides", icon: "📊", featured: false },
  { id: "investment_memo", label: "Investment Memo", desc: "Long-form narrative memo", icon: "📄", featured: false },
  { id: "one_pager", label: "One-Pager / Teaser", desc: "Exec summary + key metrics", icon: "📋", featured: false },
  { id: "ic_package", label: "IC Package", desc: "Editorial committee briefing · design-system HTML → PDF", icon: "🏛️", featured: true },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  dealId: string;
  open: boolean;
  onClose: () => void;
  /** Full deal record — needed to build the IC Package DealContext and
   *  to surface the deal name in the generated artifact. */
  deal: Deal | null;
  /** Raw underwriting row; used by dealToContext for IC Package. */
  uwRow: unknown;
  /** Active massing scope from the URL (`?massing=<id>`). Passed to
   *  generate-all so the endpoint loads the correct per-massing UW row
   *  — without it, Claude sees the base-case (or an empty sibling) and
   *  calls out DATA GAPs even when the model is populated. */
  massingId?: string | null;
}

type Stage =
  | "idle"
  | "generating_content"
  | "rendering_pdf"
  | "done"
  | "error";

export default function LibraryWizardModal({
  dealId,
  open,
  onClose,
  deal,
  uwRow,
  massingId,
}: Props) {
  const router = useRouter();
  const [audience, setAudience] = useState("lp_investor");
  const [format, setFormat] = useState("ic_package");
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!open) return null;

  async function run() {
    if (!deal) {
      toast.error("Deal record missing — reload the page and try again.");
      return;
    }
    setStage("generating_content");
    setErrorMessage(null);
    try {
      if (format === "ic_package") {
        await runIcPackageFlow(deal, uwRow);
      } else {
        await runSectionFlow(deal);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setErrorMessage(msg);
      setStage("error");
      toast.error(msg);
    }
  }

  async function runIcPackageFlow(d: Deal, uw: unknown) {
    const context = dealToContext(d, uw as { data?: unknown } | null);

    // Pull Claude prose for every IC Package section. ~15s.
    const proseRes = await fetch(`/api/deals/${dealId}/ic-package-prose/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    if (!proseRes.ok) {
      throw new Error((await proseRes.text()) || "Prose generation failed");
    }
    const proseJson = (await proseRes.json()) as { prose: unknown };

    setStage("rendering_pdf");
    const artifactRes = await fetch(`/api/deals/${dealId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "ic_package",
        payload: { prose: proseJson.prose, context },
        massingId: massingId ?? null,
      }),
    });
    if (!artifactRes.ok) {
      throw new Error(await extractError(artifactRes));
    }
    const { artifact } = (await artifactRes.json()) as { artifact: { id: string } };
    finishSuccess(artifact.id);
  }

  async function runSectionFlow(d: Deal) {
    const sectionIds = FORMAT_SECTIONS[format] ?? ALL_SECTIONS.map((s) => s.id);

    // Fan out to Claude for every section in one request. Can take
    // ~60s for a full investment memo. massing_id threads through so
    // the server loads the right per-massing UW row.
    const genRes = await fetch(`/api/deals/${dealId}/investment-package/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audience,
        format,
        sections: sectionIds,
        ...(massingId ? { massing_id: massingId } : {}),
      }),
    });
    if (!genRes.ok) {
      throw new Error((await genRes.text()) || "Content generation failed");
    }
    const genJson = (await genRes.json()) as {
      data: Array<{ id: string; content: string; generated_at: string }>;
    };

    // Shape the sections payload the artifact generator expects.
    const sections = sectionIds.map((id) => {
      const spec = ALL_SECTIONS.find((s) => s.id === id);
      const gen = genJson.data.find((g) => g.id === id);
      return {
        id,
        title: spec?.title ?? id,
        description: spec?.description ?? "",
        notes: [],
        generatedContent: gen?.content ?? "",
        generated_at: gen?.generated_at,
      };
    });

    setStage("rendering_pdf");
    const artifactRes = await fetch(`/api/deals/${dealId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: format,
        payload: { sections, dealName: d.name },
        massingId: massingId ?? null,
      }),
    });
    if (!artifactRes.ok) {
      throw new Error(await extractError(artifactRes));
    }
    const { artifact } = (await artifactRes.json()) as { artifact: { id: string } };
    finishSuccess(artifact.id);
  }

  function finishSuccess(artifactId: string) {
    setStage("done");
    toast.success("Generated — opening in library");
    router.push(`/deals/${dealId}/reports/${artifactId}`);
  }

  async function extractError(res: Response): Promise<string> {
    const payload = await res.json().catch(() => ({}));
    if (payload.error === "generator_not_implemented") {
      return "This format's generator isn't installed — contact support.";
    }
    return payload.message || payload.error || `Request failed (${res.status})`;
  }

  const running = stage === "generating_content" || stage === "rendering_pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !running && onClose()}
    >
      <div
        className="bg-card rounded-xl border shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            New Package
          </div>
          <h2 className="text-lg font-semibold mt-1">
            Generate and save to library
          </h2>
          <p className="text-sm text-muted-foreground">
            Pick a format and audience. We&apos;ll draft the content with
            Claude, render the PDF, and land it here.
          </p>
          {massingId && (
            <div className="mt-2 text-[11px] font-medium text-muted-foreground">
              Scoped to active massing · {massingId.slice(0, 8)}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Format */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Format
            </div>
            {FORMATS.map((f) => {
              const selected = format === f.id;
              const baseClasses =
                "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors";
              const stateClasses = selected
                ? f.featured
                  ? "border-amber-500/70 bg-amber-500/5 ring-1 ring-amber-500/30"
                  : "border-primary bg-primary/5"
                : f.featured
                  ? "border-amber-500/40 hover:bg-amber-500/5"
                  : "hover:bg-muted/30";
              return (
                <label
                  key={f.id}
                  className={`${baseClasses} ${stateClasses}`}
                  onClick={() => !running && setFormat(f.id)}
                >
                  <input
                    type="radio"
                    name="format"
                    checked={selected}
                    onChange={() => {}}
                    disabled={running}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      <span>
                        {f.icon} {f.label}
                      </span>
                      {f.featured && (
                        <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 border border-amber-500/30">
                          New
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Audience — hidden for IC Package which has its own editorial voice */}
          {format !== "ic_package" && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Audience
              </div>
              {AUDIENCES.map((a) => {
                const selected = audience === a.id;
                return (
                  <label
                    key={a.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                    }`}
                    onClick={() => !running && setAudience(a.id)}
                  >
                    <input
                      type="radio"
                      name="audience"
                      checked={selected}
                      onChange={() => {}}
                      disabled={running}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium">{a.label}</p>
                      <p className="text-xs text-muted-foreground">{a.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Stage readout */}
          {running && (
            <div className="rounded-md border bg-muted/30 p-4 flex items-start gap-3">
              <Loader2 className="h-4 w-4 animate-spin mt-0.5 shrink-0" />
              <div className="text-sm">
                <div className="font-medium">
                  {stage === "generating_content"
                    ? "Drafting content with Claude…"
                    : "Rendering PDF…"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stage === "generating_content"
                    ? format === "investment_memo"
                      ? "Long-form memos take ~45–60 seconds."
                      : format === "ic_package"
                        ? "Editorial prose takes ~15 seconds."
                        : "This usually finishes in ~30 seconds."
                    : "Applying brand, paginating, uploading…"}
                </div>
              </div>
            </div>
          )}
          {stage === "error" && errorMessage && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button onClick={run} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4 mr-2" />
            )}
            {running ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
