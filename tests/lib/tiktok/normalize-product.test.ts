import { describe, expect, it } from "vitest";
import { normalizeTikTokProduct } from "@/lib/tiktok/normalize-product";

// Documented open collaboration product (Search Open Collaboration Products 202405 / by-ids 202509).
const product = {
  id: "1729384756",
  title: "Tai nghe Sony WH-1000XM5",
  main_image_url: "https://p16-oec-va.ibyteimg.com/x.jpg",
  detail_link: "https://shop.tiktok.com/view/product/1729384756",
  has_inventory: true,
  units_sold: 120,
  sale_region: "VN",
  sales_price: { minimum_amount: "6.490.000", maximum_amount: "6.990.000", currency: "VND" },
  original_price: { minimum_amount: "8490000", maximum_amount: "8990000", currency: "VND" },
  commission: { rate: 1000, amount: "649000", currency: "VND" },
  shop: { name: "Sony Official" },
};

describe("normalizeTikTokProduct (T4)", () => {
  it("maps a documented product with a price range to one model at the minimum", () => {
    expect(normalizeTikTokProduct(product)).toEqual({
      marketplace: "tiktok",
      externalItemId: "1729384756",
      url: "https://www.tiktok.com/view/product/1729384756",
      title: "Tai nghe Sony WH-1000XM5",
      seller: { externalId: "name:Sony Official", name: "Sony Official", rating: null, ratingCount: null, isOfficial: false },
      models: [{ modelId: "default", name: "", price: 6_490_000, originalPrice: 8_490_000, stock: null, isFlashSale: false, priceIsRange: true }],
      images: ["https://p16-oec-va.ibyteimg.com/x.jpg"],
      vouchers: [],
      source: "api",
    });
  });

  it("a shop id, when present, wins over the name-based seller id", () => {
    expect(normalizeTikTokProduct({ ...product, shop: { id: "7495", name: "Sony Official" } })!.seller.externalId).toBe("7495");
  });

  it("has_inventory false → stock 0", () => {
    expect(normalizeTikTokProduct({ ...product, has_inventory: false })!.models[0].stock).toBe(0);
  });

  it("a single sale price is not a range", () => {
    const one = normalizeTikTokProduct({ ...product, sales_price: { minimum_amount: "6490000", maximum_amount: "6490000", currency: "VND" } });
    expect(one!.models[0].priceIsRange).toBe(false);
    expect(normalizeTikTokProduct({ ...product, sales_price: "6490000" })!.models[0].priceIsRange).toBe(false);
  });

  it("still accepts the older sale_price / price.{amount,currency} shapes", () => {
    const legacy = normalizeTikTokProduct({ ...product, sales_price: undefined, sale_price: { minimum_amount: "990000", currency: "VND" } });
    expect(legacy!.models[0].price).toBe(990_000);
    const item = normalizeTikTokProduct({ ...product, sales_price: undefined, price: { amount: "1299000.00", currency: "VND" } });
    expect(item!.models[0].price).toBe(1_299_000);
  });

  it("non-VND currency, missing id/title/shop → null", () => {
    expect(normalizeTikTokProduct({ ...product, sales_price: { minimum_amount: "10", currency: "USD" } })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, id: "" })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, title: undefined })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, shop: undefined })).toBeNull();
    expect(normalizeTikTokProduct({ ...product, shop: { name: " " } })).toBeNull();
    expect(normalizeTikTokProduct(null)).toBeNull();
  });
});
