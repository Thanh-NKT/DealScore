import { describe, expect, it } from "vitest";
import { expectedFieldWarnings, missingEnv, probeTarget, redact } from "@/lib/marketplaces/probe";

describe("probe helpers", () => {
  it("missingEnv lists what each marketplace needs", () => {
    expect(missingEnv("shopee", {})).toEqual(["SHOPEE_AFFILIATE_APP_ID", "SHOPEE_AFFILIATE_SECRET"]);
    expect(missingEnv("tiktok", { TIKTOK_SHOP_APP_KEY: "k" })).toEqual(["TIKTOK_SHOP_APP_SECRET"]);
  });

  it("probeTarget: URL or id → item; anything else → keyword search", () => {
    expect(probeTarget("shopee", "https://shopee.vn/product/1/2")).toEqual({ kind: "item", externalItemId: "1_2" });
    expect(probeTarget("shopee", "1_2")).toEqual({ kind: "item", externalItemId: "1_2" });
    expect(probeTarget("tiktok", "1729384756")).toEqual({ kind: "item", externalItemId: "1729384756" });
    expect(probeTarget("tiktok", "tai nghe")).toEqual({ kind: "search", value: "tai nghe" });
  });

  it("redact hides every secret", () => {
    expect(redact('{"t":"abc123","x":"abc123"}', ["abc123", ""])).toBe('{"t":"***","x":"***"}');
  });

  it("warns about fields the normalizer could not fill", () => {
    const w = expectedFieldWarnings({
      marketplace: "shopee", externalItemId: "1_2", url: "u", title: "t",
      seller: { externalId: "1", name: null, rating: null, ratingCount: null, isOfficial: false },
      models: [{ modelId: "default", name: "", price: null, originalPrice: null, stock: null, isFlashSale: false }],
      images: [], vouchers: [], source: "api",
    });
    expect(w).toEqual(expect.arrayContaining(["price", "seller.name", "images"]));
  });
});
