import { describe, expect, it } from "vitest";
import { normalizeTikTokProduct } from "@/lib/tiktok/normalize-product";

const product = {
  id: "1729384756",
  title: "Tai nghe Sony WH-1000XM5",
  main_image_url: "https://p16-oec-va.ibyteimg.com/x.jpg",
  sale_price: { minimum_amount: "6.490.000", maximum_amount: "6.990.000", currency: "VND" },
  original_price: { minimum_amount: "8490000", currency: "VND" },
  shop: { id: "7495", name: "Sony Official" },
};

describe("normalizeTikTokProduct (T4)", () => {
  it("maps a product with a price range to one model at the minimum", () => {
    expect(normalizeTikTokProduct(product)).toEqual({
      marketplace: "tiktok",
      externalItemId: "1729384756",
      url: "https://www.tiktok.com/view/product/1729384756",
      title: "Tai nghe Sony WH-1000XM5",
      seller: { externalId: "7495", name: "Sony Official", rating: null, ratingCount: null, isOfficial: false },
      models: [{ modelId: "default", name: "", price: 6_490_000, originalPrice: 8_490_000, stock: null, isFlashSale: false }],
      images: ["https://p16-oec-va.ibyteimg.com/x.jpg"],
      vouchers: [],
      source: "api",
    });
  });

  it("accepts price.{amount,currency} and string prices", () => {
    const item = normalizeTikTokProduct({ ...product, sale_price: undefined, price: { amount: "1299000.00", currency: "VND" } });
    expect(item!.models[0].price).toBe(1_299_000);
    const plain = normalizeTikTokProduct({ ...product, sale_price: "990000" });
    expect(plain!.models[0].price).toBe(990_000);
  });

  it("non-VND currency, missing id/title/shop → null", () => {
    expect(normalizeTikTokProduct({ ...product, sale_price: { minimum_amount: "10", currency: "USD" } })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, id: "" })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, title: undefined })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, shop: undefined })).toBeNull();
    expect(normalizeTikTokProduct(null)).toBeNull();
  });
});
