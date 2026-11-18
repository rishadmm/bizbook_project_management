// Tiny in-memory sliding-window rate limiter for the public (unauthenticated) forms. Per process, which is enough for a single-node deployment;
// swap the Map for a shared store when the app runs on several nodes. Hot-reload safe (kept on globalThis).
const g = globalThis as unknown as { __rateHits?: Map<string, number[]> };
const hits = (g.__rateHits ??= new Map<string, number[]>());

/** Records a hit for `key` and returns true while the caller is within `max` hits per `windowMs`; false = rate limited (the hit is not counted). */
export function rateLimitOk(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
/** Test helper: forget every hit. */
export function resetRateLimits(): void { hits.clear(); }
