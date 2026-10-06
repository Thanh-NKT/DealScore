import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductStickyBar } from "@/components/product/product-sticky-bar";

const render = (affiliate: boolean) =>
  renderToStaticMarkup(
    createElement(ProductStickyBar, { productName: "SSD", price: 1_000_000, buyUrl: "/go/shopee/o1?src=web", marketplace: "shopee", affiliate }),
  );

describe("ProductStickyBar — affiliate disclosure", () => {
  it("an affiliate link carries the disclosure, visible on phones too", () => {
    const html = render(true);
    expect(html).toMatch(/<span class="text-micro text-ink-3">Liên kết tiếp thị<\/span>/);
  });

  it("a non-affiliate link does not claim to be one", () => {
    expect(render(false)).not.toContain("Liên kết tiếp thị");
  });
});
