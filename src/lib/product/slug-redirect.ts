import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Permanent redirects for slugs of merged products (migration 0050, `product_slug_redirects`). A chained
 * merge (A→B→C) rewrites A's row to C, so a lookup is always one hop. The real HTTP 308 comes from
 * src/proxy.ts (cached table, `slug-redirect-proxy.ts`); the product page keeps a per-slug lookup as the
 * fallback for the minutes after a merge, before the proxy cache refreshes.
 */
export type SlugRedirectRow = { productSlug: string; categorySlug: string; variantMap: Record<string, string> };

type RedirectQuery = URLSearchParams | Record<string, string | string[] | undefined>;

function toSearchParams(query: RedirectQuery): URLSearchParams {
  if (query instanceof URLSearchParams) return query;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, one);
  }
  return sp;
}

/**
 * Pure: the target URL (no host). Maps `variant` through variantMap (first value; an id missing from the map
 * moved with its id and is kept; an empty one is dropped) and keeps every other parameter as it came
 * (range, ref, utm_* of already-sent emails, …).
 */
export function slugRedirectPath(row: SlugRedirectRow, query: RedirectQuery): string {
  const input = toSearchParams(query);
  const sp = new URLSearchParams();
  const variant = input.get("variant");
  if (variant) sp.set("variant", row.variantMap[variant] ?? variant);
  for (const [k, v] of input) if (k !== "variant") sp.append(k, v);
  const qs = sp.toString();
  return `/${row.categorySlug}/${row.productSlug}${qs ? `?${qs}` : ""}`;
}

function toVariantMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Columns read for a redirect row (target product slug + its category slug). */
export const SLUG_REDIRECT_SELECT = "variant_map, products!inner(slug, categories(slug))";

/** A `product_slug_redirects` row (SLUG_REDIRECT_SELECT) → the redirect, or null when the target has no slug. */
export function toSlugRedirectRow(data: { variant_map: unknown; products: unknown }): SlugRedirectRow | null {
  const product = (Array.isArray(data.products) ? data.products[0] : data.products) as
    | { slug: string | null; categories: { slug: string } | { slug: string }[] | null }
    | null
    | undefined;
  if (!product?.slug) return null;
  const cat = Array.isArray(product.categories) ? product.categories[0] : product.categories;
  return { productSlug: product.slug, categorySlug: cat?.slug || "san-pham", variantMap: toVariantMap(data.variant_map) };
}

/** The redirect for an unknown slug, or null. A DB error throws (it must not turn into a 404). */
export async function loadSlugRedirect(
  supabase: SupabaseClient<Database>,
  oldSlug: string,
): Promise<SlugRedirectRow | null> {
  const { data, error } = await supabase
    .from("product_slug_redirects")
    .select(SLUG_REDIRECT_SELECT)
    .eq("old_slug", oldSlug)
    .maybeSingle();
  if (error) throw new Error(`Failed to read slug redirect: ${error.message}`);
  return data ? toSlugRedirectRow(data) : null;
}
