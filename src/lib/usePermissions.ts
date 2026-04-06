"use client";

import { useEffect, useState } from "react";

export interface MeData {
  id: string;
  role: "user" | "admin";
  permissions: string[];
}

let cache: MeData | null = null;
let inflight: Promise<MeData | null> | null = null;

async function fetchMe(): Promise<MeData | null> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return null;
      const json = await res.json();
      cache = json.data as MeData;
      return cache;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Client hook returning the current user's role + permissions and a `can()`
 * helper. Admins always pass `can()`. Returns `loading: true` until first fetch.
 */
export function usePermissions() {
  const [me, setMe] = useState<MeData | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    fetchMe().then((data) => {
      if (cancelled) return;
      setMe(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const can = (permission: string): boolean => {
    if (!me) return false;
    if (me.role === "admin") return true;
    return me.permissions.includes(permission);
  };

  return { me, loading, can, isAdmin: me?.role === "admin" };
}
