"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, ClipboardPaste, Image as ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Reusable image upload zone with three input paths:
//   1. Click to pick files (multi-select)
//   2. Drag and drop files
//   3. Paste from clipboard — works whether the user clicks the zone first
//      OR pastes anywhere on the page (controlled by `globalPaste`)
//
// Handles a Promise<void> from the parent so it can show a spinner while the
// upload is in flight.

interface Props {
  onFiles: (files: File[]) => Promise<void> | void;
  // When true, listens for paste events on the entire window (default true).
  // Set false on pages that already have a different paste-target.
  globalPaste?: boolean;
  // When true, the drop zone fills available height (use inside detail panes).
  fill?: boolean;
  // Extra Tailwind classes for the outer drop zone.
  className?: string;
  // Compact label for a smaller chip-style version (e.g. on edit page next
  // to existing thumbnails).
  compact?: boolean;
  // Caption / hint shown inside the drop zone. Falls back to a sensible default.
  hint?: string;
}

export default function ImagePasteDrop({
  onFiles,
  globalPaste = true,
  fill = false,
  className,
  compact = false,
  hint,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteFlash, setPasteFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = async (filesIn: File[]) => {
    if (filesIn.length === 0) return;
    setBusy(true);
    try {
      await onFiles(filesIn);
    } finally {
      setBusy(false);
    }
  };

  // Window-level paste handler. ClipboardEvent.clipboardData.items contains
  // every clipboard slot — typed image entries include things like
  // "image/png" from screenshot tools. We pull every image item out and pass
  // them up as Files. Skip when typing in inputs/textareas so paste-text
  // operations aren't intercepted.
  useEffect(() => {
    if (!globalPaste) return;
    const handler = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target.isContentEditable) {
          // Allow paste only if the clipboard has ONLY images (then we
          // intercept it because text fields don't care about images anyway).
          const items = e.clipboardData?.items;
          if (!items) return;
          const hasNonImage = Array.from(items).some((it) => !it.type.startsWith("image/"));
          if (hasNonImage) return;
        }
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      setPasteFlash(true);
      setTimeout(() => setPasteFlash(false), 600);
      void handle(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
    // onFiles is stable enough to skip; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalPaste]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (files.length > 0) void handle(files);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) void handle(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "relative cursor-pointer rounded-xl border-2 border-dashed transition-colors",
        compact ? "px-3 py-2" : "p-6",
        fill && "h-full",
        dragOver
          ? "border-primary/70 bg-primary/10"
          : pasteFlash
            ? "border-emerald-500/70 bg-emerald-500/10"
            : "border-border/40 bg-card/30 hover:border-primary/40 hover:bg-muted/20",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        onChange={onPick}
      />
      {busy ? (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Uploading…
        </div>
      ) : compact ? (
        <div className="flex items-center justify-center gap-2 text-2xs text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5" />
          <span>{hint || "Click, drop, or paste images"}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Upload className="h-5 w-5" />
            <span className="text-2xs">|</span>
            <ClipboardPaste className="h-5 w-5" />
            <span className="text-2xs">|</span>
            <ImageIcon className="h-5 w-5" />
          </div>
          <div className="text-sm font-medium">
            {hint || "Click, drag-drop, or paste a screenshot"}
          </div>
          <div className="text-2xs text-muted-foreground">
            Take a Snip / Screenshot of the detail you're calling out, then paste anywhere on this page.
            Multiple images supported. PNG / JPG / PDF up to 25 MB each.
          </div>
        </div>
      )}
    </div>
  );
}
