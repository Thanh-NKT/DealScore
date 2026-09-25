import { describe, expect, it } from "vitest";
// Classic content script with a CommonJS export for tests.
import shopee from "../../extension/src/parse-shopee.js";

describe("itemIdFromUrl", () => {
  it.each([
    ["https://shopee.vn/product/111/222", "111_222"],
    ["https://shopee.vn/Ssd-Samsung-990-Pro-i.111.222?sp_atk=x", "111_222"],
    ["https://shopee.vn/search?keyword=ssd", null],
    ["https://shopee.vn.evil.com/product/1/2", null],
    ["not a url", null],
  ])("%s → %s", (url, id) => {
    expect(shopee.itemIdFromUrl(url)).toBe(id);
  });
});

describe("parsePrice", () => {
  it("reads the price and the list price next to its -NN% badge", () => {
    expect(shopee.parsePrice("SSD Samsung\n₫2.390.000 ₫2.990.000 -20% giảm")).toEqual({ price: 2_390_000, originalPrice: 2_990_000 });
  });
  it("a second price without a discount badge is not a list price", () => {
    expect(shopee.parsePrice("₫2.390.000\nMua kèm ₫99.000")).toEqual({ price: 2_390_000, originalPrice: null });
  });
  it("a price range (no variation chosen) is not a price", () => {
    expect(shopee.parsePrice("₫1.990.000 - ₫2.390.000")).toBeNull();
  });
  it("no price → null", () => {
    expect(shopee.parsePrice("Sản phẩm không tồn tại")).toBeNull();
  });
});

describe("readProductPage", () => {
  const text = "Ổ cứng SSD\n₫2.390.000 ₫2.990.000 -20%\nMiễn phí vận chuyển\n1.234 sản phẩm có sẵn";

  it("builds the observation Kairo accepts, with the chosen variation as model name", () => {
    expect(shopee.readProductPage({ href: "https://shopee.vn/x-i.1.2", text, selectedOptions: [" 2TB ", "Đen"] })).toEqual({
      item: "1_2",
      modelName: "2TB, Đen",
      observation: {
        marketplace: "shopee",
        item: "1_2",
        models: [{ modelId: null, name: "2TB, Đen", price: 2_390_000, originalPrice: 2_990_000, stock: 1234 }],
        freeShipping: true,
        hasVoucher: null,
      },
    });
  });

  it("still identifies the product when the price can't be read (no observation sent)", () => {
    expect(shopee.readProductPage({ href: "https://shopee.vn/product/1/2", text: "₫1 - ₫2", selectedOptions: [] })).toEqual({
      item: "1_2",
      modelName: null,
      observation: null,
    });
  });

  it("returns null off product pages", () => {
    expect(shopee.readProductPage({ href: "https://shopee.vn/cart", text, selectedOptions: [] })).toBeNull();
  });
});
