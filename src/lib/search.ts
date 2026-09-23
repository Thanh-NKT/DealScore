import { createClient } from "@/lib/supabase/server";

export interface SearchParams {
  q?: string;
  categoryId?: string;
  categorySlug?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: "relevance" | "deal_score" | "price_asc" | "price_desc" | "updated";
  page?: number;
}

export interface SearchItem {
  productId: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  image: string | null;
  categorySlug: string;
  bestPrice: number | null;
  originalPrice: number | null;
  score: number | null;
  recommendation: "insufficient_data" | "buy" | "wait" | "avoid" | null;
  lastObservedAt: string | null;
}

export interface SearchResult {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 24;
const AUTOCOMPLETE_LIMIT = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSearchParams(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
): SearchParams {
  const getParam = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) {
      return raw.get(key) ?? undefined;
    }
    const val = raw[key];
    if (Array.isArray(val)) return val[0];
    return val;
  };

  const getAllParams = (key: string): string[] => {
    if (raw instanceof URLSearchParams) {
      return raw.getAll(key);
    }
    const val = raw[key];
    if (Array.isArray(val)) return val;
    return val ? [val] : [];
  };

  const q = getParam("q")?.trim() || undefined;
  // catId goes straight into the RPC's uuid parameter: a junk value makes the RPC throw → error page.
  const rawCatId = getParam("catId");
  const categoryId = rawCatId && UUID_RE.test(rawCatId) ? rawCatId : undefined;
  const categorySlug = getParam("cat") || undefined;

  // brands may be passed as ?brand=samsung&brand=wd
  const brands = getAllParams("brand")
    .map((b) => b.trim())
    .filter(Boolean);

  let minPrice = getParam("min") ? Number(getParam("min")) : undefined;
  let maxPrice = getParam("max") ? Number(getParam("max")) : undefined;

  if (minPrice != null && isNaN(minPrice)) minPrice = undefined;
  if (maxPrice != null && isNaN(maxPrice)) maxPrice = undefined;

  // Swap if min > max
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    const temp = minPrice;
    minPrice = maxPrice;
    maxPrice = temp;
  }

  const rawSort = getParam("sort");
  const validSorts = ["relevance", "deal_score", "price_asc", "price_desc", "updated"] as const;
  let sort: SearchParams["sort"] = validSorts.find((s) => s === rawSort);

  if (!sort) {
    sort = q ? "relevance" : "updated";
  }

  const rawPage = getParam("page");
  let page = rawPage ? parseInt(rawPage, 10) : 1;
  if (isNaN(page) || page < 1) page = 1;

  return {
    q,
    categoryId,
    categorySlug,
    brands: brands.length > 0 ? brands : undefined,
    minPrice,
    maxPrice,
    sort,
    page,
  };
}

export function toSearchParams(p: SearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.categorySlug) sp.set("cat", p.categorySlug);
  if (p.categoryId) sp.set("catId", p.categoryId);
  if (p.brands) {
    for (const b of p.brands) {
      sp.append("brand", b);
    }
  }
  if (p.minPrice != null) sp.set("min", p.minPrice.toString());
  if (p.maxPrice != null) sp.set("max", p.maxPrice.toString());
  // Don't write default values into the URL: doing so produces two different paths
  // for the same page — duplicate content, harmful to SEO (section 1.7).
  const defaultSort = p.q ? "relevance" : "updated";
  if (p.sort && p.sort !== defaultSort) sp.set("sort", p.sort);
  if (p.page && p.page > 1) sp.set("page", p.page.toString());

  return sp;
}

export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const page = params.page || 1;
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  let catId = params.categoryId;
  if (!catId && params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
      .maybeSingle();
    if (cat) catId = cat.id;
  }

  const { data, error } = await supabase.rpc("search_products", {
    p_q: params.q ?? undefined,
    p_category_id: catId ?? undefined,
    p_brands: params.brands && params.brands.length > 0 ? params.brands : undefined,
    p_min_price: params.minPrice ?? undefined,
    p_max_price: params.maxPrice ?? undefined,
    p_sort: params.sort || "relevance",
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });

  // Do NOT swallow errors and do NOT return made-up data. For a price-lookup product, showing
  // products and prices that don't exist destroys the one thing that makes users
  // trust it. Errors must surface so the page shows a real error state.
  if (error) {
    throw new Error(`Search failed: ${error.message}`);
  }

  const rows = data ?? [];

  // No results is a VALID state (1.1.b AC#6) — the results page suggests
  // removing filters and invites pasting a Shopee URL.
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const items: SearchItem[] = rows.map((d) => ({
    productId: d.product_id,
    slug: d.slug,
    canonicalName: d.canonical_name,
    brand: d.brand,
    image: d.image,
    categorySlug: d.category_slug || "san-pham",
    bestPrice: d.best_price != null ? Number(d.best_price) : null,
    originalPrice: d.original_price != null ? Number(d.original_price) : null,
    score: d.score != null ? Number(d.score) : null,
    recommendation: d.recommendation as SearchItem["recommendation"],
    lastObservedAt: d.last_observed_at,
  }));

  return { items, total, page, pageSize: PAGE_SIZE };
}

export interface FilterFacets {
  categories: Array<{ slug: string; name: string }>;
  brands: string[];
}

/**
 * Categories and brands that ACTUALLY exist in the catalog, for building filters.
 *
 * Don't hard-code this list: hard-coded slugs drift from the real ones and every
 * filter link returns 0 results, while hard-coded brands both show what doesn't exist and
 * miss what does.
 *
 * Brands come from a distinct RPC: reading the whole column into the app gets
 * silently truncated by PostgREST at 1000 rows.
 */
export async function getFilterFacets(): Promise<FilterFacets> {
  const supabase = await createClient();

  const [catRes, brandRes] = await Promise.all([
    supabase.from("categories").select("slug, name").order("sort_order"),
    supabase.rpc("product_brands"),
  ]);

  if (catRes.error) throw new Error(`Failed to read categories: ${catRes.error.message}`);
  if (brandRes.error) throw new Error(`Failed to read brands: ${brandRes.error.message}`);

  const brands = (brandRes.data ?? [])
    .map((r) => r.brand)
    .filter((b): b is string => !!b)
    .sort((a, b) => a.localeCompare(b, "vi"));

  return { categories: catRes.data ?? [], brands };
}

export interface AutocompleteItem {
  productId: string;
  slug: string;
  categorySlug: string;
  name: string;
  brand: string | null;
  image: string | null;
  bestPrice: number | null;
}

/** Typeahead suggestions: fetch exactly the rows to display (spec §12), no filters. */
export async function autocompleteProducts(q: string): Promise<AutocompleteItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_products", {
    p_q: q,
    p_sort: "relevance",
    p_limit: AUTOCOMPLETE_LIMIT,
    p_offset: 0,
  });
  if (error) throw new Error(`Search suggestions failed: ${error.message}`);

  return (data ?? []).map((d) => ({
    productId: d.product_id,
    slug: d.slug,
    categorySlug: d.category_slug || "san-pham",
    name: d.canonical_name,
    brand: d.brand,
    image: d.image,
    bestPrice: d.best_price != null ? Number(d.best_price) : null,
  }));
}
