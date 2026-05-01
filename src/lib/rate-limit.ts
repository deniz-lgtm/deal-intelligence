import { NextResponse } from "next/server";

// Simple in-process token-bucket rate limiter. Each (scope, key) pair
// gets its own bucket; tokens refill linearly at `refillPerSec`. Calls
// that find an empty bucket get a 429 with Retry-After.
//
// In-process means each Node instance has its own buckets — a horizontal
// scale-out divides the effective limit across instances. That's
// acceptable as a first line of defense against runaway clients and
// abusive single users; switch to a shared store (Redis) when traffic
// patterns warrant it.

interface Limit {
  /** Max tokens the bucket can hold (== burst size). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// Single map keyed by `${scope}:${key}` so multiple limiters can coexist
// without colliding on the same userId.
const buckets = new Map<string, Bucket>();

// Evict the oldest insertion when the map gets too large. Worst case
// for an evicted user is a fresh full bucket on their next call —
// effectively the same as if they'd been idle long enough for their
// bucket to refill, so no protection lost in practice.
const MAX_BUCKETS = 10_000;

function consume(scope: string, key: string, limit: Limit) {
  const id = `${scope}:${key}`;
  const now = Date.now();
  let bucket = buckets.get(id);

  if (!bucket) {
    bucket = { tokens: limit.capacity, lastRefill: now };
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    buckets.set(id, bucket);
  } else {
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(
        limit.capacity,
        bucket.tokens + elapsedSec * limit.refillPerSec
      );
      bucket.lastRefill = now;
    }
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true as const };
  }

  // Time until the bucket has 1 full token to spend, in ms.
  const retryAfterMs = Math.ceil(((1 - bucket.tokens) / limit.refillPerSec) * 1000);
  return { ok: false as const, retryAfterMs };
}

/**
 * Returns null when the request is within the budget, or a 429
 * NextResponse (with Retry-After) when it isn't. Caller should
 * `if (resp) return resp;` immediately after calling.
 */
export function rateLimit(
  scope: string,
  key: string,
  limit: Limit
): NextResponse | null {
  const result = consume(scope, key, limit);
  if (result.ok) return null;
  const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
  return NextResponse.json(
    {
      error: "Too many requests. Please slow down and try again shortly.",
      retry_after_ms: result.retryAfterMs,
    },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSec)) },
    }
  );
}

// Standard limits used by the API. Hardcoded for now — swap to env
// when traffic patterns make per-deployment tuning useful.
export const CHAT_LIMIT: Limit = {
  capacity: 30,
  refillPerSec: 30 / 60, // 30 messages / 60 seconds sustained, 30 burst
};

// Test hook — clears in-memory state between tests.
export function _resetRateLimitForTests() {
  buckets.clear();
}
