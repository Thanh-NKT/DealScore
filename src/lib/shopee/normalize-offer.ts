import { parseMoney } from "@/lib/affiliate/normalize";
import type { MarketplaceItem } from "@/lib/marketplaces/types";

/**
 * productOfferV2 node → MarketplaceItem (assumption S2). Pure. The Affiliate API gives one price range per
 * item, not per model, so every item becomes ONE model "default" priced at priceMin. When priceMax is
 * higher the item has variants at different prices: `priceIsRange` keeps the matcher from treating
 * priceMin as the price of the variant named in the title.
 */
export const OFFER_NODE_FIELDS =
  "itemId shopId productName shopName price priceMin priceMax priceDiscountRate imageUrl ratingStar sales productLink offerLink";

export type ShopeeOfferNode = Record<string, unknown>;

/** VND amount → positive integer, or null. */
export function toVndPrice(raw: unknown): number | null {
  const n = parseMoney(raw);
  return n != null && n > 0 ? Math.round(n) : null;
}

function idString(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function rating(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

export function normalizeShopeeOffer(node: ShopeeOfferNode): MarketplaceItem | null {
  const itemId = idString(node.itemId);
  const shopId = idString(node.shopId);
  const title = text(node.productName);
  if (!itemId || !shopId || !title) return null;

  const price = toVndPrice(node.priceMin) ?? toVndPrice(node.price);
  const priceMax = toVndPrice(node.priceMax);
  const priceIsRange = price != null && priceMax != null && priceMax > price;
  const rate = Number(node.priceDiscountRate);
  const originalPrice = price != null && rate > 0 && rate < 100 ? Math.round(price / (1 - rate / 100)) : null;
  const image = text(node.imageUrl);

  return {
    marketplace: "shopee",
    externalItemId: `${shopId}_${itemId}`,
    url: `https://shopee.vn/product/${shopId}/${itemId}`,
    title,
    seller: { externalId: shopId, name: text(node.shopName), rating: rating(node.ratingStar), ratingCount: null, isOfficial: false },
    models: [{ modelId: "default", name: "", price, originalPrice, stock: null, isFlashSale: false, priceIsRange }],
    images: image ? [image] : [],
    vouchers: [],
    source: "api",
  };
}
