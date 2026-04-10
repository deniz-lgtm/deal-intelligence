"use client";

import { useState } from "react";
import { Loader2, Sparkles, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SiteWalk } from "@/lib/types";

interface Props {
  dealId: string;
  walk: SiteWalk;
  onReportGenerated: (report: string) => void;
}

export default function SiteWalkReport({ dealId, walk, onReportGenerated }: Props) {
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/site-walks/${walk.id}/report`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to generate report");
        return;
      }
      const json = await res.json();
      toast.success("Report generated");
      onReportGenerated(json.data.report);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          AI-generated comprehensive site walk report based on recordings, photos, and deficiencies.
        </p>
        <Button size="sm" onClick={generate} disabled={generating}>
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {walk.ai_report ? "Regenerate" : "Generate"}
        </Button>
      </div>

      {walk.ai_report ? (
        <div className="rounded-lg border border-border/60 bg-card/40 p-4 prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-table:text-xs">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{walk.ai_report}</ReactMarkdown>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
          <FileText className="h-6 w-6 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">
            Click &ldquo;Generate&rdquo; to create an AI report from this walk&apos;s data.
          </p>
        </div>
      )}
    </div>
  );
}
