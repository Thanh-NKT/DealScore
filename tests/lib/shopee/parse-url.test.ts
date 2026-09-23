import { describe, expect, it } from "vitest";
import {
  extractFirstUrl,
  externalItemId,
  normalizeLookupInput,
  parseShopeeUrl,
} from "@/lib/shopee/parse-url";

describe("parseShopeeUrl — valid forms", () => {
  it("reads the canonical form", () => {
    expect(parseShopeeUrl("https://shopee.vn/product/123456/789012")).toEqual({
      ok: true,
      shopId: "123456",
      itemId: "789012",
    });
  });

  it("reads the -i.shopid.itemid slug form", () => {
    expect(
      parseShopeeUrl("https://shopee.vn/O-cung-SSD-Samsung-i.123456.789012"),
    ).toEqual({ ok: true, shopId: "123456", itemId: "789012" });
  });

  it("ignores junk query strings", () => {
    expect(
      parseShopeeUrl("https://shopee.vn/product/123456/789012?sp_atk=x&xptdk=y"),
    ).toEqual({ ok: true, shopId: "123456", itemId: "789012" });
  });

  it("accepts www and extra whitespace", () => {
    expect(parseShopeeUrl("  https://www.shopee.vn/product/1/2  ")).toEqual({
      ok: true,
      shopId: "1",
      itemId: "2",
    });
  });

  it("reports that short links need redirect following", () => {
    expect(parseShopeeUrl("https://shope.ee/abcXYZ")).toEqual({
      ok: false,
      reason: "needs_redirect",
    });
    expect(parseShopeeUrl("https://s.shopee.vn/abcXYZ")).toEqual({
      ok: false,
      reason: "needs_redirect",
    });
  });
});

describe("parseShopeeUrl — spoofed hosts", () => {
  // This is a real attack surface: a user-supplied URL the server will fetch
  // and write into the catalog. Loose matching (e.g. host.includes("shopee.")) lets
  // every case below through.
  it("blocks shopee.vn nested into an attacker's subdomain", () => {
    expect(parseShopeeUrl("https://shopee.vn.evil.com/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });

  it("blocks domains with shopee. in the middle", () => {
    expect(parseShopeeUrl("https://evil-shopee.com.attacker.net/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });

  it("blocks other marketplaces", () => {
    expect(parseShopeeUrl("https://lazada.vn/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });
});

describe("parseShopeeUrl — invalid input", () => {
  it("distinguishes search terms from other marketplaces' URLs", () => {
    // A user typing a keyword into the URL box must get
    // "please paste a link", not "only Shopee is supported".
    expect(parseShopeeUrl("ssd samsung 2tb")).toEqual({
      ok: false,
      reason: "not_a_url",
    });
    expect(parseShopeeUrl("samsung")).toEqual({
      ok: false,
      reason: "not_a_url",
    });
  });

  it("reports unreadable for unknown Shopee paths", () => {
    expect(parseShopeeUrl("https://shopee.vn/mall")).toEqual({
      ok: false,
      reason: "unrecognized_format",
    });
  });

  it("handles the empty string", () => {
    expect(parseShopeeUrl("")).toEqual({ ok: false, reason: "not_a_url" });
  });
});

describe("externalItemId", () => {
  it("shares conventions with the collector", () => {
    expect(externalItemId("123", "456")).toBe("123_456");
  });
});

describe("extractFirstUrl", () => {
  it("extracts the URL from shared text", () => {
    expect(extractFirstUrl("Xem sản phẩm này nè https://shope.ee/abc hay lắm")).toBe(
      "https://shope.ee/abc",
    );
  });

  it("returns null when there is no URL", () => {
    expect(extractFirstUrl("không có link")).toBeNull();
  });
});

describe("extractFirstUrl — trailing punctuation", () => {
  it("strips brackets and periods stuck to the link in shared text", () => {
    expect(extractFirstUrl("Xem nè (https://shope.ee/abc).")).toBe("https://shope.ee/abc");
  });
});

describe("normalizeLookupInput", () => {
  it("adds https:// to scheme-less short links — so redirects can be followed", () => {
    expect(normalizeLookupInput("shope.ee/abc")).toBe("https://shope.ee/abc");
  });

  it("takes the first URL from the Shopee app's shared text", () => {
    expect(normalizeLookupInput("Mua ngay SSD giá tốt https://shope.ee/xyz nhé")).toBe(
      "https://shope.ee/xyz",
    );
  });

  it("keeps non-URL keywords unchanged", () => {
    expect(normalizeLookupInput("  ssd samsung ")).toBe("ssd samsung");
    expect(parseShopeeUrl(normalizeLookupInput("samsung"))).toEqual({
      ok: false,
      reason: "not_a_url",
    });
  });
});
