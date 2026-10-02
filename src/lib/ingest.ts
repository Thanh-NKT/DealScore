import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { slugify } from "@/lib/slug";
import { bestMatch, type MatchCandidate, type MatchResult } from "@/lib/matching/match";
import { loadBrandVocabulary, loadMatchCandidates } from "@/lib/matching/candidates";
import { draftKey, KNOWN_BRANDS } from "@/lib/matching/draft-key";
import { saveListingExtras } from "@/lib/listing-extras";
import { getSource } from "@/lib/marketplaces/sources";
import {
  MarketplaceItemNotFoundError,
  MarketplaceUnavailableError,
  type MarketplaceId,
  type MarketplaceItem,
} from "@/lib/marketplaces/types";

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
 * Read-only, never calls a marketplace — used to decide whether this request needs an ingest
 * before charging the ingest quota.
 */
export async function findExistingProductUrl(params: {
  marketplace: MarketplaceId;
  externalItemId: string;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("offers")
    .select(`
      variant_id,
      listings!inner ( marketplace, external_item_id ),
      product_variants!inner ( products!inner ( slug, categories ( slug ) ) )
    `)
    .eq("listings.marketplace", params.marketplace)
    .eq("listings.external_item_id", params.externalItemId)
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
 * Write one marketplace item to the catalog via the ingest_listing RPC — one transaction: a mid-way
 * failure never leaves a listing without an offer or an offer without observations. Two concurrent
 * requests for the same item are serialized by the RPC; the later one gets 'resolved'.
 * refreshPriority: 1 for pasted links (default), 3 for sourcing.
 */
export async function ingestItem(
  item: MarketplaceItem,
  opts: { refreshPriority?: 1 | 2 | 3 } = {},
  supabase: SupabaseClient<Database> = createAdminClient(),
): Promise<IngestResult> {
  if (!item.title || item.models.length === 0 || item.models.every((m) => m.price == null)) {
    return { status: "error", code: "upstream_unavailable" };
  }

  // Matcher v0 (1.9) + draft clustering key. Ingest must not break because of either: on failure the item is ingested
  // unmatched, as its own draft.
  let candidates: MatchCandidate[] = [];
  let key: string | null = null;
  try {
    const brands = await loadBrandVocabulary(supabase);
    candidates = await loadMatchCandidates(supabase, item.title, brands);
    key = draftKey({ title: item.title, brands: [...brands, ...KNOWN_BRANDS] });
  } catch (err) {
    console.error("Matcher candidates failed, ingesting unmatched:", err);
  }

  const { data, error } = await supabase.rpc("ingest_listing", {
    p: {
      marketplace: item.marketplace,
      ext_item_id: item.externalItemId,
      url: item.url,
      title: item.title,
      slug_base: slugify(item.title, 80),
      source: item.source,
      refresh_priority: opts.refreshPriority ?? 1,
      draft_key: key,
      seller: {
        external_id: item.seller.externalId,
        name: item.seller.name,
        rating: item.seller.rating,
        rating_count: item.seller.ratingCount,
        is_official: item.seller.isOfficial,
      },
      models: item.models.map((m) => ({
        model_id: m.modelId,
        name: m.name,
        price: m.price,
        original_price: m.originalPrice,
        stock: m.stock,
        is_flash_sale: m.isFlashSale,
        match: toRpcMatch(bestMatch({ title: item.title, modelName: m.name }, candidates)),
      })),
    },
  });

  if (error || !data) {
    console.error("ingest_listing error:", error?.message);
    return { status: "error", code: "internal" };
  }

  // Images + vouchers after the price is in, then the listing's effective price — always, even
  // without vouchers in the item: the price just changed, and marketplace/shop vouchers already
  // stored may apply differently to it. A failure here must not fail the ingest.
  try {
    const { data: listing, error: lErr } = await supabase
      .from("listings")
      .select("id")
      .eq("marketplace", item.marketplace)
      .eq("external_item_id", item.externalItemId)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (listing) {
      // Ends with refreshEffectivePrices() for this listing (saveListingExtras).
      await saveListingExtras(supabase, listing.id, { images: item.images, vouchers: item.vouchers, source: item.source });
    }
  } catch (err) {
    console.error("saveListingExtras after ingest failed:", err);
  }

  const r = data as { status: "resolved" | "ingested"; product_slug: string; category_slug: string | null; variant_id: string | null };
  return { status: r.status, productUrl: productUrl(r.category_slug, r.product_slug, r.variant_id) };
}

/** Fetch one item from its marketplace source, then ingestItem() it (paste-a-link path). */
export async function ingestProduct(marketplace: MarketplaceId, externalItemId: string): Promise<IngestResult> {
  const source = getSource(marketplace);
  if (!source) return { status: "error", code: "upstream_unavailable" };
  let item: MarketplaceItem;
  try {
    item = await source.fetchItem(externalItemId);
  } catch (err) {
    if (!(err instanceof MarketplaceUnavailableError || err instanceof MarketplaceItemNotFoundError)) {
      console.error(`${marketplace} call failed:`, err);
    }
    return { status: "error", code: "upstream_unavailable" };
  }
  return ingestItem(item);
}
