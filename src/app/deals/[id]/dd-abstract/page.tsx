"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, FileText, RefreshCw, AlertCircle, Download, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ALL_SECTIONS = [
  { id: "executive_summary", label: "Executive Summary", default: true },
  { id: "property_overview", label: "Property Overview", default: true },
  { id: "underwriting_summary", label: "Underwriting Summary", default: true },
  { id: "revenue_expense", label: "Revenue & Expense Analysis", default: true },
  { id: "document_review", label: "Document Review Status", default: true },
  { id: "key_findings", label: "Key Findings", default: true },
  { id: "red_flags", label: "Red Flags & Issues", default: true },
  { id: "outstanding_items", label: "Outstanding Items", default: true },
  { id: "recommendation", label: "Recommendation", default: true },
];

export default function DDAbstractPage({ params }: { params: { id: string } }) {
  const [abstract, setAbstract] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealName, setDealName] = useState("Deal");
  const [showPicker, setShowPicker] = useState(false);
  const [selectedSections, setSelectedSections] = useState<string[]>(
    ALL_SECTIONS.filter(s => s.default).map(s => s.id)
  );
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  // Load existing saved abstract on mount
  useEffect(() => {
    fetch(`/api/deals/${params.id}`)
      .then(r => r.json())
      .then(j => { if (j.data?.name) setDealName(j.data.name); })
      .catch(() => {});

    // Check if there's an existing DD abstract document
    fetch(`/api/deals/${params.id}/documents`)
      .then(r => r.json())
      .then(j => {
        const docs = j.data || j;
        if (Array.isArray(docs)) {
          const existing = docs.find((d: { category: string; name: string }) =>
            d.category === "dd_abstract" || d.name?.includes("DD Abstract")
          );
          if (existing) {
            setSavedDocId(existing.id);
            // Load the saved content
            if (existing.content_text) {
              setAbstract(existing.content_text);
              setLastGenerated(existing.uploaded_at || null);
            }
          }
        }
      })
      .catch(() => {});
  }, [params.id]);

  const toggleSection = (id: string) => {
    setSelectedSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const generate = async () => {
    setShowPicker(false);
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${params.id}/dd-abstract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: selectedSections }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to generate abstract");
        toast.error(json.error || "Failed to generate abstract");
        return;
      }

      setAbstract(json.data);
      setLastGenerated(new Date().toISOString());
      toast.success("DD Abstract generated");

      // Save/update as document
      saveAsDocument(json.data);

      // Save key findings to deal memory
      if (json.data) {
        saveToMemory(json.data);
      }
    } catch {
      setError("Network error");
      toast.error("Network error");
    } finally {
      setGenerating(false);
    }
  };

  const saveAsDocument = useCallback(async (markdown: string) => {
    try {
      if (savedDocId) {
        // Update existing document
        await fetch(`/api/documents/${savedDocId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content_text: markdown, ai_summary: "AI-generated DD Abstract — updated " + new Date().toLocaleDateString() }),
        });
      } else {
        // Create new document entry
        const res = await fetch(`/api/deals/${params.id}/dd-abstract/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown, dealName }),
        });
        const json = await res.json();
        if (json.id) setSavedDocId(json.id);
      }
    } catch {
      // Silent fail — saving is best-effort
    }
  }, [savedDocId, params.id, dealName]);

  const saveToMemory = async (markdown: string) => {
    try {
      // Extract a brief summary to save to deal memory
      const lines = markdown.split("\n").filter(l => l.trim());
      const execSummary = lines.find(l => l.startsWith("##") && l.toLowerCase().includes("executive"));
      const execIdx = execSummary ? lines.indexOf(execSummary) : -1;
      if (execIdx >= 0) {
        const summaryLines = [];
        for (let i = execIdx + 1; i < lines.length && i < execIdx + 5; i++) {
          if (lines[i].startsWith("##")) break;
          if (lines[i].trim()) summaryLines.push(lines[i].trim());
        }
        if (summaryLines.length > 0) {
          await fetch(`/api/deals/${params.id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `[DD Abstract ${new Date().toLocaleDateString()}] ${summaryLines.join(" ")}`,
              category: "context",
              source: "dd_abstract",
            }),
          });
        }
      }
    } catch {
      // Silent fail
    }
  };

  const exportWord = async () => {
    if (!abstract) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/deals/${params.id}/dd-abstract/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: abstract, dealName }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `DD-Abstract-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Word document downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">DD Abstract</h2>
          <p className="text-sm text-muted-foreground">
            AI-generated due diligence memo — pulls from underwriting, documents, checklist, and deal notes
            {lastGenerated && <span className="ml-2 text-xs">· Last updated {new Date(lastGenerated).toLocaleDateString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {abstract && (
            <Button variant="outline" size="sm" onClick={exportWord} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export to Word
            </Button>
          )}
          <Button onClick={() => setShowPicker(true)} disabled={generating} size="sm">
            {generating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
            ) : abstract ? (
              <><RefreshCw className="h-4 w-4 mr-2" />Update Abstract</>
            ) : (
              <><FileText className="h-4 w-4 mr-2" />Generate Abstract</>
            )}
          </Button>
        </div>
      </div>

      {/* Section Picker Modal */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPicker(false)}>
          <div className="bg-card rounded-xl border shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Select Sections
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Choose which sections to include in the abstract</p>
            </div>
            <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {ALL_SECTIONS.map(s => (
                <label key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(s.id)}
                    onChange={() => toggleSection(s.id)}
                    className="rounded"
                  />
                  <span className="text-sm">{s.label}</span>
                </label>
              ))}
            </div>
            <div className="p-4 border-t flex items-center justify-between">
              <div className="flex gap-2">
                <button onClick={() => setSelectedSections(ALL_SECTIONS.map(s => s.id))} className="text-xs text-primary hover:underline">Select All</button>
                <button onClick={() => setSelectedSections([])} className="text-xs text-muted-foreground hover:underline">Clear</button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowPicker(false)}>Cancel</Button>
                <Button size="sm" onClick={generate} disabled={selectedSections.length === 0}>
                  Generate ({selectedSections.length})
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm p-4 border border-destructive/20 rounded-xl bg-destructive/5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!abstract && !generating && !error && (
        <div className="text-center py-16 border-2 border-dashed rounded-xl">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium mb-1">No abstract yet</p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Pulls from your underwriting model, uploaded documents, and checklist. Run the underwriting model first for the richest output.
          </p>
          <Button onClick={() => setShowPicker(true)}>
            <FileText className="h-4 w-4 mr-2" />
            Generate Abstract
          </Button>
        </div>
      )}

      {generating && !abstract && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Analyzing underwriting, documents, and checklist…</p>
          </div>
        </div>
      )}

      {abstract && (
        <div className="border rounded-xl bg-card">
          <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/30 rounded-t-xl">
            <span className="text-xs text-muted-foreground font-medium">DD Abstract — {dealName}</span>
            <div className="flex items-center gap-2">
              {savedDocId && <span className="text-[10px] text-emerald-600">Saved to documents</span>}
              <Button variant="ghost" size="sm" onClick={exportWord} disabled={exporting} className="h-7 text-xs">
                {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                .docx
              </Button>
            </div>
          </div>
          <div className="p-6">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{abstract}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
