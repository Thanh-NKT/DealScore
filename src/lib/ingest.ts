import { createAdminClient } from "@/lib/supabase/admin";
import { externalItemId } from "@/lib/shopee/parse-url";
import { getItemDetail, ShopeeUnavailableError } from "@/lib/shopee/client";
import { slugify } from "@/lib/slug";
import { bestMatch, type MatchCandidate, type MatchResult } from "@/lib/matching/match";
import { loadMatchCandidates } from "@/lib/matching/candidates";
import { saveListingExtras } from "@/lib/listing-extras";

function toRpcMatch(m: MatchResult | null) {
  return m ? { variant_id: m.variantId, confidence: m.confidence, reason: m.reason } : null;
}

export type IngestResult =
  | { status: "resolved"; productUrl: string }
  | { status: "ingested"; productUrl: string }
  | { status: "error"; code: "upstream_unavailable" | "internal" };

function productUrl(categorySlug: string | null, productSlug: string, variantId: string | null) {
  const base = `/${categorySlug || "san-pham"}/${productSlug}`;
  return variantId ? `${base}?variant=${variantId}` : base;
}

/**
 * Product page URL if the listing is already in the catalog and matched to a variant.
 * Read-only, never calls Shopee — used to decide whether this request needs an ingest
 * before charging the ingest quota.
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

  if (error) throw new Error(`Listing lookup failed: ${error.message}`);
  if (!data?.variant_id) return null;

  const product = data.product_variants?.products;
  if (!product?.slug) return null;
  return productUrl(product.categories?.slug ?? null, product.slug, data.variant_id);
}

/**
 * Fetch details from Shopee and write everything to the catalog via the
 * ingest_shopee_item RPC — one transaction: a mid-way failure never leaves a
 * listing without an offer or an offer without observations. Two concurrent requests
 * for the same item are serialized by the RPC; the later one gets 'resolved'.
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
    if (!(err instanceof ShopeeUnavailableError)) console.error("Shopee call failed:", err);
    return { status: "error", code: "upstream_unavailable" };
  }
  if (!detail.title || detail.models.length === 0) {
    return { status: "error", code: "upstream_unavailable" };
  }

  const supabase = createAdminClient();

  // Matcher v0 (1.9). The paste-a-URL entry point must not break because of it: on failure the
  // item is ingested unmatched, as a draft product.
  let candidates: MatchCandidate[] = [];
  try {
    candidates = await loadMatchCandidates(supabase, detail.title);
  } catch (err) {
    console.error("Matcher candidates failed, ingesting unmatched:", err);
  }

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
        match: toRpcMatch(bestMatch({ title: detail.title, modelName: m.name }, candidates)),
      })),
    },
  });

  if (error || !data) {
    console.error("ingest_shopee_item error:", error?.message);
    return { status: "error", code: "internal" };
  }

  // Images + vouchers after the price is in, then the listing's effective price — always, even
  // without vouchers in the detail: the price just changed, and marketplace/shop vouchers already
  // stored may apply differently to it. A failure here must not fail the lookup.
  try {
    const { data: listing, error: lErr } = await supabase
      .from("listings")
      .select("id")
      .eq("marketplace", "shopee")
      .eq("external_item_id", externalItemId(shopId, itemId))
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (listing) {
      // Ends with refreshEffectivePrices() for this listing (saveListingExtras).
      await saveListingExtras(supabase, listing.id, { images: detail.images, vouchers: detail.vouchers, source: detail.source });
    }
  } catch (err) {
    console.error("saveListingExtras after ingest failed:", err);
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
