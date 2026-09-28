import { describe, expect, it } from "vitest";
// Classic content script with a CommonJS export for tests.
import shopee from "../../../extension/src/parse-shopee.js";

describe("parseAmount", () => {
  it.each([
    ["50k", 50_000],
    ["1tr", 1_000_000],
    ["1,5tr", 1_500_000],
    ["2 triệu", 2_000_000],
    ["50.000", 50_000],
    ["abc", null],
    ["", null],
  ])("%s → %s", (raw, value) => {
    expect(shopee.parseAmount(raw)).toBe(value);
  });
});

describe("parseVouchers", () => {
  it("reads amount, percent + cap and min-spend labels of the shop voucher block", () => {
    const text = [
      "₫2.390.000",
      "Mã Giảm Giá Của Shop",
      "Giảm ₫50k",
      "Đơn tối thiểu ₫1tr",
      "Giảm 8% Giảm tối đa ₫150k",
      "Giảm ₫20.000 Đơn tối thiểu ₫300.000",
    ].join("\n");
    expect(shopee.parseVouchers(text)).toEqual([
      { kind: "shop", discountType: "amount", discountValue: 50_000, maxDiscount: null, minSpend: 1_000_000 },
      { kind: "shop", discountType: "percent", discountValue: 8, maxDiscount: 150_000, minSpend: 0 },
      { kind: "shop", discountType: "amount", discountValue: 20_000, maxDiscount: null, minSpend: 300_000 },
    ]);
  });

  it("no shop voucher block → [] (a price discount elsewhere is not a voucher)", () => {
    expect(shopee.parseVouchers("₫2.390.000 ₫2.990.000 -20%\nGiảm ₫600k so với giá gốc")).toEqual([]);
  });

  it("never returns a code and drops impossible percentages", () => {
    const out = shopee.parseVouchers("Voucher của shop\nGiảm 150%\nGiảm 5%\nMã: SHOPX50");
    expect(out).toEqual([{ kind: "shop", discountType: "percent", discountValue: 5, maxDiscount: null, minSpend: 0 }]);
    expect(out.every((v: Record<string, unknown>) => !("code" in v))).toBe(true);
  });
});

describe("pickGalleryImages", () => {
  it("keeps Shopee CDN images, full size, deduplicated, at most 12", () => {
    const cdn = "https://down-vn.img.susercontent.com/file/vn-abc";
    expect(
      shopee.pickGalleryImages([`${cdn}_tn`, cdn, "https://evil.com/a.jpg", "http://cf.shopee.vn/x", 7, "https://cf.shopee.vn/file/y"]),
    ).toEqual([cdn, "https://cf.shopee.vn/file/y"]);
    const many = Array.from({ length: 20 }, (_, i) => `${cdn}${i}`);
    expect(shopee.pickGalleryImages(many)).toHaveLength(12);
  });
});

type Page = { observation: Record<string, unknown> };

describe("readProductPage with vouchers and images", () => {
  it("adds vouchers and images to the observation only when the page has them", () => {
    const text = "₫2.390.000\nMã giảm giá của Shop\nGiảm ₫50k";
    const r = shopee.readProductPage({
      href: "https://shopee.vn/product/1/2",
      text,
      selectedOptions: [],
      imageUrls: ["https://down-vn.img.susercontent.com/file/vn-1"],
    }) as unknown as Page;
    expect(r.observation.vouchers).toEqual([
      { kind: "shop", discountType: "amount", discountValue: 50_000, maxDiscount: null, minSpend: 0 },
    ]);
    expect(r.observation.images).toEqual(["https://down-vn.img.susercontent.com/file/vn-1"]);

    const plain = shopee.readProductPage({ href: "https://shopee.vn/product/1/2", text: "₫2.390.000", selectedOptions: [] }) as unknown as Page;
    expect(plain.observation).not.toHaveProperty("vouchers");
    expect(plain.observation).not.toHaveProperty("images");
  });
});
