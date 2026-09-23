import { createClient } from "@/lib/supabase/server";
import {
  buildVariantPricing,
  type OfferRow,
  type VariantPricing,
} from "@/lib/variant-pricing";
import type { DailyPriceRow } from "@/lib/price-history";
import { toVnDate } from "@/lib/format";

export interface ProductPageData {
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    brand: string | null;
    model: string | null;
    image: string | null;
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
}

export async function loadProductPageData(params: {
  productSlug: string;
  variantId?: string;
}): Promise<ProductPageData | null> {
  const { productSlug, variantId } = params;

  try {
    const supabase = await createClient();

    // 1. Lấy thông tin product + categories + product_variants + variant_current_price
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

    // Lỗi DB phải nổi lên — biến nó thành 404 là nói dối rằng sản phẩm không có.
    if (prodError) throw new Error(`Đọc sản phẩm thất bại: ${prodError.message}`);
    // Không tìm thấy là trạng thái hợp lệ — trang sẽ trả notFound().
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

    // Chọn variant: ưu tiên variantId truyền vào, hoặc variant rẻ nhất còn hàng
    let targetVariantId = variantId;
    if (!targetVariantId || !variants.some((v) => v.id === targetVariantId)) {
      const cheapestInStock = variants
        .filter((v) => v.inStock && v.price != null)
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
      targetVariantId = cheapestInStock ? cheapestInStock.id : variants[0].id;
    }

    // Ngày 90 ngày trước theo giờ VN
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400 * 1000);
    const ninetyDaysAgoStr = toVnDate(ninetyDaysAgo);

    // 2-5. Chạy 4 query song song
    const [offersRes, historyRes, latestPricesRes, trackingSinceRes] = await Promise.all([
      supabase
        .from("offers")
        .select(`
          id, match_status,
          listings (
            marketplace, url, title, status, last_observed_at,
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

    // Bất kỳ query nào lỗi thì cả trang lỗi. Nuốt lỗi ở đây thì trang hiện
    // "Chưa có người bán" hoặc ⚪ như thể đó là dữ liệu thật.
    for (const [name, res] of [
      ["offers", offersRes],
      ["variant_daily_prices", historyRes],
      ["latest_price_per_offer", latestPricesRes],
      ["variant_tracking_since", trackingSinceRes],
    ] as const) {
      if (res.error) throw new Error(`Đọc ${name} thất bại: ${res.error.message}`);
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
        status: product.status === "draft" ? "draft" : "verified",
        categorySlug: cat?.slug || "linh-kien",
        categoryName: cat?.name || "Linh kiện",
      },
      variants,
      selectedVariantId: targetVariantId,
      pricing,
      dailyPrices,
    };
  } catch (err) {
    // Lỗi hạ tầng phải nổi lên, không được ngụy trang thành "không tìm thấy".
    console.error("Lỗi loadProductPageData:", err);
    throw err;
  }
}
