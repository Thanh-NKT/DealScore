import { createClient } from "@/lib/supabase/server";
import {
  buildVariantPricing,
  type OfferRow,
  type VariantPricing,
} from "@/lib/pricing/variant-pricing";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { toVnDate } from "@/lib/format";
import { productGallery } from "@/lib/product/images";
import { listVouchersForListing } from "@/lib/vouchers/store";
import { activeVouchers } from "@/lib/vouchers/select";
import type { Voucher } from "@/lib/vouchers/types";

/** The listing behind an offer — what vouchers are scoped to. */
export interface OfferListing {
  listingId: string;
  sellerId: string | null;
  marketplace: string;
}

export interface ProductPageData {
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    brand: string | null;
    model: string | null;
    image: string | null;
    /** Product-level specs (brand-agnostic key → value), used by the comparison table. */
    specs: Record<string, unknown>;
    status: "draft" | "verified";
    categorySlug: string;
    categoryName: string;
  };
  variants: Array<{
    id: string;
    variantKey: string;
    price: number | null;
    inStock: boolean;
  }>;
  selectedVariantId: string;
  pricing: VariantPricing;
  dailyPrices: DailyPriceRow[];
  /** Main product image first, then images of the matched listings (spec §5). */
  galleryImages?: string[];
  /** offerId → its listing, for the selected variant's offers. */
  offerListings?: Record<string, OfferListing>;
}

export async function loadProductPageData(params: {
  productSlug: string;
  variantId?: string;
}): Promise<ProductPageData | null> {
  const { productSlug, variantId } = params;

  try {
    const supabase = await createClient();

    // 1. Load product + categories + product_variants + variant_current_price
    const { data: product, error: prodError } = await supabase
      .from("products")
      .select(`
        id, slug, canonical_name, brand, model, image, specs, status,
        categories ( slug, name ),
        product_variants (
          id, variant_key, specs,
          variant_current_price ( price, original_price, in_stock, observed_at )
        )
      `)
      .eq("slug", productSlug)
      .maybeSingle();

    // DB errors must surface — turning them into a 404 lies that the product doesn't exist.
    if (prodError) throw new Error(`Failed to read product: ${prodError.message}`);
    // Not found is a valid state — the page will return notFound().
    if (!product) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productAny = product as any;
    const variantsRaw = (productAny.product_variants || []) as Array<Record<string, unknown>>;
    if (variantsRaw.length === 0) {
      return null;
    }

    const variants = variantsRaw.map((v) => {
      const vcp = (Array.isArray(v.variant_current_price)
        ? v.variant_current_price[0]
        : v.variant_current_price) as Record<string, unknown> | undefined;
      return {
        id: v.id as string,
        variantKey: (v.variant_key as string) || "Tiêu chuẩn",
        price: vcp?.price != null ? Number(vcp.price) : null,
        inStock: (vcp?.in_stock as boolean | undefined) ?? true,
      };
    });

    // Pick the variant: the given variantId first, otherwise the cheapest in-stock variant
    let targetVariantId = variantId;
    if (!targetVariantId || !variants.some((v) => v.id === targetVariantId)) {
      const cheapestInStock = variants
        .filter((v) => v.inStock && v.price != null)
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
      targetVariantId = cheapestInStock ? cheapestInStock.id : variants[0].id;
    }

    // The date 90 days ago in Vietnam time
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400 * 1000);
    const ninetyDaysAgoStr = toVnDate(ninetyDaysAgo);

    // 2-5. Run 4 queries in parallel
    const [offersRes, historyRes, latestPricesRes, trackingSinceRes] = await Promise.all([
      supabase
        .from("offers")
        .select(`
          id, match_status,
          listings (
            id, seller_id, images, marketplace, url, title, status, last_observed_at,
            sellers ( name, rating, rating_count, is_official )
          ),
          affiliate_offers ( eligible )
        `)
        .eq("variant_id", targetVariantId),

      supabase
        .from("variant_daily_prices")
        .select("*")
        .eq("variant_id", targetVariantId)
        .gte("day", ninetyDaysAgoStr)
        .order("day", { ascending: true }),

      supabase.rpc("latest_price_per_offer", { p_variant_id: targetVariantId }),

      supabase.rpc("variant_tracking_since", { p_variant_id: targetVariantId }),
    ]);

    // Any failing query fails the whole page. Swallowing errors here makes the page show
    // "Chưa có người bán" or ⚪ as if that were real data.
    for (const [name, res] of [
      ["offers", offersRes],
      ["variant_daily_prices", historyRes],
      ["latest_price_per_offer", latestPricesRes],
      ["variant_tracking_since", trackingSinceRes],
    ] as const) {
      if (res.error) throw new Error(`Failed to read ${name}: ${res.error.message}`);
    }

    // Map offer rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestPriceMap = new Map<string, any>();
    if (latestPricesRes.data) {
      for (const lp of latestPricesRes.data) {
        latestPriceMap.set(lp.offer_id, lp);
      }
    }

    const offerRows: OfferRow[] = (offersRes.data || []).map((o) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listing = (Array.isArray(o.listings) ? o.listings[0] : o.listings) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seller = listing?.sellers as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aff = (Array.isArray(o.affiliate_offers) ? o.affiliate_offers[0] : o.affiliate_offers) as any;
      const latest = latestPriceMap.get(o.id);

      return {
        offerId: o.id,
        marketplace: listing?.marketplace || "shopee",
        listingUrl: listing?.url || null,
        listingStatus: listing?.status || "active",
        matchStatus: (o.match_status as "auto" | "manual" | "rejected" | "pending") || "pending",
        sellerName: seller?.name || null,
        sellerRating: seller?.rating != null ? Number(seller.rating) : null,
        sellerRatingCount: seller?.rating_count != null ? Number(seller.rating_count) : null,
        sellerIsOfficial: Boolean(seller?.is_official),
        affiliateEligible: Boolean(aff?.eligible),
        price: latest?.price != null ? Number(latest.price) : null,
        originalPrice: latest?.original_price != null ? Number(latest.original_price) : null,
        stock: latest?.stock != null ? Number(latest.stock) : null,
        isFlashSale: Boolean(latest?.is_flash_sale),
        observedAt: latest?.observed_at || listing?.last_observed_at || null,
      };
    });

    const dailyPrices: DailyPriceRow[] = (historyRes.data || []).map((h) => ({
      day: h.day,
      min_price: h.min_price != null ? Number(h.min_price) : null,
      median_price: h.median_price != null ? Number(h.median_price) : null,
      max_price: h.max_price != null ? Number(h.max_price) : null,
      obs_count: h.obs_count,
      offer_count: h.offer_count,
      has_flash_sale: h.has_flash_sale,
      flash_min_price: h.flash_min_price != null ? Number(h.flash_min_price) : null,
    }));

    const offerListings: Record<string, OfferListing> = {};
    const galleryListings: Array<{ marketplace: string; images: string[] }> = [];
    for (const o of offersRes.data || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listing = (Array.isArray(o.listings) ? o.listings[0] : o.listings) as any;
      if (!listing?.id) continue;
      offerListings[o.id] = { listingId: listing.id, sellerId: listing.seller_id ?? null, marketplace: listing.marketplace };
      // Only photos of listings matched to this product: a pending match may be another item.
      if (o.match_status === "auto" || o.match_status === "manual") {
        galleryListings.push({ marketplace: listing.marketplace, images: listing.images ?? [] });
      }
    }

    const trackingSince = (trackingSinceRes.data as string | null) || (dailyPrices[0]?.day ?? null);

    const pricing = buildVariantPricing({
      offers: offerRows,
      history: dailyPrices,
      trackingSince,
      isDraftProduct: product.status === "draft",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cat = (Array.isArray(productAny.categories) ? productAny.categories[0] : productAny.categories) as any;

    return {
      product: {
        id: product.id,
        slug: product.slug || productSlug,
        canonicalName: product.canonical_name,
        brand: product.brand,
        model: product.model,
        image: product.image,
        specs:
          product.specs && typeof product.specs === "object" && !Array.isArray(product.specs)
            ? (product.specs as Record<string, unknown>)
            : {},
        status: product.status === "draft" ? "draft" : "verified",
        categorySlug: cat?.slug || "linh-kien",
        categoryName: cat?.name || "Linh kiện",
      },
      variants,
      selectedVariantId: targetVariantId,
      pricing,
      dailyPrices,
      galleryImages: productGallery(product.image, galleryListings),
      offerListings,
    };
  } catch (err) {
    // Infrastructure errors must surface, never disguised as "not found".
    console.error("loadProductPageData error:", err);
    throw err;
  }
}

/**
 * Vouchers that apply to this offer's listing right now (activeVouchers rules). A failed read is
 * logged and treated as "no vouchers collected": vouchers are an extra, never worth a broken page.
 */
export async function loadActiveVouchers(listing: OfferListing, now = new Date()): Promise<Voucher[]> {
  try {
    const supabase = await createClient();
    const list = await listVouchersForListing(supabase, { ...listing, now });
    return activeVouchers(list, { now, ...listing });
  } catch (err) {
    console.error("loadActiveVouchers failed:", err);
    return [];
  }
}
