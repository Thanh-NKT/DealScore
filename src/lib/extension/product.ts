import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ProductPageData } from "@/lib/product/page-data";
import { MIN_DAYS_FOR_SCORE, type Recommendation } from "@/lib/pricing/deal-score";
import { normalizeText } from "@/lib/matching/attributes";

/** What the extension panel shows for a Shopee page. Only facts DealScore already shows on its own page. */
export interface ExtensionSummary {
  name: string;
  /** DealScore product page (absolute), for "Xem lịch sử giá". */
  url: string;
  variantId: string;
  variantKey: string | null;
  price: number | null;
  score: number | null;
  recommendation: Recommendation | null;
  /** At most two reasons, same wording as the product page. */
  reasons: string[];
  updatedAt: string | null;
  isStale: boolean;
  /** 90-day low / median of the daily low (historyStats) — the product page's StatsRow numbers. */
  low90: number | null;
  median90: number | null;
  /** "Mới ghi nhận {days}/{minDays} ngày": only while the score is missing for lack of days. */
  coverage: { days: number; minDays: number } | null;
  /** Product page, scrolled to the seller list ("So sánh giá"). */
  compareUrl: string;
}

/**
 * The catalog product + variant behind a marketplace listing. Prefers the variant whose key
 * matches the model selected on the page; otherwise the first visible (matched) offer.
 */
export async function findCatalogVariant(
  client: SupabaseClient<Database>,
  marketplace: string,
  item: string,
  modelName: string | null,
): Promise<{ productSlug: string; variantId: string } | null> {
  const { data, error } = await client
    .from("offers")
    .select("variant_id, match_status, listings!inner ( marketplace, external_item_id, status ), product_variants!inner ( variant_key, products!inner ( slug ) )")
    .eq("listings.marketplace", marketplace)
    .eq("listings.external_item_id", item)
    .eq("listings.status", "active")
    .neq("match_status", "rejected")
    .not("variant_id", "is", null)
    .limit(50);
  if (error) throw new Error(`Failed to find listing: ${error.message}`);
  const rows = (data ?? []).map((r) => {
    const v = r.product_variants as unknown as { variant_key: string; products: { slug: string } };
    return { variantId: r.variant_id as string, key: v.variant_key, slug: v.products.slug };
  });
  if (rows.length === 0) return null;
  const wanted = modelName ? normalizeText(modelName) : "";
  const chosen = (wanted && rows.find((r) => normalizeText(r.key) === wanted)) || rows[0];
  return { productSlug: chosen.slug, variantId: chosen.variantId };
}

export function buildExtensionSummary(data: ProductPageData, siteUrl: string): ExtensionSummary {
  const h = data.pricing.headline;
  const variant = data.variants.find((v) => v.id === data.selectedVariantId);
  const url = `${siteUrl}/${data.product.categorySlug}/${data.product.slug}?variant=${data.selectedVariantId}&ref=extension`;
  const days = h?.stats.daysCovered ?? 0;
  return {
    name: data.product.canonicalName,
    url,
    variantId: data.selectedVariantId,
    variantKey: variant?.variantKey ?? null,
    price: data.pricing.cheapest?.price ?? data.pricing.lastKnown?.price ?? null,
    score: h?.score ?? null,
    recommendation: h ? (h.score != null ? h.recommendation : "insufficient_data") : null,
    reasons: (h?.reasons ?? []).slice(0, 2),
    updatedAt: data.pricing.updatedAt,
    isStale: data.pricing.isStale,
    low90: data.pricing.stats.low,
    median90: data.pricing.stats.median,
    // Only when days are what is missing (not observations): the panel can then say how far along it is.
    coverage: h && h.score == null && days < MIN_DAYS_FOR_SCORE ? { days, minDays: MIN_DAYS_FOR_SCORE } : null,
    // Anchor of the OfferList heading on the product page.
    compareUrl: `${url}#offers-heading`,
  };
}
