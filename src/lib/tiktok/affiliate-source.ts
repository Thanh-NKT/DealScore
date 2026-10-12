import { normalizeTikTokProduct } from "@/lib/tiktok/normalize-product";
import type { TikTokCaller } from "@/lib/tiktok/api";
import {
  MarketplaceItemNotFoundError,
  type MarketplaceItem,
  type SearchPage,
  type SearchQuery,
} from "@/lib/marketplaces/types";

/** Creator-side open collaboration product search (Affiliate Creator API 202405). */
export const TIKTOK_SEARCH_PATH = "/affiliate_creator/202405/open_collaborations/products/search";
export const TIKTOK_PAGE_SIZE = 20;
/** T1 — open collaboration products by id (Affiliate Creator API 202509, GET, `product_ids` comma-separated). */
export const TIKTOK_PRODUCTS_BY_ID_PATH = "/affiliate_creator/202509/open_collaborations/products";
export const TIKTOK_IDS_PER_REQUEST = 50;

type ProductsResponse = { products?: unknown[]; next_page_token?: string };

function toItems(products: unknown[] | undefined): MarketplaceItem[] {
  return (products ?? []).map(normalizeTikTokProduct).filter((i): i is MarketplaceItem => i != null);
}

export async function searchTikTokItems(q: SearchQuery, call: TikTokCaller): Promise<SearchPage> {
  const query: Record<string, string> = { page_size: String(Math.min(q.limit, TIKTOK_PAGE_SIZE)) };
  if (q.cursor) query.page_token = q.cursor;
  // T4 — `category.id` must be a first-level category.
  const body = q.kind === "keyword" ? { title_keywords: [q.value] } : { category: { id: q.value } };
  const data = await call<ProductsResponse>(TIKTOK_SEARCH_PATH, { query, body });
  return { items: toItems(data?.products), nextCursor: data?.next_page_token || null };
}

/**
 * T1 — up to TIKTOK_IDS_PER_REQUEST ids per call. Products no longer in an open collaboration are simply
 * missing from the result (absent from the map, never "gone").
 */
export async function fetchTikTokItems(ids: string[], call: TikTokCaller): Promise<Map<string, MarketplaceItem>> {
  const found = new Map<string, MarketplaceItem>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += TIKTOK_IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + TIKTOK_IDS_PER_REQUEST);
    const data = await call<ProductsResponse>(TIKTOK_PRODUCTS_BY_ID_PATH, { query: { product_ids: chunk.join(",") } });
    for (const item of toItems(data?.products)) {
      if (chunk.includes(item.externalItemId)) found.set(item.externalItemId, item);
    }
  }
  return found;
}

export async function fetchTikTokItem(id: string, call: TikTokCaller): Promise<MarketplaceItem> {
  const item = (await fetchTikTokItems([id], call)).get(id);
  if (!item) throw new MarketplaceItemNotFoundError(`TikTok product ${id} not found in open collaborations`);
  return item;
}
