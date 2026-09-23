import { createAdminClient } from "@/lib/supabase/admin";
import { externalItemId } from "@/lib/shopee/parse-url";
import { getItemDetail, ShopeeUnavailableError } from "@/lib/shopee/client";
import { slugify } from "@/lib/slug";

export type IngestResult =
  | { status: "resolved"; productUrl: string }
  | { status: "ingested"; productUrl: string }
  | { status: "error"; code: "upstream_unavailable" | "internal" };

function productUrl(categorySlug: string | null, productSlug: string, variantId: string | null) {
  const base = `/${categorySlug || "san-pham"}/${productSlug}`;
  return variantId ? `${base}?variant=${variantId}` : base;
}

/**
 * URL trang sản phẩm nếu listing đã có trong catalog và đã ghép variant.
 * Chỉ đọc, không gọi Shopee — dùng để quyết định lượt này có phải ingest không
 * trước khi tính hạn mức ingest.
 */
export async function findExistingProductUrl(params: {
  shopId: string;
  itemId: string;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("offers")
    .select(`
      variant_id,
      listings!inner ( marketplace, external_item_id ),
      product_variants!inner ( products!inner ( slug, categories ( slug ) ) )
    `)
    .eq("listings.marketplace", "shopee")
    .eq("listings.external_item_id", externalItemId(params.shopId, params.itemId))
    .not("variant_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Tra listing thất bại: ${error.message}`);
  if (!data?.variant_id) return null;

  const product = data.product_variants?.products;
  if (!product?.slug) return null;
  return productUrl(product.categories?.slug ?? null, product.slug, data.variant_id);
}

/**
 * Lấy chi tiết từ Shopee rồi ghi toàn bộ vào catalog bằng RPC
 * ingest_shopee_item — một transaction: thất bại giữa chừng thì không để lại
 * listing thiếu offer hay offer thiếu quan sát. Hai request đồng thời cho cùng
 * một item được RPC tuần tự hóa; request sau nhận 'resolved'.
 */
export async function ingestShopeeItem(params: {
  shopId: string;
  itemId: string;
}): Promise<IngestResult> {
  const { shopId, itemId } = params;

  let detail;
  try {
    detail = await getItemDetail(shopId, itemId);
  } catch (err) {
    if (!(err instanceof ShopeeUnavailableError)) console.error("Lỗi gọi Shopee:", err);
    return { status: "error", code: "upstream_unavailable" };
  }
  if (!detail.title || detail.models.length === 0) {
    return { status: "error", code: "upstream_unavailable" };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: externalItemId(shopId, itemId),
      url: `https://shopee.vn/product/${shopId}/${itemId}`,
      title: detail.title,
      slug_base: slugify(detail.title, 80),
      source: detail.source,
      seller: {
        external_id: shopId,
        name: detail.sellerName,
        rating: detail.sellerRating,
        rating_count: detail.sellerRatingCount,
        is_official: detail.sellerIsOfficial,
      },
      models: detail.models.map((m) => ({
        model_id: m.modelId,
        name: m.name,
        price: m.price,
        original_price: m.originalPrice,
        stock: m.stock,
        is_flash_sale: m.isFlashSale,
      })),
    },
  });

  if (error || !data) {
    console.error("Lỗi ingest_shopee_item:", error?.message);
    return { status: "error", code: "internal" };
  }

  const r = data as {
    status: "resolved" | "ingested";
    product_slug: string;
    category_slug: string | null;
    variant_id: string | null;
  };
  return {
    status: r.status,
    productUrl: productUrl(r.category_slug, r.product_slug, r.variant_id),
  };
}
