import { normalizeTikTokProduct } from "@/lib/tiktok/normalize-product";
import type { TikTokCaller } from "@/lib/tiktok/api";
import {
  MarketplaceItemNotFoundError,
  type MarketplaceItem,
  type SearchPage,
  type SearchQuery,
} from "@/lib/marketplaces/types";

/** Creator-side open collaboration product search (Affiliate Creator API 202405). */
export const TIKTOK_SEARCH_PATH = "/affiliate_creator/202405/open_collaboration/products/search";
export const TIKTOK_PAGE_SIZE = 20;

type SearchResponse = { products?: unknown[]; next_page_token?: string };

function toItems(products: unknown[] | undefined): MarketplaceItem[] {
  return (products ?? []).map(normalizeTikTokProduct).filter((i): i is MarketplaceItem => i != null);
}

export async function searchTikTokItems(q: SearchQuery, call: TikTokCaller): Promise<SearchPage> {
  const query: Record<string, string> = { page_size: String(Math.min(q.limit, TIKTOK_PAGE_SIZE)) };
  if (q.cursor) query.page_token = q.cursor;
  // T4 — body field names; revise after `pnpm marketplace:probe tiktok "<keyword>"`.
  const body = q.kind === "keyword" ? { title_keywords: [q.value] } : { category: { id: q.value } };
  const data = await call<SearchResponse>(TIKTOK_SEARCH_PATH, { query, body });
  return { items: toItems(data?.products), nextCursor: data?.next_page_token || null };
}

/** T1 — no documented get-by-id for creators: search filtered by id, keep only the exact match. */
export async function fetchTikTokItem(id: string, call: TikTokCaller): Promise<MarketplaceItem> {
  const data = await call<SearchResponse>(TIKTOK_SEARCH_PATH, {
    query: { page_size: String(TIKTOK_PAGE_SIZE) },
    body: { product_ids: [id] },
  });
  const item = toItems(data?.products).find((i) => i.externalItemId === id);
  if (!item) throw new MarketplaceItemNotFoundError(`TikTok product ${id} not found in open collaborations`);
  return item;
}
