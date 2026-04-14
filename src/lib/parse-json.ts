/**
 * Shared JSON parsing utilities for AI response handling.
 * Centralised here to avoid duplicate implementations across API routes.
 */

/**
 * Extract and parse the first JSON object from a raw string.
 * Returns `fallback` if the string contains no valid JSON object.
 */
export function parseJsonObject<T>(raw: string, fallback: T): { value: T; usedFallback: boolean } {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { value: fallback, usedFallback: true };
    return { value: JSON.parse(match[0]) as T, usedFallback: false };
  } catch {
    return { value: fallback, usedFallback: true };
  }
}

/**
 * Extract and parse the first JSON array from a raw string.
 * Returns an empty array if none is found or parsing fails.
 */
export function parseJsonArray(raw: string): unknown[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}
