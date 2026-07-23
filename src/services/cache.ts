/**
 * Lightweight in-memory + sessionStorage cache with TTL.
 * Used to avoid redundant Firestore queries and blockchain calls across page navigations.
 */

interface CacheEntry<T> {
  data: T;
  ts: number;
}

// In-memory cache (survives page navigations within SPA, cleared on full reload)
const memoryCache = new Map<string, CacheEntry<any>>();

// Default TTLs
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get a cached value. Returns undefined if missing or expired.
 */
export function cacheGet<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | undefined {
  // Try memory first
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.ts < ttlMs) {
    return mem.data as T;
  }

  // Try sessionStorage as fallback (survives SPA navigations + HMR)
  try {
    const raw = sessionStorage.getItem(`cache_${key}`);
    if (raw) {
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.ts < ttlMs) {
        // Promote back to memory
        memoryCache.set(key, entry);
        return entry.data;
      }
      sessionStorage.removeItem(`cache_${key}`);
    }
  } catch { /* sessionStorage may be full or unavailable */ }

  memoryCache.delete(key);
  return undefined;
}

/**
 * Store a value in both memory and sessionStorage.
 */
export function cacheSet<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, ts: Date.now() };
  memoryCache.set(key, entry);
  try {
    sessionStorage.setItem(`cache_${key}`, JSON.stringify(entry));
  } catch { /* quota exceeded — memory cache still works */ }
}

/**
 * Invalidate a cache entry.
 */
export function cacheDelete(key: string): void {
  memoryCache.delete(key);
  try { sessionStorage.removeItem(`cache_${key}`); } catch { }
}

/**
 * Invalidate all entries matching a prefix (e.g. on network switch).
 */
export function cacheClearPrefix(prefix: string): void {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(`cache_${prefix}`)) toRemove.push(k);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  } catch { }
}
