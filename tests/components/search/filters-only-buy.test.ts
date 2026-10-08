import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const { ActiveFilterChips, Filters, activeFilterCount } = await import("@/components/search/filters");
const { EmptyState } = await import("@/components/search/empty-state");

const filters = (params: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(Filters, { params, availableCategories: [], availableBrands: [] }));

describe("Chỉ hiện Nên mua", () => {
  it("toggles ?buy=1 and shows its selected state", () => {
    const off = filters({ q: "ssd" });
    expect(off).toContain("Chỉ hiện Nên mua");
    expect(off).toContain("buy=1");
    const on = filters({ q: "ssd", onlyBuy: true });
    expect(on).toContain('aria-pressed="true"');
    expect(activeFilterCount({ onlyBuy: true })).toBe(1);
  });

  it("active chip 'Chỉ Nên mua' removes buy", () => {
    const html = renderToStaticMarkup(createElement(ActiveFilterChips, { params: { q: "ssd", onlyBuy: true } }));
    expect(html).toContain("Chỉ Nên mua");
    expect(html).toContain('href="/search?q=ssd"');
  });

  it("empty state suggests turning it off", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { kind: "too_strict", query: "ssd", onlyBuyOffHref: "/search?q=ssd" }),
    );
    expect(html).toContain("tắt “Chỉ hiện Nên mua”");
    expect(html).toContain("Có thể chờ");
  });

  it("no query + filter on: one hint to turn it off, not two", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { kind: "too_strict", query: "", onlyBuyOffHref: "/search" }));
    expect(html.match(/Chỉ hiện Nên mua/g)).toHaveLength(1);
    expect(html).toContain("Thử bỏ bớt thương hiệu.");
    const off = renderToStaticMarkup(createElement(EmptyState, { kind: "too_strict", query: "" }));
    expect(off).toContain("Thử bỏ bớt thương hiệu.");
    expect(off).not.toContain("Chỉ hiện Nên mua");
  });
});
