"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash2, Save, Loader2, FileText, Download, Sparkles,
  ChevronDown, ChevronUp, GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DEFAULT_SECTIONS = [
  { id: "cover", title: "Cover Page", description: "Deal name, property photo, sponsor info" },
  { id: "exec_summary", title: "Executive Summary", description: "Investment thesis, key highlights, target returns" },
  { id: "property_overview", title: "Property Overview", description: "Location, unit count, SF, year built, property description" },
  { id: "market_analysis", title: "Market Analysis", description: "Submarket, comps, rent growth, demand drivers" },
  { id: "financial_summary", title: "Financial Summary", description: "Purchase price, NOI, cap rate, debt terms, returns" },
  { id: "unit_mix", title: "Unit Mix & Revenue", description: "Unit types, in-place vs market rents, revenue projections" },
  { id: "value_add", title: "Value-Add Strategy", description: "Renovation plan, CapEx budget, rent premium targets" },
  { id: "operating_plan", title: "Operating Plan", description: "Management, expense reduction, occupancy targets" },
  { id: "capital_structure", title: "Capital Structure", description: "Debt, equity, sources & uses, waterfall" },
  { id: "exit_strategy", title: "Exit Strategy", description: "Hold period, exit cap rate, exit value, disposition plan" },
  { id: "risk_factors", title: "Risk Factors & Mitigants", description: "Key risks and how they're addressed" },
  { id: "appendix", title: "Appendix", description: "Photos, floor plans, comps, additional data" },
];

interface NoteLine {
  id: string;
  text: string;
}

interface PackageSection {
  id: string;
  title: string;
  description: string;
  notes: NoteLine[];
  expanded: boolean;
  generatedContent?: string;
  generating?: boolean;
}

interface PackageData {
  sections: PackageSection[];
}

export default function InvestmentPackagePage({ params }: { params: { id: string } }) {
  const [sections, setSections] = useState<PackageSection[]>(
    DEFAULT_SECTIONS.map(s => ({ ...s, notes: [], expanded: false }))
  );
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [dealName, setDealName] = useState("Deal");
  const [loaded, setLoaded] = useState(false);

  // Load saved package data on mount
  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then(r => r.json()),
      fetch(`/api/deals/${params.id}/investment-package`).then(r => r.json()).catch(() => null),
    ]).then(([dealJson, pkgJson]) => {
      if (dealJson.data?.name) setDealName(dealJson.data.name);
      if (pkgJson?.data?.sections) {
        // Merge saved sections with defaults (in case new sections were added)
        const saved = pkgJson.data.sections as PackageSection[];
        const merged = DEFAULT_SECTIONS.map(ds => {
          const existing = saved.find(s => s.id === ds.id);
          return existing ? { ...ds, ...existing, expanded: false } : { ...ds, notes: [], expanded: false };
        });
        setSections(merged);
      }
      setLoaded(true);
    });
  }, [params.id]);

  const updateSection = (sectionId: string, updates: Partial<PackageSection>) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ...updates } : s));
  };

  const addNote = (sectionId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId
        ? { ...s, notes: [...s.notes, { id: uuidv4(), text: "" }] }
        : s
    ));
  };

  const updateNote = (sectionId: string, noteId: string, text: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId
        ? { ...s, notes: s.notes.map(n => n.id === noteId ? { ...n, text } : n) }
        : s
    ));
  };

  const deleteNote = (sectionId: string, noteId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId
        ? { ...s, notes: s.notes.filter(n => n.id !== noteId) }
        : s
    ));
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/deals/${params.id}/investment-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sections.map(s => ({ id: s.id, title: s.title, description: s.description, notes: s.notes, generatedContent: s.generatedContent })) }),
      });
      toast.success("Package saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const generateSection = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || section.notes.filter(n => n.text.trim()).length === 0) {
      toast.error("Add some notes first");
      return;
    }
    updateSection(sectionId, { generating: true });
    try {
      const res = await fetch(`/api/deals/${params.id}/investment-package/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          sectionTitle: section.title,
          sectionDescription: section.description,
          notes: section.notes.filter(n => n.text.trim()).map(n => n.text),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        updateSection(sectionId, { generatedContent: json.data, generating: false });
        toast.success(`${section.title} generated`);
      } else {
        toast.error(json.error || "Generation failed");
        updateSection(sectionId, { generating: false });
      }
    } catch {
      toast.error("Generation failed");
      updateSection(sectionId, { generating: false });
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    const sectionsWithNotes = sections.filter(s => s.notes.some(n => n.text.trim()));
    for (const section of sectionsWithNotes) {
      await generateSection(section.id);
    }
    setGeneratingAll(false);
    save();
    toast.success("All sections generated");
  };

  const exportPowerPoint = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/investment-package/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, dealName }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Investment-Package-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("PowerPoint downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const hasContent = sections.some(s => s.generatedContent);
  const hasNotes = sections.some(s => s.notes.some(n => n.text.trim()));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Investment Package</h2>
          <p className="text-sm text-muted-foreground">
            Build an investment memo section by section — add your notes, AI expands them into presentation-ready content
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasContent && (
            <Button variant="outline" size="sm" onClick={exportPowerPoint} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export PowerPoint
            </Button>
          )}
          {hasNotes && (
            <Button variant="outline" size="sm" onClick={generateAll} disabled={generatingAll}>
              {generatingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generate All
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

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
                  <h3 className="font-semibold text-sm">{section.title}</h3>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {section.notes.length > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {section.notes.filter(n => n.text.trim()).length} notes
                  </span>
                )}
                {section.generatedContent && (
                  <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">generated</span>
                )}
                {section.expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Section body */}
            {section.expanded && (
              <div className="border-t">
                {/* Notes */}
                <div className="p-4 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium mb-2">Your Notes — add key points, the AI will expand these</p>
                  {section.notes.map(note => (
                    <div key={note.id} className="flex items-center gap-2 group">
                      <span className="text-muted-foreground/40">•</span>
                      <input
                        type="text"
                        value={note.text}
                        onChange={e => updateNote(section.id, note.id, e.target.value)}
                        className="flex-1 text-sm bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none py-1 transition-colors"
                        placeholder="Add a point..."
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addNote(section.id);
                          }
                        }}
                      />
                      <button
                        onClick={() => deleteNote(section.id, note.id)}
                        className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addNote(section.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Note
                    </Button>
                    {section.notes.some(n => n.text.trim()) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => generateSection(section.id)}
                        disabled={section.generating}
                      >
                        {section.generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                        Generate
                      </Button>
                    )}
                  </div>
                </div>

                {/* Generated content preview */}
                {section.generatedContent && (
                  <div className="border-t bg-muted/20 p-4">
                    <p className="text-[10px] text-muted-foreground uppercase font-medium mb-2">Generated Content</p>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.generatedContent}</ReactMarkdown>
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
