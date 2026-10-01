import { fakeHash } from "@/lib/shopee/fake-source";
import type { MarketplaceItem, SearchPage, SearchQuery } from "@/lib/marketplaces/types";

/** Dev-only fake TikTok Shop data (TIKTOK_CLIENT=fake). */
export function fakeTikTokItem(id: string): MarketplaceItem {
  return {
    marketplace: "tiktok",
    externalItemId: id,
    url: `https://www.tiktok.com/view/product/${id}`,
    title: `Sản phẩm TikTok Shop [${id}]`,
    seller: { externalId: "fake-tt-shop", name: "TikTok Demo Store", rating: 4.7, ratingCount: null, isOfficial: false },
    models: [{ modelId: "default", name: "", price: 480000, originalPrice: null, stock: null, isFlashSale: false }],
    images: [],
    vouchers: [],
    source: "seed",
  };
}

export function fakeTikTokSearch(q: SearchQuery): SearchPage {
  const page = Number(q.cursor ?? "1");
  const base = fakeHash(`${q.kind}:${q.value}`);
  const items = Array.from({ length: q.limit }, (_, i) => fakeTikTokItem(`17${base}${page}${i}`));
  return { items, nextCursor: page < 2 ? String(page + 1) : null };
}
