import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import type { SearchItem } from "@/lib/search";
import { isOfferVisible, type OfferRow } from "@/lib/pricing/variant-pricing";
import { sellerProfileView, type SellerProfileView } from "@/lib/sellers/profile";
import { parseSellerVoucherHistory, voucherPatterns, VOUCHER_PATTERN_WINDOW_DAYS, type VoucherPatternSummary } from "@/lib/vouchers/patterns";

type Client = SupabaseClient<Database>;
export const SELLER_PAGE_PRODUCTS = 24;

const n = (v: unknown) => (v == null ? null : Number(v));

/** The stored profile → view (null when missing or older than SELLER_PROFILE_MAX_AGE_DAYS). Public read. */
export async function loadSellerProfile(client: Client, sellerId: string, now = new Date()): Promise<SellerProfileView | null> {
  const { data, error } = await client.from("seller_price_profiles").select("*").eq("seller_id", sellerId).maybeSingle();
  if (error) throw new Error(`Failed to read seller profile: ${error.message}`);
  if (!data) return null;
  return sellerProfileView(
    {
      offersTracked: data.offers_tracked,
      claimWeeks: data.claim_weeks,
      claimOffers: data.claim_offers,
      doubtfulWeeks: data.doubtful_weeks,
      hikeWeeks: data.hike_weeks,
      medianSwing: n(data.median_swing),
      stableOffers: data.stable_offers,
      computedAt: data.computed_at,
    },
    now,
  );
}

/** Shop voucher patterns over the last 90 Vietnam days (one RPC). */
export async function loadVoucherPatterns(client: Client, sellerId: string, now = new Date()): Promise<VoucherPatternSummary> {
  const { data, error } = await client.rpc("seller_voucher_history", { p_seller_id: sellerId, p_days: VOUCHER_PATTERN_WINDOW_DAYS });
  if (error) throw new Error(`seller_voucher_history failed: ${error.message}`);
  return voucherPatterns(parseSellerVoucherHistory(data), now);
}

export interface SellerPageData {
  seller: { id: string; name: string | null; marketplace: string; isOfficial: boolean; rating: number | null; ratingCount: number | null };
  profile: SellerProfileView | null;
  vouchers: VoucherPatternSummary;
  products: SearchItem[];
}

/** /seller/[id]: the seller row, profile, voucher patterns and ≤ 24 products it sells (visible offers only). */
export async function loadSellerPage(sellerId: string, now = new Date()): Promise<SellerPageData | null> {
  const supabase = await createClient();
  const { data: seller, error } = await supabase
    .from("sellers")
    .select("id, name, marketplace, is_official, rating, rating_count")
    .eq("id", sellerId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read seller: ${error.message}`);
  if (!seller) return null;

  const [profile, vouchers, offersRes] = await Promise.all([
    loadSellerProfile(supabase, sellerId, now),
    loadVoucherPatterns(supabase, sellerId, now),
    supabase
      .from("offers")
      .select(
        `id, match_status, variant_id,
         listings!inner(status, seller_id),
         product_variants!inner(id, product_id,
           variant_current_price(price, original_price, observed_at, is_flash_sale),
           variant_deal_scores(score, recommendation, price_at_compute),
           products!inner(id, slug, canonical_name, brand, image, status, categories(slug)))`,
      )
      .eq("listings.seller_id", sellerId)
      .limit(500),
  ]);
  if (offersRes.error) throw new Error(`Failed to read seller offers: ${offersRes.error.message}`);

  const products = new Map<string, SearchItem>();
  for (const o of offersRes.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = o.listings as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = o.product_variants as any;
    const p = v?.products;
    if (!p?.slug) continue;
    const visible = isOfferVisible(
      { listingStatus: l?.status, matchStatus: o.match_status } as OfferRow,
      p.status === "draft",
    );
    if (!visible || products.has(p.id)) continue;
    const vcp = Array.isArray(v.variant_current_price) ? v.variant_current_price[0] : v.variant_current_price;
    const ds = Array.isArray(v.variant_deal_scores) ? v.variant_deal_scores[0] : v.variant_deal_scores;
    const price = n(vcp?.price);
    const scoreValid = ds && price != null && n(ds.price_at_compute) === price;
    products.set(p.id, {
      productId: p.id,
      slug: p.slug,
      canonicalName: p.canonical_name,
      brand: p.brand,
      image: p.image,
      categorySlug: p.categories?.slug ?? "san-pham",
      bestPrice: price,
      originalPrice: n(vcp?.original_price),
      score: scoreValid ? n(ds.score) : null,
      recommendation: scoreValid ? ds.recommendation : null,
      lastObservedAt: vcp?.observed_at ?? null,
      effectivePrice: null,
      variantId: null,
      marketplace: seller.marketplace,
      isFlashSale: vcp?.is_flash_sale === true,
      offerCount: null,
      fakeSale: null,
      unitPrice: null,
    });
    if (products.size >= SELLER_PAGE_PRODUCTS) break;
  }

  return {
    seller: {
      id: seller.id,
      name: seller.name,
      marketplace: seller.marketplace,
      isOfficial: seller.is_official,
      rating: n(seller.rating),
      ratingCount: seller.rating_count,
    },
    profile,
    vouchers,
    products: [...products.values()],
  };
}
