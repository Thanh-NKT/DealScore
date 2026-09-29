import { createClient } from "@/lib/supabase/server";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";

export interface SearchParams {
  q?: string;
  categoryId?: string;
  categorySlug?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: "relevance" | "deal_score" | "price_asc" | "price_desc" | "updated" | "effective_asc";
  page?: number;
  /** Seller rating of the best offer (Phase 2 advanced filters). */
  minRating?: MinRating;
  freeShipping?: boolean;
  hasVoucher?: boolean;
  /** Keep products sold on at least one of these marketplaces (`?market=shopee,lazada`). */
  marketplaces?: MarketplaceId[];
  /** From query intent (Phase 3 group A) — GB, not yet filtered in SQL (Task 4). `?cap=2048`. */
  capacityGb?: number;
  /** From query intent — chip + boostTerms only, no URL param. */
  sizeInch?: number;
  /** From query intent — chip + boostTerms only, no URL param, English value (e.g. "black"). */
  color?: string;
  /** From query intent — relevance boost only, never a filter. No URL param (derived from `q`). */
  boostTerms?: string[];
  /** Whether query-intent parsing runs on `q`. Default true; `?intent=0` turns it off. */
  intent?: boolean;
  /** "Theo sở thích của tôi" toggle (§5). Default false; `?prefs=1` turns it on. */
  prefs?: boolean;
  /** True only when the URL's `sort` param was itself a valid sort value (set by parseSearchParams). */
  sortExplicit?: boolean;
}

export const MIN_RATINGS = [4.5, 4.8] as const;
export type MinRating = (typeof MIN_RATINGS)[number];

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

/**
 * `?market=shopee,lazada` (repeated `market=` also accepted) → known marketplace ids, deduped and in
 * MARKETPLACES order so one selection has exactly one URL. Unknown ids are dropped; none → undefined.
 */
export function parseMarketplaces(values: readonly string[]): MarketplaceId[] | undefined {
  const wanted = new Set(
    values
      .flatMap((v) => v.split(","))
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
  const ids = MARKETPLACES.map((m) => m.id).filter((id) => wanted.has(id));
  return ids.length > 0 ? ids : undefined;
}

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

  const rawRating = Number(getParam("rating"));
  const minRating = MIN_RATINGS.find((r) => r === rawRating);
  const freeShipping = getParam("freeship") === "1" ? true : undefined;
  const hasVoucher = getParam("voucher") === "1" ? true : undefined;

  const marketplaces = parseMarketplaces(getAllParams("market"));

  const rawSort = getParam("sort");
  const validSorts = [
    "relevance",
    "deal_score",
    "price_asc",
    "price_desc",
    "updated",
    "effective_asc",
  ] as const;
  let sort: SearchParams["sort"] = validSorts.find((s) => s === rawSort);
  const sortExplicit = sort !== undefined;

  if (!sort) {
    sort = q ? "relevance" : "updated";
  }

  const rawPage = getParam("page");
  let page = rawPage ? parseInt(rawPage, 10) : 1;
  if (isNaN(page) || page < 1) page = 1;

  // Capacity from query intent (Task 3): integer GB, sane bounds. Not written by URL sharing
  // outside intent chips, but still a first-class URL param (`?cap=2048`).
  const rawCap = getParam("cap");
  let capacityGb = rawCap ? Number(rawCap) : undefined;
  if (capacityGb != null && (!Number.isInteger(capacityGb) || capacityGb < 1 || capacityGb > 65536)) {
    capacityGb = undefined;
  }

  // `intent=0` turns off query-intent parsing; absent means "on" (undefined, not true — callers
  // check `!== false`).
  const intent = getParam("intent") === "0" ? false : undefined;
  const prefs = getParam("prefs") === "1" ? true : undefined;

  return {
    q,
    categoryId,
    categorySlug,
    brands: brands.length > 0 ? brands : undefined,
    minPrice,
    maxPrice,
    sort,
    sortExplicit,
    page,
    minRating,
    freeShipping,
    hasVoucher,
    marketplaces,
    capacityGb,
    intent,
    prefs,
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
  if (p.minRating != null) sp.set("rating", String(p.minRating));
  if (p.freeShipping) sp.set("freeship", "1");
  if (p.hasVoucher) sp.set("voucher", "1");
  const markets = parseMarketplaces(p.marketplaces ?? []);
  if (markets) sp.set("market", markets.join(","));
  if (p.capacityGb != null) sp.set("cap", p.capacityGb.toString());
  // Don't write default values into the URL: doing so produces two different paths
  // for the same page — duplicate content, harmful to SEO (section 1.7).
  const defaultSort = p.q ? "relevance" : "updated";
  if (p.sort && p.sort !== defaultSort) sp.set("sort", p.sort);
  if (p.page && p.page > 1) sp.set("page", p.page.toString());
  if (p.intent === false) sp.set("intent", "0");
  if (p.prefs) sp.set("prefs", "1");

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
    p_min_rating: params.minRating ?? undefined,
    p_free_shipping: params.freeShipping ?? undefined,
    p_has_voucher: params.hasVoucher ?? undefined,
    p_marketplaces: parseMarketplaces(params.marketplaces ?? []),
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
  /** Which advanced filters have data behind them; the UI hides the empty ones. */
  advanced: AdvancedFilterAvailability;
  /** Marketplaces with matched offers, in MARKETPLACES order. The filter needs ≥ 2 (PRODUCT.md). */
  marketplaces: MarketplaceId[];
}

export interface AdvancedFilterAvailability {
  rating: boolean;
  freeShipping: boolean;
  voucher: boolean;
}

export const NO_ADVANCED_FILTERS: AdvancedFilterAvailability = { rating: false, freeShipping: false, voucher: false };

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

  const [catRes, brandRes, availRes] = await Promise.all([
    supabase.from("categories").select("slug, name").order("sort_order"),
    supabase.rpc("product_brands"),
    supabase.rpc("filter_availability"),
  ]);
  if (availRes.error) throw new Error(`Failed to read filter availability: ${availRes.error.message}`);
  const avail = availRes.data?.[0];
  const advanced: AdvancedFilterAvailability = avail
    ? { rating: avail.rating, freeShipping: avail.free_shipping, voucher: avail.voucher }
    : NO_ADVANCED_FILTERS;
  const marketplaces = parseMarketplaces(avail?.marketplaces ?? []) ?? [];

  if (catRes.error) throw new Error(`Failed to read categories: ${catRes.error.message}`);
  if (brandRes.error) throw new Error(`Failed to read brands: ${brandRes.error.message}`);

  const brands = (brandRes.data ?? [])
    .map((r) => r.brand)
    .filter((b): b is string => !!b)
    .sort((a, b) => a.localeCompare(b, "vi"));

  return { categories: catRes.data ?? [], brands, advanced, marketplaces };
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
    // Suggestions are unfiltered (spec §12): no marketplace restriction.
    p_marketplaces: undefined,
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
