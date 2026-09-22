import { createAdminClient } from "@/lib/supabase/admin";
import { externalItemId } from "@/lib/shopee/parse-url";
import { getItemDetail } from "@/lib/shopee/client";
import { slugify, uniqueSlug } from "@/lib/slug";
import { toVnDate } from "@/lib/format";

export type IngestResult =
  | { status: "resolved"; productUrl: string }
  | { status: "ingested"; productUrl: string }
  | { status: "error"; code: "upstream_unavailable" | "internal" };

export async function resolveOrIngestShopee(params: {
  shopId: string;
  itemId: string;
}): Promise<IngestResult> {
  const { shopId, itemId } = params;
  const extItemId = externalItemId(shopId, itemId);

  try {
    const supabase = createAdminClient();

    // 1. Kiểm tra listing đã có trong hệ thống chưa
    const { data: existingListing } = await supabase
      .from("listings")
      .select("id, status")
      .eq("marketplace", "shopee")
      .eq("external_item_id", extItemId)
      .maybeSingle();

    if (existingListing) {
      // Tìm offer đã ghép variant
      const { data: offer } = await supabase
        .from("offers")
        .select(`
          id, variant_id,
          product_variants (
            id,
            products (
              slug,
              category_id,
              categories ( slug )
            )
          )
        `)
        .eq("listing_id", existingListing.id)
        .not("variant_id", "is", null)
        .limit(1)
        .maybeSingle();

      if (offer?.variant_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const offerAny = offer as any;
        const variant = offerAny?.product_variants;
        const product = variant?.products;
        const catSlug = product?.categories?.slug || "san-pham";
        const prodSlug = product?.slug || "chi-tiet";
        return {
          status: "resolved",
          productUrl: `/${catSlug}/${prodSlug}?variant=${offer.variant_id}`,
        };
      }
    }

    // 2. Chưa có trong catalog -> Thực hiện Ingest (Đ6)
    const itemDetail = await getItemDetail(shopId, itemId);
    if (!itemDetail || !itemDetail.title) {
      return { status: "error", code: "upstream_unavailable" };
    }

    // 3. Upsert seller
    const sellerExtId = shopId;
    let sellerId: string | undefined;
    const { data: existingSeller } = await supabase
      .from("sellers")
      .select("id")
      .eq("marketplace", "shopee")
      .eq("external_seller_id", sellerExtId)
      .maybeSingle();

    if (existingSeller) {
      sellerId = existingSeller.id;
    } else {
      const { data: newSeller } = await supabase
        .from("sellers")
        .insert({
          marketplace: "shopee",
          external_seller_id: sellerExtId,
          name: itemDetail.sellerName,
          rating: itemDetail.sellerRating,
          rating_count: itemDetail.sellerRatingCount,
          is_official: itemDetail.sellerIsOfficial,
        })
        .select("id")
        .single();
      sellerId = newSeller?.id;
    }

    // 4. Upsert listing
    let listingId = existingListing?.id;
    if (!listingId) {
      const { data: newListing, error: listingError } = await supabase
        .from("listings")
        .insert({
          marketplace: "shopee",
          external_item_id: extItemId,
          seller_id: sellerId ?? null,
          title: itemDetail.title,
          url: `https://shopee.vn/product/${shopId}/${itemId}`,
          status: "active",
          refresh_priority: 1,
        })
        .select("id")
        .single();

      if (listingError || !newListing) {
        throw new Error(`Failed to create listing: ${listingError?.message}`);
      }
      listingId = newListing.id;
    }

    // 5. Tạo Product 'draft' cho sản phẩm mới (Đ6)
    const baseSlug = slugify(itemDetail.title, 80);
    const prodSlug = await uniqueSlug(baseSlug, async (testSlug) => {
      const { data } = await supabase
        .from("products")
        .select("id")
        .eq("slug", testSlug)
        .maybeSingle();
      return !!data;
    });

    const { data: newProduct, error: prodError } = await supabase
      .from("products")
      .insert({
        canonical_name: itemDetail.title,
        status: "draft",
        slug: prodSlug,
        specs: {},
      })
      .select("id")
      .single();

    if (prodError || !newProduct) {
      throw new Error(`Failed to create draft product: ${prodError?.message}`);
    }

    const productId = newProduct.id;
    let firstVariantId: string | null = null;
    const nowIso = new Date().toISOString();

    // 6. Tạo variant, offer, quan sát giá
    for (const model of itemDetail.models) {
      const { data: newVariant } = await supabase
        .from("product_variants")
        .insert({
          product_id: productId,
          variant_key: model.name,
          specs: {},
        })
        .select("id")
        .single();

      if (!newVariant) continue;
      if (!firstVariantId) firstVariantId = newVariant.id;

      const { data: newOffer } = await supabase
        .from("offers")
        .insert({
          listing_id: listingId,
          external_model_id: model.modelId,
          variant_id: newVariant.id,
          match_status: "pending",
        })
        .select("id")
        .single();

      if (newOffer) {
        // Quan sát giá đầu tiên
        await supabase.from("price_observations").insert({
          offer_id: newOffer.id,
          price: model.price,
          original_price: model.originalPrice,
          stock: model.stock,
          is_flash_sale: model.isFlashSale,
          is_valid: true,
          source: "api",
          observed_at: nowIso,
        });

        // Cập nhật variant_current_price
        await supabase.from("variant_current_price").upsert({
          variant_id: newVariant.id,
          best_offer_id: newOffer.id,
          price: model.price,
          original_price: model.originalPrice,
          is_flash_sale: model.isFlashSale,
          in_stock: (model.stock ?? 1) > 0,
          offer_count: 1,
          observed_at: nowIso,
        });
      }
    }

    // Refresh rollup cho hôm nay
    const todayStr = toVnDate(new Date());
    await supabase.rpc("refresh_variant_daily_prices", {
      p_from: todayStr,
      p_to: todayStr,
    });

    return {
      status: "ingested",
      productUrl: `/san-pham/${prodSlug}${firstVariantId ? `?variant=${firstVariantId}` : ""}`,
    };
  } catch (err) {
    console.error("Lỗi Ingest Shopee:", err);
    return { status: "error", code: "internal" };
  }
}
