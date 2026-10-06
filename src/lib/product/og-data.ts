import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { Recommendation } from "@/lib/pricing/deal-score";

export interface OgProduct {
  canonicalName: string;
  brand: string | null;
  /** Lowest in-stock current price over the variants, null when none. */
  lowPrice: number | null;
  /**
   * Cached verdict of the variant with that price — only while it was computed for that exact price
   * (same gate as search_products). null otherwise: the image then shows no verdict rather than a stale one.
   */
  recommendation: Recommendation | null;
}

const RECOMMENDATIONS: readonly Recommendation[] = ["buy", "wait", "avoid", "insufficient_data"];

type VariantRow = {
  variant_current_price: { price: number | null; in_stock: boolean } | { price: number | null; in_stock: boolean }[] | null;
  variant_deal_scores:
    | { recommendation: string; price_at_compute: number | null }
    | { recommendation: string; price_at_compute: number | null }[]
    | null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Pure mapping, exported for tests. */
export function toOgProduct(row: { canonical_name: string; brand: string | null; product_variants: VariantRow[] | null }): OgProduct {
  let low: { price: number; rec: Recommendation | null } | null = null;
  for (const v of row.product_variants ?? []) {
    const vcp = one(v.variant_current_price);
    const price = vcp?.price != null ? Number(vcp.price) : null;
    if (!vcp?.in_stock || price == null || !(price > 0)) continue;
    if (low && price >= low.price) continue;
    const vds = one(v.variant_deal_scores);
    const rec =
      vds && vds.price_at_compute != null && Number(vds.price_at_compute) === price && RECOMMENDATIONS.includes(vds.recommendation as Recommendation)
        ? (vds.recommendation as Recommendation)
        : null;
    low = { price, rec };
  }
  return { canonicalName: row.canonical_name, brand: row.brand, lowPrice: low?.price ?? null, recommendation: low?.rec ?? null };
}

/**
 * What the share image needs — name, brand, lowest current price, cached verdict — in ONE public read,
 * shared across requests for 10 minutes (a link shared in a group chat is fetched by every client).
 * The cookie-less client keeps user data out of the cache. A failed read throws (never cached).
 */
export const loadOgProduct = unstable_cache(
  async (slug: string): Promise<OgProduct | null> => {
    const { data, error } = await createPublicClient()
      .from("products")
      .select(
        "canonical_name, brand, product_variants ( variant_current_price ( price, in_stock ), variant_deal_scores ( recommendation, price_at_compute ) )",
      )
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(`Failed to read product for OG image: ${error.message}`);
    return data ? toOgProduct(data as unknown as Parameters<typeof toOgProduct>[0]) : null;
  },
  ["og-product-v1"],
  { revalidate: 600, tags: ["og-product"] },
);
