import { describe, expect, it } from "vitest";
import { normalizeShopeeOffer, toVndPrice } from "@/lib/shopee/normalize-offer";

const node = {
  itemId: 22334455,
  shopId: 778899,
  productName: "SSD Samsung 990 Pro 2TB",
  shopName: "Samsung Official",
  price: "3290000",
  priceMin: "3190000",
  priceMax: "3490000",
  priceDiscountRate: 20,
  imageUrl: "https://down-vn.img.susercontent.com/file/abc",
  ratingStar: "4.9",
};

describe("toVndPrice", () => {
  it.each([
    ["3190000", 3_190_000],
    ["3190000.00", 3_190_000],
    ["3.190.000", 3_190_000],
    [3190000, 3_190_000],
    ["0", null],
    ["", null],
    ["abc", null],
    [null, null],
    [-5, null],
  ])("%s → %s", (raw, want) => {
    expect(toVndPrice(raw)).toBe(want);
  });
});

describe("normalizeShopeeOffer", () => {
  it("maps a full node; priceMin wins over price", () => {
    expect(normalizeShopeeOffer(node)).toEqual({
      marketplace: "shopee",
      externalItemId: "778899_22334455",
      url: "https://shopee.vn/product/778899/22334455",
      title: "SSD Samsung 990 Pro 2TB",
      seller: { externalId: "778899", name: "Samsung Official", rating: 4.9, ratingCount: null, isOfficial: false },
      models: [{ modelId: "default", name: "", price: 3_190_000, originalPrice: 3_987_500, stock: null, isFlashSale: false }],
      images: ["https://down-vn.img.susercontent.com/file/abc"],
      vouchers: [],
      source: "api",
    });
  });

  it("falls back to price when priceMin is missing; no discount → originalPrice null", () => {
    const item = normalizeShopeeOffer({ ...node, priceMin: undefined, priceDiscountRate: 0 });
    expect(item!.models[0]).toMatchObject({ price: 3_290_000, originalPrice: null });
  });

  it("unparseable price → price null (stored as invalid observation, not dropped)", () => {
    expect(normalizeShopeeOffer({ ...node, priceMin: "", price: "" })!.models[0].price).toBeNull();
  });

  it("missing id or name → null", () => {
    expect(normalizeShopeeOffer({ ...node, itemId: undefined })).toBeNull();
    expect(normalizeShopeeOffer({ ...node, shopId: "" })).toBeNull();
    expect(normalizeShopeeOffer({ ...node, productName: "  " })).toBeNull();
  });

  it("no image → empty images; bad rating → null", () => {
    const item = normalizeShopeeOffer({ ...node, imageUrl: undefined, ratingStar: "n/a" });
    expect(item!.images).toEqual([]);
    expect(item!.seller.rating).toBeNull();
  });
});
