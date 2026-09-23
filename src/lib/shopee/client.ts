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

export function isFakeClientEnabled(): boolean {
  return process.env.SHOPEE_CLIENT === "fake" && process.env.NODE_ENV !== "production";
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
    source: "seed",
  };
}
