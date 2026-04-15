"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

/**
 * Page Context
 * ────────────
 * Lets any page publish what's currently on-screen to the floating
 * UniversalChatbot widget. The chatbot pulls this in on every send so
 * Claude knows what the user is looking at, and so UW-aware features
 * (Apply to Model, benchmarks, what-if) know which deal's model they're
 * acting on.
 *
 * Usage in a page:
 *
 *   useSetPageContext({
 *     dealId: deal.id,
 *     dealName: deal.name,
 *     route: "underwriting",
 *     screenSummary: `Underwriting model — purchase price $${price}, ...`,
 *     underwriting: { uwData, metrics, onApplyPatch },
 *   }, [deal.id, price]);
 */

export interface UnderwritingSurface {
  uwData: Record<string, unknown>;
  metrics: Record<string, unknown>;
  onApplyPatch: (patch: Record<string, number>) => void;
}

export interface PageContextValue {
  dealId: string | null;
  dealName: string | null;
  route: string | null;
  screenSummary: string | null;
  underwriting: UnderwritingSurface | null;
}

const EMPTY_CONTEXT: PageContextValue = {
  dealId: null,
  dealName: null,
  route: null,
  screenSummary: null,
  underwriting: null,
};

type Updater = (ctx: Partial<PageContextValue> | null) => void;

const PageContextStore = createContext<{
  value: PageContextValue;
  setContext: Updater;
} | null>(null);

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<PageContextValue>(EMPTY_CONTEXT);

  const setContext = useCallback<Updater>((ctx) => {
    if (ctx === null) {
      setValue(EMPTY_CONTEXT);
    } else {
      setValue((prev) => ({ ...prev, ...ctx }));
    }
  }, []);

  return (
    <PageContextStore.Provider value={{ value, setContext }}>
      {children}
    </PageContextStore.Provider>
  );
}

/** Read the current page context (for the chatbot widget). */
export function usePageContext(): PageContextValue {
  const store = useContext(PageContextStore);
  return store?.value ?? EMPTY_CONTEXT;
}

/** Internal setter (chatbot uses this only for resets). */
export function usePageContextSetter(): Updater {
  const store = useContext(PageContextStore);
  return store?.setContext ?? (() => {});
}

/**
 * Publish page context. Call once on a page with the current screen
 * state. Cleans up on unmount so workspace pages don't inherit a stale
 * deal ID from a deal page you navigated away from.
 *
 * Pass `deps` for the values in `ctx` that change over the page's
 * lifetime (e.g. form fields, computed metrics). The provider does a
 * shallow merge, so only changed fields need to be in the update.
 */
export function useSetPageContext(
  ctx: Partial<PageContextValue>,
  deps: React.DependencyList
) {
  const store = useContext(PageContextStore);
  const setContext = store?.setContext;
  // Keep a ref to the latest ctx so the cleanup effect doesn't need it
  // in its dep list (avoids fighting React's exhaustive-deps).
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (!setContext) return;
    setContext(ctxRef.current);
    return () => {
      // On unmount, reset the fields this page owned. We don't nuke the
      // whole context because a parent layout might own dealId/dealName.
      const reset: Partial<PageContextValue> = {};
      for (const k of Object.keys(ctxRef.current) as Array<
        keyof PageContextValue
      >) {
        reset[k] = null as never;
      }
      setContext(reset);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
