import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Permanent redirects for slugs of merged products (migration 0050, `product_slug_redirects`). A chained
 * merge (A→B→C) rewrites A's row to C, so a lookup is always one hop.
 */
export type SlugRedirectRow = { productSlug: string; categorySlug: string; variantMap: Record<string, string> };

type RedirectQuery = { variant?: string | string[]; range?: string | string[]; ref?: string | string[] };

function first(v: string | string[] | undefined): string | undefined {
  const one = Array.isArray(v) ? v[0] : v;
  return one ? one : undefined;
}

/**
 * Pure: the target URL (no host). Keeps `range` / `ref`, maps `variant` through variantMap (an id missing
 * from the map moved with its id and is kept), drops every other parameter.
 */
export function slugRedirectPath(row: SlugRedirectRow, query: RedirectQuery): string {
  const sp = new URLSearchParams();
  const variant = first(query.variant);
  if (variant) sp.set("variant", row.variantMap[variant] ?? variant);
  const range = first(query.range);
  if (range) sp.set("range", range);
  const ref = first(query.ref);
  if (ref) sp.set("ref", ref);
  const qs = sp.toString();
  return `/${row.categorySlug}/${row.productSlug}${qs ? `?${qs}` : ""}`;
}

function toVariantMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

/** The redirect for an unknown slug, or null. A DB error throws (it must not turn into a 404). */
export async function loadSlugRedirect(
  supabase: SupabaseClient<Database>,
  oldSlug: string,
): Promise<SlugRedirectRow | null> {
  const { data, error } = await supabase
    .from("product_slug_redirects")
    .select("variant_map, products!inner(slug, categories(slug))")
    .eq("old_slug", oldSlug)
    .maybeSingle();
  if (error) throw new Error(`Failed to read slug redirect: ${error.message}`);
  if (!data) return null;
  const product = (Array.isArray(data.products) ? data.products[0] : data.products) as
    | { slug: string | null; categories: { slug: string } | { slug: string }[] | null }
    | null
    | undefined;
  if (!product?.slug) return null;
  const cat = Array.isArray(product.categories) ? product.categories[0] : product.categories;
  return { productSlug: product.slug, categorySlug: cat?.slug || "san-pham", variantMap: toVariantMap(data.variant_map) };
}
