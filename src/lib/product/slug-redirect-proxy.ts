import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SLUG_REDIRECT_SELECT, toSlugRedirectRow, type SlugRedirectRow } from "@/lib/product/slug-redirect";

/**
 * Merged-product slug redirects for src/proxy.ts (review P3 I1). The product route streams under a loading
 * boundary, so the page's own permanentRedirect cannot set the status any more; the proxy runs before the
 * render and can answer a real HTTP 308.
 *
 * The whole `product_slug_redirects` table (tiny, anon-readable) is held in a per-process map refreshed about
 * every SLUG_REDIRECT_TTL_MS: one paged read per refresh, never one per request. The cache is best effort —
 * the proxy may run in a fresh isolate, and a merge from the last few minutes is not in it yet — so the
 * product page keeps its own lookup as the fallback.
 */

/** How long a loaded table is served before a background refresh. */
export const SLUG_REDIRECT_TTL_MS = 5 * 60_000;
/** After a failed load, how long before the next attempt (lookups answer from the last good map, or null). */
export const SLUG_REDIRECT_RETRY_MS = 30_000;
/** Upper bound for one page read, so a hung DB never holds a request for long. */
export const SLUG_REDIRECT_LOAD_TIMEOUT_MS = 3_000;
const PAGE = 1_000;

/**
 * First path segments that are never a category: the static top-level routes of src/app (a test checks the
 * list stays complete), the legacy Vietnamese routes of next.config.ts and the reserved category slugs of 0062.
 */
export const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  "_next", "account", "admin", "api", "auth", "brand", "compare", "dang-nhap", "danh-muc", "deal-score",
  "extension", "forgot-password", "go", "huy-dang-ky", "login", "privacy", "radar", "register",
  "reset-password", "search", "seller", "share-target", "shared", "tai-khoan", "terms", "tim-kiem",
  "trending", "unsubscribe", "watch", "wishlist",
]);

const TWO_SEGMENTS = /^\/([^/]+)\/([^/]+)$/;

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Pure: the product slug of a `/{category}/{slug}` path that could be a product page, else null. */
export function productSlugCandidate(pathname: string): string | null {
  const m = pathname.match(TWO_SEGMENTS);
  if (!m) return null;
  const category = decode(m[1]);
  const slug = decode(m[2]);
  if (!category || !slug || RESERVED_FIRST_SEGMENTS.has(category)) return null;
  if (category.includes(".") || slug.includes(".")) return null; // files (robots.txt, images, …), never slugs
  return slug;
}

/** Every redirect row, paged by 1,000 (PostgREST cap), keyed by old slug. Throws on a DB error. */
export async function loadAllSlugRedirects(client: SupabaseClient<Database>): Promise<Map<string, SlugRedirectRow>> {
  const out = new Map<string, SlugRedirectRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("product_slug_redirects")
      .select(`old_slug, ${SLUG_REDIRECT_SELECT}`)
      .order("old_slug")
      .range(from, from + PAGE - 1)
      .abortSignal(AbortSignal.timeout(SLUG_REDIRECT_LOAD_TIMEOUT_MS));
    if (error) throw new Error(`Failed to read slug redirects: ${error.message}`);
    const rows = (data ?? []) as Array<{ old_slug: string; variant_map: unknown; products: unknown }>;
    for (const r of rows) {
      const row = toSlugRedirectRow(r);
      if (row) out.set(r.old_slug, row);
    }
    if (rows.length < PAGE) return out;
  }
}

export type SlugRedirectCache = { lookup(oldSlug: string): Promise<SlugRedirectRow | null> };

/**
 * Stale-while-revalidate map. The first lookup waits for the load; later ones answer from memory and, once
 * the TTL is over, start one background refresh. A failed load keeps the last good map (or none) and is
 * retried after SLUG_REDIRECT_RETRY_MS.
 */
export function createSlugRedirectCache(opts: {
  load: () => Promise<Map<string, SlugRedirectRow>>;
  now?: () => number;
  onError?: (err: unknown) => void;
  ttlMs?: number;
  retryMs?: number;
}): SlugRedirectCache {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? SLUG_REDIRECT_TTL_MS;
  const retry = opts.retryMs ?? SLUG_REDIRECT_RETRY_MS;
  let map: Map<string, SlugRedirectRow> | null = null;
  let nextRefreshAt = 0;
  let inflight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    if (!inflight) {
      inflight = opts
        .load()
        .then((m) => {
          map = m;
          nextRefreshAt = now() + ttl;
        })
        .catch((err) => {
          nextRefreshAt = now() + retry;
          opts.onError?.(err);
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  return {
    async lookup(oldSlug) {
      if (now() >= nextRefreshAt) {
        const pending = refresh();
        if (!map) await pending;
      }
      return map?.get(oldSlug) ?? null;
    },
  };
}
