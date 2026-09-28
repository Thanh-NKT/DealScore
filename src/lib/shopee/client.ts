/**
 * Client wrapping the Shopee Open API.
 *
 * No real token yet (Phase 0 spike), so there are no HTTP calls yet.
 * Fake data is ONLY enabled when SHOPEE_CLIENT=fake and not in production:
 * fake prices written to the catalog as real ones would destroy the very thing that makes users
 * trust this product.
 */

export interface ShopeeItemDetail {
  shopId: string;
  itemId: string;
  title: string;
  sellerName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | null;
  sellerIsOfficial: boolean;
  models: Array<{
    modelId: string;
    name: string; // e.g. "2TB, Đen"
    price: number | null;
    originalPrice: number | null;
    stock: number | null;
    isFlashSale: boolean;
  }>;
  /** Gallery image URLs as returned (unsanitized — saveListingExtras() filters them). Default []. */
  images?: string[];
  /**
   * Vouchers shown for the item, raw (normalizeVoucher() validates them). Shape is an assumption
   * like G1–G6 until the API spike: { kind, discountType, discountValue, maxDiscount?, minSpend?,
   * code?, startsAt?, expiresAt?, listingOnly? }. Default [].
   */
  vouchers?: unknown[];
  /** 'seed' = fake data, written to price_observations.source so it never mixes with real prices. */
  source: "api" | "seed";
}

/** Could not get data from Shopee — the route returns `upstream_unavailable`. */
export class ShopeeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopeeUnavailableError";
  }
}

/** The item no longer exists on Shopee (deleted / banned) — the collector marks the listing inactive. */
export class ShopeeItemGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopeeItemGoneError";
  }
}

export function isFakeClientEnabled(): boolean {
  return process.env.SHOPEE_CLIENT === "fake" && process.env.NODE_ENV !== "production";
}

/**
 * Whether getItemDetail() can return data at all. False until the Open API is wired (Phase 0
 * spike): the collector then skips instead of logging a failed run every hour.
 */
export function isShopeeConfigured(): boolean {
  return isFakeClientEnabled();
}

export async function getItemDetail(
  shopId: string,
  itemId: string,
): Promise<ShopeeItemDetail> {
  if (isFakeClientEnabled()) {
    return fakeItemDetail(shopId, itemId);
  }
  throw new ShopeeUnavailableError("Shopee Open API is not configured");
}

function fakeItemDetail(shopId: string, itemId: string): ShopeeItemDetail {
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return {
    shopId,
    itemId,
    title: `Sản phẩm Shopee [Shop: ${shopId}, Item: ${itemId}]`,
    sellerName: "Shopee Seller",
    sellerRating: 4.8,
    sellerRatingCount: 120,
    sellerIsOfficial: false,
    models: [
      {
        modelId: `${itemId}_default`,
        name: "Tiêu chuẩn",
        price: 500000,
        originalPrice: 650000,
        stock: 50,
        isFlashSale: false,
      },
    ],
    // CDN-shaped URLs so they pass the image allow-list; they do not resolve (dev only).
    images: [
      `https://down-vn.img.susercontent.com/file/vn-kairo-fake-${itemId}-1`,
      `https://down-vn.img.susercontent.com/file/vn-kairo-fake-${itemId}-2`,
    ],
    // No codes: Shopee usually shows none, and a made-up code must never look real.
    vouchers: [
      { kind: "shop", discountType: "amount", discountValue: 20_000, minSpend: 300_000, expiresAt: inAWeek },
      { kind: "platform", discountType: "percent", discountValue: 8, maxDiscount: 50_000, minSpend: 0, expiresAt: inAWeek },
    ],
    source: "seed",
  };
}
