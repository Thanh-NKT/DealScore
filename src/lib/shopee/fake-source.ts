import type { MarketplaceItem, SearchPage, SearchQuery } from "@/lib/marketplaces/types";

/** Dev-only fake Shopee data (SHOPEE_CLIENT=fake). Same values the old client returned. */
export function fakeShopeeItem(ext: string): MarketplaceItem {
  const sep = ext.indexOf("_");
  const shopId = sep < 0 ? "" : ext.slice(0, sep);
  const itemId = sep < 0 ? ext : ext.slice(sep + 1);
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return {
    marketplace: "shopee",
    externalItemId: ext,
    url: `https://shopee.vn/product/${shopId}/${itemId}`,
    title: `Sản phẩm Shopee [Shop: ${shopId}, Item: ${itemId}]`,
    seller: { externalId: shopId, name: "Shopee Seller", rating: 4.8, ratingCount: 120, isOfficial: false },
    models: [{ modelId: `${itemId}_default`, name: "Tiêu chuẩn", price: 500000, originalPrice: 650000, stock: 50, isFlashSale: false }],
    // CDN-shaped URLs so they pass the image allow-list; they do not resolve (dev only).
    images: [
      `https://down-vn.img.susercontent.com/file/vn-dealscore-fake-${itemId}-1`,
      `https://down-vn.img.susercontent.com/file/vn-dealscore-fake-${itemId}-2`,
    ],
    // No codes: Shopee usually shows none, and a made-up code must never look real.
    vouchers: [
      { kind: "shop", discountType: "amount", discountValue: 20_000, minSpend: 300_000, expiresAt: inAWeek },
      { kind: "platform", discountType: "percent", discountValue: 8, maxDiscount: 50_000, minSpend: 0, expiresAt: inAWeek },
    ],
    source: "seed",
  };
}

/** Small stable hash so the same query always yields the same fake ids. */
export function fakeHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 1_000_000;
}

/** Two pages of fake results per query. */
export function fakeShopeeSearch(q: SearchQuery): SearchPage {
  const page = Number(q.cursor ?? "1");
  const base = fakeHash(`${q.kind}:${q.value}`);
  const items = Array.from({ length: q.limit }, (_, i) => fakeShopeeItem(`900000_${base}${page}${i}`));
  return { items, nextCursor: page < 2 ? String(page + 1) : null };
}
