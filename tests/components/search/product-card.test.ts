import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCard } from "@/components/search/product-card";
import type { SearchItem } from "@/lib/search";

function item(over: Partial<SearchItem> = {}): SearchItem {
  return {
    productId: "p1",
    slug: "ssd-a",
    canonicalName: "SSD A 1TB",
    brand: "Samsung",
    image: null,
    categorySlug: "o-cung-ssd",
    bestPrice: 1_000_000,
    originalPrice: 2_000_000,
    score: 80,
    recommendation: "buy",
    lastObservedAt: null,
    effectivePrice: null,
    variantId: null,
    marketplace: "tiktok",
    isFlashSale: false,
    ...over,
  };
}

const render = (i: SearchItem) => renderToStaticMarkup(createElement(ProductCard, { item: i }));

describe("ProductCard", () => {
  it("shows the seller's list-price discount neutrally, never as the verified buy chip or a saving", () => {
    const html = render(item());
    expect(html).toContain("−50%");
    expect(html).not.toMatch(/bg-buy px-2\.5/);
    expect(html).not.toContain("Tiết kiệm");
    expect(html).toContain("Giá niêm yết");
  });

  it("names the marketplace of the card price instead of always 'Shopee'", () => {
    const html = render(item({ originalPrice: null }));
    expect(html).toContain("Ghi nhận trên TikTok Shop");
    expect(html).not.toContain("Shopee");
  });

  it("says nothing about the marketplace when it is unknown", () => {
    expect(render(item({ originalPrice: null, marketplace: null }))).not.toContain("Ghi nhận trên");
  });

  it("labels a flash-sale card price next to the verdict", () => {
    expect(render(item({ isFlashSale: true }))).toContain("Giá flash sale");
    expect(render(item())).not.toContain("Giá flash sale");
  });

  it("an after-voucher price is framed as an estimate", () => {
    const html = render(item({ effectivePrice: 900_000 }));
    expect(html).toContain("~");
    expect(html).toContain("Ước tính");
  });
});
