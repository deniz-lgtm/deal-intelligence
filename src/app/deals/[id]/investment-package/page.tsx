"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash2, Save, Loader2, FileText, Download, Sparkles,
  ChevronDown, ChevronUp, Edit3, Eye, RefreshCw, AlertTriangle,
  CheckCircle2, Circle, ArrowRight, Target, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── Section Definitions ─────────────────────────────────────────────────────
const ALL_SECTIONS = [
  { id: "cover", title: "Cover Page", description: "Deal name, property photo, sponsor info" },
  { id: "exec_summary", title: "Executive Summary", description: "Investment thesis, key highlights, target returns" },
  { id: "property_overview", title: "Property Overview", description: "Location, unit count, SF, year built, description" },
  { id: "location_market", title: "Location & Market Analysis", description: "Submarket, comps, rent growth, demand drivers" },
  { id: "financial_summary", title: "Financial Summary", description: "Purchase price, NOI, cap rate, debt terms, returns" },
  { id: "unit_mix", title: "Unit Mix & Revenue", description: "Unit types, in-place vs market rents, projections" },
  { id: "rent_comps", title: "Rent Comp Analysis", description: "Comparable properties, market positioning" },
  { id: "value_add", title: "Value-Add Strategy", description: "Renovation plan, CapEx budget, rent premium targets" },
  { id: "operating_plan", title: "Operating Plan", description: "Management, expense reduction, occupancy targets" },
  { id: "capital_structure", title: "Capital Structure", description: "Debt, equity, sources & uses, waterfall" },
  { id: "returns_analysis", title: "Returns Analysis", description: "IRR, equity multiple, CoC, DSCR, sensitivity" },
  { id: "exit_strategy", title: "Exit Strategy", description: "Hold period, exit cap rate, disposition plan" },
  { id: "risk_factors", title: "Risk Factors & Mitigants", description: "Key risks and how they're addressed" },
  { id: "photos", title: "Property Photos", description: "Property images and captions" },
  { id: "appendix", title: "Appendix", description: "Documents, floor plans, additional data" },
];

const FORMAT_SECTIONS: Record<string, string[]> = {
  pitch_deck: ["cover", "exec_summary", "property_overview", "financial_summary", "unit_mix", "value_add", "capital_structure", "returns_analysis", "exit_strategy", "photos"],
  investment_memo: ALL_SECTIONS.map(s => s.id),
  one_pager: ["exec_summary", "financial_summary", "photos"],
};

interface NoteLine { id: string; text: string; }

interface PackageSection {
  id: string; title: string; description: string;
  notes: NoteLine[]; expanded: boolean;
  generatedContent?: string; generating?: boolean;
  editing?: boolean; generated_at?: string;
}

interface PackageMeta {
  audience: string;
  format: string;
  uw_updated_at?: string;
}

// ─── Wizard Steps ────────────────────────────────────────────────────────────
const AUDIENCES = [
  { id: "lp_investor", label: "LP / Outside Investor", desc: "Formal, return-focused, risk-mitigant framing" },
  { id: "investment_committee", label: "Investment Committee", desc: "Analytical, balanced risk/return, assumption-driven" },
  { id: "lender", label: "Lender / Debt Partner", desc: "Coverage-focused, conservative emphasis" },
  { id: "internal_review", label: "Internal Review", desc: "Direct, flag concerns, less polish" },
];

const FORMATS = [
  { id: "pitch_deck", label: "Investment Package (PowerPoint)", desc: "8-12 slides, bullet-heavy, visual", icon: "📊" },
  { id: "investment_memo", label: "Investment Memo (Word/PDF)", desc: "10-15 sections, narrative-heavy", icon: "📄" },
  { id: "one_pager", label: "One-Pager / Teaser", desc: "1-2 pages, exec summary + key metrics", icon: "📋" },
];

export default function InvestmentPackagePage({ params }: { params: { id: string } }) {
  const [sections, setSections] = useState<PackageSection[]>(
    ALL_SECTIONS.map(s => ({ ...s, notes: [], expanded: false }))
  );
  const [meta, setMeta] = useState<PackageMeta>({ audience: "lp_investor", format: "pitch_deck" });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [dealName, setDealName] = useState("Deal");
  const [uwUpdatedAt, setUwUpdatedAt] = useState<string | null>(null);

  // Deal score state
  const [dealScores, setDealScores] = useState<{ om_score: number | null; om_reasoning: string | null; uw_score: number | null; uw_score_reasoning: string | null; final_score: number | null; final_score_reasoning: string | null }>({ om_score: null, om_reasoning: null, uw_score: null, uw_score_reasoning: null, final_score: null, final_score_reasoning: null });
  const [scoringFinal, setScoringFinal] = useState(false);

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizAudience, setWizAudience] = useState("lp_investor");
  const [wizFormat, setWizFormat] = useState("pitch_deck");
  const [wizSections, setWizSections] = useState<string[]>(FORMAT_SECTIONS.pitch_deck);

  // Load saved data
  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/deals/${params.id}/investment-package`).then(r => r.json()).catch(() => null),
      fetch(`/api/underwriting?deal_id=${params.id}`).then(r => r.json()).catch(() => null),
      fetch(`/api/deals/${params.id}/deal-score`).then(r => r.json()).catch(() => null),
    ]).then(([dealJson, pkgJson, uwJson, scoresJson]) => {
      if (dealJson.data?.name) setDealName(dealJson.data.name);
      if (uwJson?.data?.updated_at) setUwUpdatedAt(uwJson.data.updated_at);
      if (scoresJson?.data) setDealScores(scoresJson.data);
      if (pkgJson?.data?.sections) {
        const saved = pkgJson.data.sections as PackageSection[];
        const merged = ALL_SECTIONS.map(ds => {
          const existing = saved.find(s => s.id === ds.id);
          return existing ? { ...ds, ...existing, expanded: false, editing: false, generating: false } : { ...ds, notes: [], expanded: false };
        });
        setSections(merged);
      }
      if (pkgJson?.data?.meta) setMeta(pkgJson.data.meta);
    });
  }, [params.id]);

  const updateSection = (sectionId: string, updates: Partial<PackageSection>) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...updates } : s));
  };

  const addNote = (sectionId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, notes: [...s.notes, { id: uuidv4(), text: "" }] } : s
    ));
  };

  const updateNote = (sectionId: string, noteId: string, text: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, notes: s.notes.map(n => n.id === noteId ? { ...n, text } : n) } : s
    ));
  };

  const deleteNote = (sectionId: string, noteId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, notes: s.notes.filter(n => n.id !== noteId) } : s
    ));
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/deals/${params.id}/investment-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: sections.map(s => ({ id: s.id, title: s.title, description: s.description, notes: s.notes, generatedContent: s.generatedContent, generated_at: s.generated_at })),
          meta,
        }),
      });
      toast.success("Package saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const generateAll = async () => {
    setShowWizard(false);
    setGeneratingAll(true);
    setMeta({ audience: wizAudience, format: wizFormat });

    // Collect existing notes
    const existingNotes: Record<string, string[]> = {};
    for (const s of sections) {
      const notes = s.notes.filter(n => n.text.trim()).map(n => n.text);
      if (notes.length > 0) existingNotes[s.id] = notes;
    }

    try {
      const res = await fetch(`/api/deals/${params.id}/investment-package/generate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: wizAudience, format: wizFormat, sections: wizSections, existingNotes }),
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json.data)) {
        setSections(prev => prev.map(s => {
          const generated = json.data.find((g: { id: string }) => g.id === s.id);
          return generated ? { ...s, generatedContent: generated.content, generated_at: generated.generated_at } : s;
        }));
        toast.success(`${json.data.length} sections generated`);
        // Auto-save
        setTimeout(save, 500);
      } else {
        toast.error(json.error || "Generation failed");
      }
    } catch { toast.error("Generation failed"); }
    finally { setGeneratingAll(false); }
  };

  const generateSection = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    updateSection(sectionId, { generating: true });
    try {
      const res = await fetch(`/api/deals/${params.id}/investment-package/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId, sectionTitle: section.title, sectionDescription: section.description,
          notes: section.notes.filter(n => n.text.trim()).map(n => n.text),
          audience: meta.audience,
        }),
      });
      const json = await res.json();
      if (res.ok) updateSection(sectionId, { generatedContent: json.data, generating: false, generated_at: new Date().toISOString() });
      else { toast.error(json.error || "Failed"); updateSection(sectionId, { generating: false }); }
    } catch { toast.error("Failed"); updateSection(sectionId, { generating: false }); }
  };

  const refineSection = async (sectionId: string, refinement: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section?.generatedContent) return;
    updateSection(sectionId, { generating: true });
    try {
      const res = await fetch(`/api/deals/${params.id}/investment-package/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionTitle: section.title, sectionDescription: section.description,
          refinementPrompt: refinement, previousContent: section.generatedContent,
          audience: meta.audience,
        }),
      });
      const json = await res.json();
      if (res.ok) updateSection(sectionId, { generatedContent: json.data, generating: false, generated_at: new Date().toISOString() });
      else { toast.error("Refinement failed"); updateSection(sectionId, { generating: false }); }
    } catch { toast.error("Refinement failed"); updateSection(sectionId, { generating: false }); }
  };

  const exportPackage = async (format: string) => {
    setExporting(true);
    try {
      const endpoint = format === "pptx"
        ? `/api/deals/${params.id}/investment-package/export`
        : `/api/deals/${params.id}/investment-package/export`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, dealName, format }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const ext = format === "docx" ? "docx" : "pptx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Investment-Package-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${ext.toUpperCase()} downloaded`);
    } catch { toast.error("Export failed"); }
    finally { setExporting(false); }
  };

  const hasContent = sections.some(s => s.generatedContent);
  const isStale = (section: PackageSection) => uwUpdatedAt && section.generated_at && new Date(uwUpdatedAt) > new Date(section.generated_at);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Investment Package</h2>
          <p className="text-sm text-muted-foreground">
            Build an investment memo section by section — add notes, AI expands them
            {meta.audience && <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded">{AUDIENCES.find(a => a.id === meta.audience)?.label || meta.audience}</span>}
            {meta.format && <span className="ml-1 text-xs bg-muted px-2 py-0.5 rounded">{FORMATS.find(f => f.id === meta.format)?.label || meta.format}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasContent && (<>
            <Button variant="outline" size="sm" onClick={() => exportPackage("pptx")} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              .pptx
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPackage("docx")} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />.docx
            </Button>
          </>)}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
          </Button>
          <Button onClick={() => { setShowWizard(true); setWizardStep(0); }} disabled={generatingAll}>
            {generatingAll ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : <><Sparkles className="h-4 w-4 mr-2" />Generate Package</>}
          </Button>
        </div>
      </div>

      {/* ─── Wizard Modal ───────────────────────────────────────────────── */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowWizard(false)}>
          <div className="bg-card rounded-xl border shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Wizard header with steps */}
            <div className="px-4 py-3 border-b">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {["Audience", "Format", "Sections"].map((label, i) => (
                  <span key={label} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight className="h-3 w-3" />}
                    <span className={wizardStep === i ? "text-primary font-semibold" : wizardStep > i ? "text-emerald-600" : ""}>{label}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Step 0: Audience */}
              {wizardStep === 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm mb-3">Who is this for?</h3>
                  {AUDIENCES.map(a => (
                    <label key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${wizAudience === a.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}>
                      <input type="radio" name="audience" checked={wizAudience === a.id} onChange={() => setWizAudience(a.id)} className="mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{a.label}</p>
                        <p className="text-xs text-muted-foreground">{a.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Step 1: Format */}
              {wizardStep === 1 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm mb-3">What format?</h3>
                  {FORMATS.map(f => (
                    <label key={f.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${wizFormat === f.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                      onClick={() => { setWizFormat(f.id); setWizSections(FORMAT_SECTIONS[f.id] || []); }}>
                      <input type="radio" name="format" checked={wizFormat === f.id} onChange={() => {}} className="mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{f.icon} {f.label}</p>
                        <p className="text-xs text-muted-foreground">{f.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Step 2: Sections */}
              {wizardStep === 2 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm">Select sections</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setWizSections(ALL_SECTIONS.map(s => s.id))} className="text-xs text-primary hover:underline">All</button>
                      <button onClick={() => setWizSections([])} className="text-xs text-muted-foreground hover:underline">Clear</button>
                    </div>
                  </div>
                  {ALL_SECTIONS.map(s => (
                    <label key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                      <input type="checkbox" checked={wizSections.includes(s.id)} onChange={() => setWizSections(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="rounded" />
                      <div className="flex-1">
                        <p className="text-sm">{s.title}</p>
                        <p className="text-[10px] text-muted-foreground">{s.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Wizard footer */}
            <div className="p-4 border-t flex justify-between">
              <Button variant="outline" size="sm" onClick={() => wizardStep === 0 ? setShowWizard(false) : setWizardStep(wizardStep - 1)}>
                {wizardStep === 0 ? "Cancel" : "Back"}
              </Button>
              {wizardStep < 2 ? (
                <Button size="sm" onClick={() => setWizardStep(wizardStep + 1)}>
                  Next <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button size="sm" onClick={generateAll} disabled={wizSections.length === 0}>
                  <Sparkles className="h-4 w-4 mr-2" />Generate ({wizSections.length})
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Deal Score Progression ─────────────────────────────────────── */}
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Deal Score Progression</h3>
          <Button
            size="sm" variant="outline"
            disabled={scoringFinal}
            onClick={async () => {
              setScoringFinal(true);
              try {
                const res = await fetch(`/api/deals/${params.id}/deal-score`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ stage: "final" }),
                });
                const json = await res.json();
                if (res.ok && json.data) {
                  setDealScores(prev => ({ ...prev, final_score: json.data.score, final_score_reasoning: json.data.reasoning }));
                  toast.success("Final deal score updated");
                } else { toast.error(json.error || "Scoring failed"); }
              } catch { toast.error("Scoring failed"); }
              finally { setScoringFinal(false); }
            }}
          >
            {scoringFinal ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Scoring...</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{dealScores.final_score ? "Re-score" : "Generate Final Score"}</>}
          </Button>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-4">
            {/* OM Analysis Score */}
            {[
              { label: "OM Analysis", score: dealScores.om_score, reasoning: dealScores.om_reasoning, empty: "Run OM Analysis" },
              { label: "Post-Underwriting", score: dealScores.uw_score, reasoning: dealScores.uw_score_reasoning, empty: "Score in Underwriting" },
              { label: "Final Score", score: dealScores.final_score, reasoning: dealScores.final_score_reasoning, empty: "Generate final score" },
            ].map(({ label, score, reasoning, empty }) => (
              <div key={label} className={`rounded-lg border p-4 ${score ? score >= 8 ? "bg-emerald-500/10 border-emerald-500/30" : score >= 6 ? "bg-amber-500/10 border-amber-500/30" : score >= 4 ? "bg-orange-500/10 border-orange-500/30" : "bg-rose-500/10 border-rose-500/30" : "bg-muted/20 border-border"}`}>
                <p className="text-xs font-medium text-foreground/80 mb-1">{label}</p>
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-bold tabular-nums ${score ? score >= 8 ? "text-emerald-400" : score >= 6 ? "text-amber-400" : score >= 4 ? "text-orange-400" : "text-rose-400" : "text-muted-foreground/40"}`}>
                    {score ?? "—"}
                  </span>
                  {score && <span className="text-sm text-muted-foreground">/10</span>}
                </div>
                {reasoning && <p className="text-xs text-foreground/70 mt-2 leading-relaxed line-clamp-3">{reasoning}</p>}
                {!score && <p className="text-xs text-muted-foreground mt-1">{empty}</p>}
              </div>
            ))}
          </div>
          {/* Score trend */}
          {(dealScores.om_score || dealScores.uw_score || dealScores.final_score) && (
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Trend:</span>
              {[dealScores.om_score, dealScores.uw_score, dealScores.final_score].filter(Boolean).map((s, i, arr) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className={s! > arr[i-1]! ? "text-emerald-500" : s! < arr[i-1]! ? "text-rose-500" : "text-muted-foreground"}>
                      {s! > arr[i-1]! ? <TrendingUp className="h-3 w-3" /> : "→"}
                    </span>
                  )}
                  <span className="font-semibold">{s}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Sections ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {sections.map((section, idx) => (
          <div key={section.id} className="border rounded-xl bg-card overflow-hidden">
            {/* Section header */}
            <button
              onClick={() => updateSection(section.id, { expanded: !section.expanded })}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground/60 font-mono w-6">{idx + 1}</span>
                <div className="text-left">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    {section.title}
                    {isStale(section) && (
                      <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> stale
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {section.notes.filter(n => n.text.trim()).length > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{section.notes.filter(n => n.text.trim()).length} notes</span>
                )}
                {section.generatedContent && (
                  <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> generated
                  </span>
                )}
                {section.generating && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {section.expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Section body */}
            {section.expanded && (
              <div className="border-t">
                {/* Notes input */}
                <div className="p-4 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium mb-2">Your notes — key points for this section</p>
                  {section.notes.map(note => (
                    <div key={note.id} className="flex items-center gap-2 group">
                      <span className="text-muted-foreground/40">•</span>
                      <input type="text" value={note.text}
                        onChange={e => updateNote(section.id, note.id, e.target.value)}
                        className="flex-1 text-sm bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none py-1 transition-colors"
                        placeholder="Add a point..."
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNote(section.id); } }}
                      />
                      <button onClick={() => deleteNote(section.id, note.id)} className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addNote(section.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Note
                    </Button>
                    {section.notes.some(n => n.text.trim()) && !section.generatedContent && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => generateSection(section.id)} disabled={section.generating}>
                        {section.generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                        Generate
                      </Button>
                    )}
                  </div>
                </div>

                {/* Generated content */}
                {section.generatedContent && (
                  <div className="border-t">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between px-4 py-2 bg-muted/20 border-b">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => updateSection(section.id, { editing: !section.editing })}>
                          {section.editing ? <><Eye className="h-3 w-3 mr-1" />Preview</> : <><Edit3 className="h-3 w-3 mr-1" />Edit</>}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => generateSection(section.id)} disabled={section.generating}>
                          <RefreshCw className="h-3 w-3 mr-1" />Regenerate
                        </Button>
                      </div>
                      {section.generated_at && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(section.generated_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {/* Content area */}
                    {section.editing ? (
                      <textarea
                        value={section.generatedContent}
                        onChange={e => updateSection(section.id, { generatedContent: e.target.value })}
                        className="w-full p-4 text-sm font-mono bg-background min-h-[200px] outline-none resize-y"
                      />
                    ) : (
                      <div className="p-4">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.generatedContent}</ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {/* Refine input */}
                    <div className="px-4 py-2 border-t bg-muted/10">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Refine: 'make more concise', 'add lease details'..."
                          className="flex-1 text-xs bg-transparent outline-none py-1"
                          onKeyDown={e => {
                            if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                              refineSection(section.id, (e.target as HTMLInputElement).value.trim());
                              (e.target as HTMLInputElement).value = "";
                            }
                          }}
                        />
                        {section.generating && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
