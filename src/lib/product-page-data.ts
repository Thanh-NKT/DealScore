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

    if (prodError || !product) {
      // Fallback demo cho trải nghiệm dev nếu chưa seed DB
      if (productSlug === "ssd-samsung-990-pro-2tb" || productSlug === "demo") {
        return getDemoProductData(variantId);
      }
      return null;
    }

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
          affiliate_offers ( eligible, short_link, affiliate_url )
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
        observedAt: latest?.observed_at || listing?.last_observed_at || new Date().toISOString(),
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
        status: product.status,
        categorySlug: cat?.slug || "linh-kien",
        categoryName: cat?.name || "Linh kiện",
      },
      variants,
      selectedVariantId: targetVariantId,
      pricing,
      dailyPrices,
    };
  } catch (err) {
    console.error("Lỗi loadProductPageData:", err);
    if (productSlug === "ssd-samsung-990-pro-2tb" || productSlug === "demo") {
      return getDemoProductData(variantId);
    }
    return null;
  }
}

/**
 * Dữ liệu giả lập mẫu cho SSD Samsung 990 Pro 2TB (phục vụ test UI ngay cả khi chưa kết nối DB)
 */
function getDemoProductData(requestedVariantId?: string): ProductPageData {
  const v1Id = "var-990pro-1tb";
  const v2Id = "var-990pro-2tb";
  const v3Id = "var-990pro-4tb";

  const selectedId = requestedVariantId === v1Id ? v1Id : requestedVariantId === v3Id ? v3Id : v2Id;

  const dailyPrices: DailyPriceRow[] = [];
  const base = selectedId === v1Id ? 2_450_000 : selectedId === v3Id ? 7_800_000 : 3_890_000;
  const now = new Date();

  for (let i = 89; i >= 0; i--) {
    // Để lại một vài ngày trống để kiểm tra ngắt đoạn biểu đồ SVG (không nội suy)
    if (i === 12 || i === 45) continue;

    const d = new Date(now.getTime() - i * 86_400_000);
    const dayStr = toVnDate(d);
    const wobble = Math.sin(i / 6) * 120_000;
    const dip = i >= 18 && i <= 24 ? -250_000 : 0;
    const hasFlash = i === 20 || i === 55;
    const minP = Math.round(base + wobble + dip);

    dailyPrices.push({
      day: dayStr,
      min_price: minP,
      median_price: minP + 50_000,
      max_price: minP + 180_000,
      obs_count: 5,
      offer_count: 3,
      has_flash_sale: hasFlash,
      flash_min_price: hasFlash ? minP - 200_000 : null,
    });
  }

  const currentPrice = selectedId === v1Id ? 2_290_000 : selectedId === v3Id ? 7_590_000 : 3_690_000;
  const originalPrice = selectedId === v1Id ? 2_990_000 : selectedId === v3Id ? 8_990_000 : 4_590_000;

  const mockOffers: OfferRow[] = [
    {
      offerId: "offer-1",
      marketplace: "shopee",
      listingUrl: "https://shopee.vn/product/123/456",
      listingStatus: "active",
      matchStatus: "auto",
      sellerName: "Samsung Official Store",
      sellerRating: 4.9,
      sellerRatingCount: 15400,
      sellerIsOfficial: true,
      affiliateEligible: true,
      price: currentPrice,
      originalPrice: originalPrice,
      stock: 45,
      isFlashSale: false,
      observedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    },
    {
      offerId: "offer-2",
      marketplace: "shopee",
      listingUrl: "https://shopee.vn/product/789/101",
      listingStatus: "active",
      matchStatus: "auto",
      sellerName: "Memoryzone Official",
      sellerRating: 4.9,
      sellerRatingCount: 8900,
      sellerIsOfficial: true,
      affiliateEligible: true,
      price: currentPrice + 80_000,
      originalPrice: originalPrice,
      stock: 12,
      isFlashSale: false,
      observedAt: new Date(Date.now() - 7200 * 1000).toISOString(),
    },
    {
      offerId: "offer-3",
      marketplace: "shopee",
      listingUrl: "https://shopee.vn/product/999/888",
      listingStatus: "active",
      matchStatus: "auto",
      sellerName: "GearVN Mall",
      sellerRating: 4.8,
      sellerRatingCount: 3400,
      sellerIsOfficial: true,
      affiliateEligible: false,
      price: currentPrice + 150_000,
      originalPrice: originalPrice,
      stock: 0, // Hết hàng
      isFlashSale: false,
      observedAt: new Date(Date.now() - 14400 * 1000).toISOString(),
    },
  ];

  const pricing = buildVariantPricing({
    offers: mockOffers,
    history: dailyPrices,
    trackingSince: dailyPrices[0]?.day ?? "2026-06-20",
    isDraftProduct: false,
  });

  return {
    product: {
      id: "prod-990-pro",
      slug: "ssd-samsung-990-pro-2tb",
      canonicalName: "SSD Samsung 990 Pro PCIe 4.0 NVMe M.2",
      brand: "Samsung",
      model: "MZ-V9P2T0B",
      image: "https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=600&auto=format&fit=crop&q=80",
      status: "verified",
      categorySlug: "o-cung-ssd",
      categoryName: "Ổ cứng SSD",
    },
    variants: [
      { id: v1Id, variantKey: "1TB", price: 2_290_000, inStock: true },
      { id: v2Id, variantKey: "2TB", price: 3_690_000, inStock: true },
      { id: v3Id, variantKey: "4TB", price: 7_590_000, inStock: true },
    ],
    selectedVariantId: selectedId,
    pricing,
    dailyPrices,
  };
}
