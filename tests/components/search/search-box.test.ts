import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const { SearchBox, SEARCH_PLACEHOLDER } = await import("@/components/search/search-box");
const { HeroSearchForm } = await import("@/components/home/hero-search-form");
const { SuggestPopup } = await import("@/components/search/suggest-popup");
const { buildSuggestions } = await import("@/lib/search/suggest-rows");

describe("SearchBox (server render = what works without JavaScript)", () => {
  it("is a plain GET form to /search with the query field and the intent-teaching placeholder", () => {
    const html = renderToStaticMarkup(createElement(SearchBox, { initialQuery: "ssd 2tb" }));
    expect(html).toContain('action="/search"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="ssd 2tb"');
    expect(html).toContain(`placeholder="${SEARCH_PLACEHOLDER}"`);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-keyshortcuts="/"');
    // The frame owns the focus ring; the input opts out of the global outline (no inner rectangle).
    expect(html).toMatch(/focus-within:border-primary/);
    expect(html).toMatch(/focus-visible:outline-none/);
  });

  it("compare picker submits to /compare and keeps the chosen side", () => {
    const html = renderToStaticMarkup(createElement(SearchBox, { compare: { a: "wd-sn850x" } }));
    expect(html).toContain('action="/compare"');
    expect(html).toContain('name="a" value="wd-sn850x"');
    expect(html).toContain("Tên, hãng hoặc model sản phẩm…");
  });

  it("homepage hero is a GET form to /search too", () => {
    const html = renderToStaticMarkup(createElement(HeroSearchForm));
    expect(html).toContain('action="/search"');
    expect(html).toContain('name="q"');
    expect(html).toContain(`placeholder="${SEARCH_PLACEHOLDER}"`);
  });
});

describe("SuggestPopup", () => {
  const data = {
    q: "tai nghe",
    products: [{ productId: "1", slug: "sony-wh", categorySlug: "tai-nghe", name: "Tai nghe Sony WH", brand: "Sony", image: null, bestPrice: 5_990_000 }],
    brands: [{ name: "Sony", href: "/brand/sony" }],
    categories: [{ name: "Tai nghe", slug: "tai-nghe", href: "/tai-nghe" }],
    intent: [{ label: "≤ 3.000.000đ" }],
  };
  const render = (q: string, recent: string[] = [], d: typeof data | null = data) =>
    renderToStaticMarkup(
      createElement(SuggestPopup, {
        listId: "L",
        optionId: (i: number) => `o-${i}`,
        suggestions: buildSuggestions({ q, data: d, recent }),
        query: q,
        active: 1,
        pending: false,
        onHover: () => {},
        onPick: () => {},
        onRemoveRecent: () => {},
      }),
    );

  it("one listbox, labelled groups, sequential option ids across sections", () => {
    const html = render("tai nghe");
    expect(html.match(/role="listbox"/g)).toHaveLength(1);
    expect(html).toContain('role="group" aria-labelledby="L-category"');
    expect(html).toContain('id="L-category"');
    expect(html).toContain('aria-labelledby="L-brand"');
    expect(html).toContain('aria-labelledby="L-product"');
    for (const i of [0, 1, 2, 3]) expect(html).toContain(`id="o-${i}"`);
    expect(html).toContain('id="o-1" role="option" aria-selected="true"');
    expect(html).toContain("≤ 3.000.000đ");
    // Matched words in semibold.
    expect(html).toContain('<span class="font-semibold text-ink">Tai</span>');
  });

  it("empty answer: one line inviting Enter, no listbox", () => {
    const html = render("zzz", [], { ...data, q: "zzz", products: [], brands: [], categories: [], intent: [] });
    expect(html).not.toContain('role="listbox"');
    expect(html).toContain("Không có gợi ý — nhấn Enter để tìm “");
    expect(html).toContain('<p role="status"');
  });

  it("recent searches: no nested control inside an option; Delete is announced; clear-all is an option", () => {
    const html = render("", ["ssd", "tai nghe"]);
    expect(html).toContain("Tìm gần đây");
    // axe nested-interactive: an option holds no button, link or focusable element.
    expect(html).not.toMatch(/<button|<a |tabindex=/i);
    // Every recent option announces its keyboard removal.
    expect(html.match(/aria-describedby="L-remove-hint"/g)).toHaveLength(2);
    expect(html).toContain('<span id="L-remove-hint" hidden="">Nhấn Delete để xóa khỏi lịch sử</span>');
    expect(html.match(/aria-keyshortcuts="Delete Backspace"/g)).toHaveLength(2);
    // The × is pointer-only, hidden from assistive tech.
    expect(html).toMatch(/<span aria-hidden="true" title="Xóa khỏi lịch sử"/);
    // Active row (index 1) shows the visible hint too.
    expect(html.match(/Delete để xóa</g)).toHaveLength(1);
    // "Xóa lịch sử" is the third option (o-2) of the one listbox.
    expect(html).toMatch(/id="o-2" role="option" aria-selected="false"[^>]*>(?:(?!role="option").)*Xóa lịch sử/);
    expect(html.match(/role="listbox"/g)).toHaveLength(1);
  });
});
