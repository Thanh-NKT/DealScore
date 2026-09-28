import { describe, expect, it } from "vitest";
import { isAllowedExtensionOrigin, validateObservationPayload } from "@/lib/extension/payload";

const NOW = new Date("2026-09-25T12:00:00Z");
const ok = { marketplace: "shopee", item: "123_456", models: [{ name: " 2TB ", price: 2_390_000, originalPrice: 2_990_000, stock: 12 }] };

describe("validateObservationPayload", () => {
  it("accepts a well-formed payload and trims the model name", () => {
    const r = validateObservationPayload({ ...ok, freeShipping: true }, NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        marketplace: "shopee",
        item: "123_456",
        observedAt: NOW.toISOString(),
        models: [{ modelId: null, name: "2TB", price: 2_390_000, originalPrice: 2_990_000, stock: 12 }],
        freeShipping: true,
        hasVoucher: null,
        vouchers: [],
        images: [],
      },
    });
  });

  it.each([
    ["not an object", "x"],
    ["other marketplace", { ...ok, marketplace: "lazada" }],
    ["bad item id", { ...ok, item: "../../x" }],
    ["no models", { ...ok, models: [] }],
    ["zero price", { ...ok, models: [{ price: 0 }] }],
    ["string price", { ...ok, models: [{ price: "1000" }] }],
    ["absurd price", { ...ok, models: [{ price: 1e12 }] }],
  ])("rejects %s", (_label, body) => {
    expect(validateObservationPayload(body, NOW).ok).toBe(false);
  });

  it("drops a list price that is not above the price, and bad stock", () => {
    const r = validateObservationPayload({ ...ok, models: [{ price: 100, originalPrice: 90, stock: -3 }] }, NOW);
    expect(r.ok && r.value.models[0]).toMatchObject({ originalPrice: null, stock: null });
  });

  it("uses the server clock when the client timestamp is more than 10 minutes off", () => {
    const skewed = validateObservationPayload({ ...ok, observedAt: "2020-01-01T00:00:00Z" }, NOW);
    expect(skewed.ok && skewed.value.observedAt).toBe(NOW.toISOString());
    const fine = validateObservationPayload({ ...ok, observedAt: "2026-09-25T11:55:00Z" }, NOW);
    expect(fine.ok && fine.value.observedAt).toBe("2026-09-25T11:55:00.000Z");
  });
});

describe("validateObservationPayload — vouchers and images", () => {
  const cdn = "https://down-vn.img.susercontent.com/file/vn-11134207-abc";

  it("keeps valid voucher labels, strips codes and drops invalid ones", () => {
    const r = validateObservationPayload(
      {
        ...ok,
        vouchers: [
          { kind: "shop", discountType: "amount", discountValue: 50_000, minSpend: 1_000_000, code: "SHOPX50" },
          { kind: "shop", discountType: "percent", discountValue: 8, maxDiscount: 150_000 },
          { kind: "shop", discountType: "percent", discountValue: 250 },
          { kind: "bogus", discountType: "amount", discountValue: 1 },
          "not an object",
        ],
      },
      NOW,
    );
    expect(r.ok && r.value.vouchers).toEqual([
      { kind: "shop", discountType: "amount", discountValue: 50_000, maxDiscount: null, minSpend: 1_000_000, expiresAt: null },
      { kind: "shop", discountType: "percent", discountValue: 8, maxDiscount: 150_000, minSpend: 0, expiresAt: null },
    ]);
  });

  it("keeps only https images on the Shopee CDN", () => {
    const r = validateObservationPayload(
      {
        ...ok,
        images: [cdn, cdn, "http://cf.shopee.vn/file/x", "https://evil.com/x.jpg", "https://susercontent.com.evil.com/x", "javascript:alert(1)", 42],
      },
      NOW,
    );
    expect(r.ok && r.value.images).toEqual([cdn]);
  });

  it.each([
    ["vouchers not an array", { ...ok, vouchers: "x" }],
    ["more than 20 vouchers", { ...ok, vouchers: Array.from({ length: 21 }, () => ({})) }],
    ["images not an array", { ...ok, images: {} }],
    ["more than 12 images", { ...ok, images: Array.from({ length: 13 }, (_, i) => `${cdn}${i}`) }],
  ])("rejects %s", (_label, body) => {
    expect(validateObservationPayload(body, NOW).ok).toBe(false);
  });
});

describe("isAllowedExtensionOrigin", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";
  it("allows listed extension ids only", () => {
    expect(isAllowedExtensionOrigin(`chrome-extension://${id}`, { ids: id, production: true })).toBe(true);
    expect(isAllowedExtensionOrigin(`chrome-extension://${"b".repeat(32)}`, { ids: id, production: true })).toBe(false);
  });
  it("rejects web origins and missing origins", () => {
    expect(isAllowedExtensionOrigin("https://evil.com", { ids: id, production: false })).toBe(false);
    expect(isAllowedExtensionOrigin(null, { ids: id, production: false })).toBe(false);
  });
  it("without a list: any unpacked extension in dev, none in production", () => {
    expect(isAllowedExtensionOrigin(`chrome-extension://${id}`, { production: false })).toBe(true);
    expect(isAllowedExtensionOrigin(`chrome-extension://${id}`, { production: true })).toBe(false);
  });
});
