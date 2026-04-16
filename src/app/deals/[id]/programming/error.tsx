"use client";

// Next.js App Router automatically wraps the sibling page.tsx with
// whatever this file exports as a React ErrorBoundary-style component.
// We render the error message + stack trace on-screen so an iPhone
// user can screenshot the actual crash instead of staring at the
// generic "Application error" overlay Next.js shows by default.
// Route-scoped to /deals/[id]/programming — other pages are
// unaffected.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";

export default function ProgrammingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[programming-page] client-side crash", error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 space-y-4">
      <div className="flex items-center gap-2 text-red-400">
        <AlertTriangle className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Programming page crashed</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Client-side exception. Share a screenshot of this page so the crash can
        be pinpointed and fixed.
      </p>
      <div className="border border-red-500/40 bg-red-500/5 rounded-lg p-4 space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-red-300/70 mb-1">
            Message
          </div>
          <div className="font-mono text-xs text-red-200 break-words whitespace-pre-wrap">
            {error.message || "(no message)"}
          </div>
        </div>
        {error.digest && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-red-300/70 mb-1">
              Digest
            </div>
            <div className="font-mono text-xs text-red-200 break-words">
              {error.digest}
            </div>
          </div>
        )}
        {error.stack && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-red-300/70 mb-1">
              Stack (first 20 lines)
            </div>
            <pre className="font-mono text-[10px] text-red-200/90 whitespace-pre-wrap break-words leading-snug max-h-96 overflow-y-auto">
              {error.stack.split("\n").slice(0, 20).join("\n")}
            </pre>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset} variant="outline" size="sm">
          <RefreshCcw className="h-3.5 w-3.5 mr-2" />
          Try again
        </Button>
      </div>
    </div>
  );
}
