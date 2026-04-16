"use client";

// ─────────────────────────────────────────────────────────────────────────────
// useViewMode — app-wide Basic / Advanced toggle.
//
// "Basic" hides edge-case fields and rarely-used sections so analysts who
// just want a back-of-envelope view aren't drowning in inputs. "Advanced"
// shows everything the model can consume.
//
// Persisted in localStorage so the choice sticks across pages and reloads.
// Defaults to "basic" — easier to opt INTO complexity than out of it.
//
// Usage in a page:
//
//   const [mode, setMode] = useViewMode();
//   ...
//   <ViewModeToggle mode={mode} onChange={setMode} />
//   ...
//   {mode === "advanced" && <RareField />}
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

export type ViewMode = "basic" | "advanced";

const STORAGE_KEY = "deal-intel-view-mode";

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  // Initial render is always "basic" so SSR + first client render match;
  // we hydrate from localStorage in an effect to avoid the hydration-
  // mismatch warning that would fire if we read localStorage during the
  // initial useState call.
  const [mode, setModeState] = useState<ViewMode>("basic");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "advanced" || stored === "basic") {
        setModeState(stored);
      }
    } catch {
      // localStorage unavailable (private mode / storage disabled) —
      // fall through to the default.
    }
  }, []);

  // Cross-tab sync so flipping the toggle in one tab updates open
  // sibling tabs without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === "advanced" || e.newValue === "basic") {
        setModeState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = useCallback((m: ViewMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // ignore
    }
  }, []);

  return [mode, setMode];
}
