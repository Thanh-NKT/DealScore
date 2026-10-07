/**
 * "Tìm gần đây": the last few queries, per device, in localStorage (spec 2026-10-07-search-quality-ui §2.4).
 * Nothing is stored on the server. Every storage access is wrapped: private mode, blocked site data or a
 * full quota must never break the search box: a failed write still returns the list the UI should show, and
 * callers pass the list they show (`shown`), merged with storage, so later edits survive a failed write.
 */
import { foldText } from "@/lib/search/highlight";

export const RECENT_KEY = "dealscore:recent-searches";
export const RECENT_MAX = 5;
const MAX_LENGTH = 100;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `window.localStorage`, or null on the server or when the browser refuses access. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function clean(q: string): string {
  return q.trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH).trim();
}

function sanitize(list: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const q = clean(raw);
    const key = foldText(q);
    if (!q || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === RECENT_MAX) break;
  }
  return out;
}

function write(list: string[], storage: StorageLike | null): string[] {
  try {
    if (list.length === 0) storage?.removeItem(RECENT_KEY);
    else storage?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Quota or privacy settings: the list still shows for this page view.
  }
  return list;
}

export function readRecent(storage: StorageLike | null = browserStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitize(parsed) : [];
  } catch {
    return [];
  }
}

/** What the box shows plus what storage holds: a write that failed earlier (quota) loses nothing on screen. */
function merged(shown: readonly string[], storage: StorageLike | null): string[] {
  return shown.length === 0 ? readRecent(storage) : sanitize([...shown, ...readRecent(storage)]);
}

/**
 * Records a submitted query: newest first, deduped without accents or case, at most `RECENT_MAX`.
 * `shown`: the list on screen, merged with storage (shown entries first).
 */
export function addRecent(q: string, storage: StorageLike | null = browserStorage(), shown: readonly string[] = []): string[] {
  const query = clean(q);
  const current = merged(shown, storage);
  if (!query) return current;
  const key = foldText(query);
  return write(sanitize([query, ...current.filter((x) => foldText(x) !== key)]), storage);
}

export function removeRecent(q: string, storage: StorageLike | null = browserStorage(), shown: readonly string[] = []): string[] {
  const key = foldText(clean(q));
  return write(
    merged(shown, storage).filter((x) => foldText(x) !== key),
    storage,
  );
}

export function clearRecent(storage: StorageLike | null = browserStorage()): string[] {
  return write([], storage);
}
