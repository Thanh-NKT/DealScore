/**
 * Client bọc Shopee Open API.
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
}

export async function getItemDetail(
  shopId: string,
  itemId: string,
): Promise<ShopeeItemDetail> {
  // Khi chưa có token thật từ Shopee Open API (Giai đoạn 0), cung cấp dữ liệu giả lập cho luồng ingest
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
  };
}
