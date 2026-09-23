/**
 * Client bọc Shopee Open API.
 *
 * Chưa có token thật (spike Giai đoạn 0), nên chưa có lời gọi HTTP nào.
 * Dữ liệu giả lập CHỈ bật khi SHOPEE_CLIENT=fake và không phải production:
 * giá giả ghi vào catalog như giá thật là phá hỏng đúng thứ khiến người dùng
 * tin sản phẩm này.
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
    name: string; // vd "2TB, Đen"
    price: number | null;
    originalPrice: number | null;
    stock: number | null;
    isFlashSale: boolean;
  }>;
  /** 'seed' = dữ liệu giả lập, ghi vào price_observations.source để không lẫn với giá thật. */
  source: "api" | "seed";
}

/** Không lấy được dữ liệu từ Shopee — route trả `upstream_unavailable`. */
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
  throw new ShopeeUnavailableError("Chưa cấu hình Shopee Open API");
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
