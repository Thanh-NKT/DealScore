import "server-only";
import { callShopeeAffiliate, shopeeAffiliateCredentials, ShopeeAffiliateError } from "@/lib/shopee/affiliate-http";
import { normalizeShopeeOffer, OFFER_NODE_FIELDS, type ShopeeOfferNode } from "@/lib/shopee/normalize-offer";
import {
  MarketplaceItemNotFoundError,
  MarketplaceUnavailableError,
  type Env,
  type MarketplaceItem,
  type SearchPage,
  type SearchQuery,
} from "@/lib/marketplaces/types";

/** S3 — conservative page size even if the API allows more. */
export const SHOPEE_SEARCH_LIMIT = 50;
/** S1 — sortType 2 = best selling. */
const SORT_BEST_SELLING = 2;

// S1 — revise after `pnpm marketplace:probe shopee …`.
export const PRODUCT_OFFER_QUERY = `query ($shopId: Int64, $itemId: Int64, $keyword: String, $productCatId: Int, $sortType: Int, $page: Int, $limit: Int) {
  productOfferV2(shopId: $shopId, itemId: $itemId, keyword: $keyword, productCatId: $productCatId, sortType: $sortType, page: $page, limit: $limit) {
    nodes { ${OFFER_NODE_FIELDS} }
    pageInfo { page limit hasNextPage }
  }
}`;

type OfferResponse = { productOfferV2: { nodes?: ShopeeOfferNode[]; pageInfo?: { hasNextPage?: boolean } } };

async function query(variables: Record<string, unknown>, env: Env): Promise<OfferResponse["productOfferV2"]> {
  const creds = shopeeAffiliateCredentials(env);
  if (!creds) throw new MarketplaceUnavailableError("Shopee Affiliate API is not configured", { marketplace: "shopee" });
  try {
    return (await callShopeeAffiliate<OfferResponse>(creds, PRODUCT_OFFER_QUERY, variables)).productOfferV2;
  } catch (err) {
    if (err instanceof ShopeeAffiliateError && err.retryable) {
      throw new MarketplaceUnavailableError(err.message, { cause: err, marketplace: "shopee" });
    }
    throw err;
  }
}

export async function fetchShopeeItem(ext: string, env: Env = process.env): Promise<MarketplaceItem> {
  const m = /^(\d+)_(\d+)$/.exec(ext);
  if (!m) throw new Error(`Invalid Shopee external id: ${ext}`);
  const result = await query({ shopId: Number(m[1]), itemId: Number(m[2]), limit: 1 }, env);
  for (const node of result.nodes ?? []) {
    const item = normalizeShopeeOffer(node);
    if (item && item.externalItemId === ext) return item;
  }
  throw new MarketplaceItemNotFoundError(`Shopee item ${ext} not found in the affiliate catalog`);
}

export async function searchShopeeItems(q: SearchQuery, env: Env = process.env): Promise<SearchPage> {
  const page = Math.max(1, Number(q.cursor ?? "1") || 1);
  const filter = q.kind === "keyword" ? { keyword: q.value } : { productCatId: Number(q.value) };
  const result = await query(
    { ...filter, sortType: SORT_BEST_SELLING, page, limit: Math.min(q.limit, SHOPEE_SEARCH_LIMIT) },
    env,
  );
  const items = (result.nodes ?? []).map(normalizeShopeeOffer).filter((i): i is MarketplaceItem => i != null);
  return { items, nextCursor: result.pageInfo?.hasNextPage ? String(page + 1) : null };
}
