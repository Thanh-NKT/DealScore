import { describe, expect, it } from "vitest";
import { allTargetHosts, detectMarketplace, getAdapter, MARKETPLACES, parseProductUrl } from "@/lib/marketplaces";

describe("detectMarketplace", () => {
  it.each([
    ["https://shopee.vn/product/123/456", "shopee"],
    ["https://s.shopee.vn/abc", "shopee"],
    ["https://www.tiktok.com/view/product/1729384756", "tiktok"],
    ["https://vt.tiktok.com/ZSabc/", "tiktok"],
    ["https://www.lazada.vn/products/ssd-samsung-990-i2345678-s9876543.html", "lazada"],
    ["s.lazada.vn/s.abc", "lazada"],
  ])("%s → %s", (url, id) => {
    expect(detectMarketplace(url)?.adapter.id).toBe(id);
  });

  it("matches hosts exactly — lookalike domains are rejected", () => {
    expect(detectMarketplace("https://shopee.vn.evil.com/product/1/2")).toBeNull();
    expect(detectMarketplace("https://evil-lazada.vn/products/x-i1.html")).toBeNull();
    expect(detectMarketplace("https://tiktok.com.attacker.net/view/product/1")).toBeNull();
  });

  it("returns null for text that is not a URL", () => {
    expect(detectMarketplace("samsung ssd")).toBeNull();
  });
});

describe("parseProductUrl", () => {
  it("Shopee keeps the shop_item external id", () => {
    expect(parseProductUrl("https://shopee.vn/Ten-san-pham-i.111.222")).toEqual({
      ok: true,
      item: { marketplace: "shopee", externalItemId: "111_222", canonicalUrl: "https://shopee.vn/product/111/222" },
    });
  });

  it("TikTok Shop product id", () => {
    expect(parseProductUrl("https://shop.tiktok.com/view/product/1729384756?region=VN")).toEqual({
      ok: true,
      item: {
        marketplace: "tiktok",
        externalItemId: "1729384756",
        canonicalUrl: "https://www.tiktok.com/view/product/1729384756",
      },
    });
  });

  it("Lazada item id with or without the sku part", () => {
    for (const url of [
      "https://www.lazada.vn/products/ssd-samsung-990-i2345678-s9876543.html?spm=x",
      "https://www.lazada.vn/products/ssd-samsung-990-i2345678.html",
    ]) {
      const r = parseProductUrl(url);
      expect(r).toMatchObject({ ok: true, item: { marketplace: "lazada", externalItemId: "2345678" } });
    }
  });

  it("short links need a redirect; other paths are unrecognized", () => {
    expect(parseProductUrl("https://vt.tiktok.com/ZSabc/")).toEqual({ ok: false, reason: "needs_redirect" });
    expect(parseProductUrl("https://www.lazada.vn/catalog/?q=ssd")).toEqual({ ok: false, reason: "unrecognized_format" });
    expect(parseProductUrl("https://example.com/x")).toEqual({ ok: false, reason: "not_supported" });
  });
});

describe("registry", () => {
  it("lists the three marketplaces with Vietnamese-facing names", () => {
    expect(MARKETPLACES.map((m) => [m.id, m.name])).toEqual([
      ["shopee", "Shopee"],
      ["tiktok", "TikTok Shop"],
      ["lazada", "Lazada"],
    ]);
  });

  it("TikTok Shop and Lazada have no data source yet", () => {
    expect(getAdapter("tiktok")?.isConfigured()).toBe(false);
    expect(getAdapter("lazada")?.isConfigured()).toBe(false);
    expect(getAdapter("nope")).toBeNull();
  });

  it("redirect targets are the union of every adapter's hosts", () => {
    const hosts = allTargetHosts();
    for (const h of ["shopee.vn", "s.shopee.vn", "shope.ee", "www.tiktok.com", "www.lazada.vn", "s.lazada.vn"]) {
      expect(hosts.has(h)).toBe(true);
    }
    expect(hosts.has("evil.com")).toBe(false);
  });
});
