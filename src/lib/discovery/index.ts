/**
 * Discovery lists (Phase 2): Price Drop Radar and Trending / Most Watched. Thin loaders over the
 * price_drop_radar / trending_products RPCs (migration 0011); rows map onto SearchItem so the
 * existing ProductCard renders them. Every query error throws.
 */
import { createClient } from "@/lib/supabase/server";
import type { SearchItem } from "@/lib/search";

export const RADAR_PAGE_SIZE = 24;
export const RADAR_MIN_DROP = 0.1;
export const TRENDING_LIMIT = 24;

export type TrendingMode = "watched" | "rising";

export interface RadarItem extends SearchItem {
  variantId: string;
  variantKey: string;
  median30d: number;
  /** 0–1, e.g. 0.18 = 18% under the 30-day median. */
  dropPct: number;
}

export interface TrendingItem extends SearchItem {
  watchCount: number;
  views7d: number;
  viewsPrev7d: number;
}

interface CardRow {
  product_id: string;
  slug: string;
  canonical_name: string;
  brand: string | null;
  image: string | null;
  category_slug: string | null;
  best_price: number | null;
  original_price: number | null;
  score: number | null;
  recommendation: string | null;
  last_observed_at: string | null;
}

function toCard(r: CardRow): SearchItem {
  return {
    productId: r.product_id,
    slug: r.slug,
    canonicalName: r.canonical_name,
    brand: r.brand,
    image: r.image,
    categorySlug: r.category_slug || "san-pham",
    bestPrice: r.best_price != null ? Number(r.best_price) : null,
    originalPrice: r.original_price != null ? Number(r.original_price) : null,
    score: r.score != null ? Number(r.score) : null,
    recommendation: r.recommendation as SearchItem["recommendation"],
    lastObservedAt: r.last_observed_at,
    // Discovery RPCs don't return effective prices (yet).
    effectivePrice: null,
  };
}

async function categoryId(slug: string | undefined): Promise<string | undefined | null> {
  if (!slug) return undefined;
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Failed to read category: ${error.message}`);
  return data?.id ?? null; // null = unknown slug
}

export async function loadRadar(opts: { categorySlug?: string; page?: number } = {}): Promise<{
  items: RadarItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = opts.page && opts.page > 1 ? opts.page : 1;
  const catId = await categoryId(opts.categorySlug);
  if (catId === null) return { items: [], total: 0, page, pageSize: RADAR_PAGE_SIZE };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("price_drop_radar", {
    p_min_drop: RADAR_MIN_DROP,
    p_category_id: catId,
    p_limit: RADAR_PAGE_SIZE,
    p_offset: (page - 1) * RADAR_PAGE_SIZE,
  });
  if (error) throw new Error(`price_drop_radar failed: ${error.message}`);

  const rows = data ?? [];
  return {
    items: rows.map((r) => ({
      ...toCard(r),
      variantId: r.variant_id,
      variantKey: r.variant_key,
      median30d: Number(r.median_30d),
      dropPct: Number(r.drop_pct),
    })),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    page,
    pageSize: RADAR_PAGE_SIZE,
  };
}

export async function loadTrending(mode: TrendingMode, opts: { categorySlug?: string } = {}): Promise<TrendingItem[]> {
  const catId = await categoryId(opts.categorySlug);
  if (catId === null) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trending_products", {
    p_mode: mode,
    p_limit: TRENDING_LIMIT,
    p_category_id: catId,
  });
  if (error) throw new Error(`trending_products failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    ...toCard(r),
    watchCount: r.watch_count,
    views7d: r.views_7d,
    viewsPrev7d: r.views_prev_7d,
  }));
}
