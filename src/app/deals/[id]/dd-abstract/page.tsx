"use client";

import { useState } from "react";
import { Loader2, FileText, RefreshCw, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function DDAbstractPage({ params }: { params: { id: string } }) {
  const [abstract, setAbstract] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealName, setDealName] = useState("Deal");

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Also fetch deal name for the export filename
      const [abstractRes, dealRes] = await Promise.all([
        fetch(`/api/deals/${params.id}/dd-abstract`, { method: "POST" }),
        fetch(`/api/deals/${params.id}`),
      ]);
      const json = await abstractRes.json();
      if (abstractRes.ok) {
        setAbstract(json.data);
        toast.success("DD Abstract generated");
      } else {
        setError(json.error || "Failed to generate abstract");
        toast.error(json.error || "Failed to generate abstract");
      }
      if (dealRes.ok) {
        const dealJson = await dealRes.json();
        if (dealJson.data?.name) setDealName(dealJson.data.name);
      }
    } catch {
      setError("Network error");
      toast.error("Network error");
    } finally {
      setGenerating(false);
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

      // Download the blob
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
            AI-generated due diligence memo — pulls from underwriting model, documents, and checklist
          </p>
        </div>
        <div className="flex items-center gap-2">
          {abstract && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportWord}
              disabled={exporting}
            >
              {exporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export to Word
                </>
              )}
            </Button>
          )}
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : abstract ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate Abstract
              </>
            )}
          </Button>
        </div>
      </div>

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
            Pulls from your underwriting model, uploaded documents, and checklist. Run the underwriting
            model first for the richest output.
          </p>
          <Button onClick={generate}>
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
          {/* Toolbar */}
          <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/30 rounded-t-xl">
            <span className="text-xs text-muted-foreground font-medium">DD Abstract — {dealName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={exportWord}
              disabled={exporting}
              className="h-7 text-xs"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              .docx
            </Button>
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
