import { describe, expect, it } from "vitest";
import { MAX_GALLERY_IMAGES, MAX_LISTING_IMAGES, productGallery, sanitizeImageUrls } from "@/lib/product/images";
import { isAllowedImageHost } from "@/lib/marketplaces";

const img = (n: number | string) => `https://down-vn.img.susercontent.com/file/vn-${n}`;

describe("isAllowedImageHost", () => {
  it.each([
    ["shopee", "down-vn.img.susercontent.com", true],
    ["shopee", "cf.shopee.vn", true],
    ["shopee", "cvf.shopee.vn", true],
    ["shopee", "DOWN-VN.IMG.SUSERCONTENT.COM", true],
    ["shopee", "susercontent.com.evil.com", false],
    ["shopee", "evilsusercontent.com", false],
    ["shopee", "shopee.vn", false],
    ["lazada", "down-vn.img.susercontent.com", false],
    ["nope", "cf.shopee.vn", false],
  ])("%s / %s → %s", (market, host, allowed) => {
    expect(isAllowedImageHost(market, host)).toBe(allowed);
  });
});

describe("sanitizeImageUrls", () => {
  it("keeps https CDN URLs, drops everything else, deduplicates", () => {
    expect(
      sanitizeImageUrls(
        [
          img(1),
          img(1),
          `${img(1)}#frag`,
          "http://cf.shopee.vn/file/x",
          "https://user:pw@cf.shopee.vn/file/x",
          "https://cf.shopee.vn:8443/file/x",
          "https://evil.com/x.jpg",
          "javascript:alert(1)",
          "data:image/png;base64,AAAA",
          `https://cf.shopee.vn/${"a".repeat(1000)}`,
          42,
          null,
          "https://cf.shopee.vn/file/y",
        ],
        "shopee",
      ),
    ).toEqual([img(1), "https://cf.shopee.vn/file/y"]);
  });

  it("caps at 12 by default and returns [] for non-arrays", () => {
    const many = Array.from({ length: 20 }, (_, i) => img(i));
    expect(sanitizeImageUrls(many, "shopee")).toHaveLength(MAX_LISTING_IMAGES);
    expect(sanitizeImageUrls("x", "shopee")).toEqual([]);
  });
});

describe("productGallery", () => {
  it("main image first, then listing images, without duplicates", () => {
    expect(
      productGallery("/samples/ssd.svg", [
        { marketplace: "shopee", images: [img(1), img(2)] },
        { marketplace: "shopee", images: [img(2), img(3), "https://evil.com/x.jpg"] },
      ]),
    ).toEqual(["/samples/ssd.svg", img(1), img(2), img(3)]);
  });

  it("works without a main image and caps at 8", () => {
    const g = productGallery(null, [{ marketplace: "shopee", images: Array.from({ length: 12 }, (_, i) => img(i)) }]);
    expect(g).toHaveLength(MAX_GALLERY_IMAGES);
    expect(g[0]).toBe(img(0));
  });

  it("no images anywhere → []", () => {
    expect(productGallery(undefined, [{ marketplace: "shopee", images: null }])).toEqual([]);
  });
});
