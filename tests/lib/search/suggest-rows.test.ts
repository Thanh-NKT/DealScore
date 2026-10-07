import { describe, expect, it } from "vitest";
import { emptyAutocomplete, type AutocompleteResponse } from "@/lib/search/autocomplete-types";
import { buildSuggestions, compareHref, flattenGroups } from "@/lib/search/suggest-rows";

const product = (slug: string) => ({
  productId: `id-${slug}`,
  slug,
  categorySlug: "ssd",
  name: slug,
  brand: null,
  image: null,
  bestPrice: 1000,
});

const full: AutocompleteResponse = {
  q: "ssd 2tb",
  products: [product("wd-sn850x"), product("samsung-990")],
  brands: [{ name: "Samsung", href: "/brand/samsung" }],
  categories: [{ name: "SSD", slug: "ssd", href: "/ssd" }],
  intent: [{ label: "2TB" }],
};

describe("buildSuggestions", () => {
  it("orders sections: search row, categories, brands, products", () => {
    const { groups, empty } = buildSuggestions({ q: "ssd 2tb", data: full, recent: [] });
    expect(empty).toBe(false);
    expect(groups.map((g) => g.key)).toEqual(["query", "category", "brand", "product"]);
    expect(groups.map((g) => g.label)).toEqual([null, "Danh mục", "Hãng", "Sản phẩm"]);
    const rows = flattenGroups(groups);
    expect(rows.map((r) => r.href)).toEqual([
      "/search?q=ssd+2tb",
      "/ssd",
      "/brand/samsung",
      "/ssd/wd-sn850x",
      "/ssd/samsung-990",
    ]);
    expect(rows[0]).toMatchObject({ kind: "query", q: "ssd 2tb", chips: ["2TB"] });
  });

  it("skips empty sections", () => {
    const data = { ...full, brands: [], categories: [] };
    expect(buildSuggestions({ q: "ssd 2tb", data, recent: [] }).groups.map((g) => g.key)).toEqual(["query", "product"]);
  });

  it("keeps the previous list while new suggestions load, with the search row for what is typed now", () => {
    const { groups, empty } = buildSuggestions({ q: "ssd 2tb wd", data: full, recent: [] });
    expect(empty).toBe(false);
    const rows = flattenGroups(groups);
    // Intent chips belong to the old query, so they are not shown on the new search row.
    expect(rows[0]).toMatchObject({ kind: "query", q: "ssd 2tb wd", chips: [], href: "/search?q=ssd+2tb+wd" });
    expect(rows).toHaveLength(5);
  });

  it("is empty (no rows) when the answer for this query has nothing", () => {
    expect(buildSuggestions({ q: "zzz", data: emptyAutocomplete("zzz"), recent: [] })).toEqual({ groups: [], empty: true });
  });

  it("shows only the search row while the first answer is still loading", () => {
    const { groups, empty } = buildSuggestions({ q: "ss", data: null, recent: ["old"] });
    expect(empty).toBe(false);
    expect(flattenGroups(groups).map((r) => r.kind)).toEqual(["query"]);
  });

  it("shows recent searches (and only them) for an empty box, then a clear-history row", () => {
    const { groups } = buildSuggestions({ q: "", data: full, recent: ["tai nghe", "ssd"] });
    expect(groups.map((g) => [g.key, g.label])).toEqual([["recent", "Tìm gần đây"], ["clear", null]]);
    expect(flattenGroups(groups).map((r) => r.href)).toEqual(["/search?q=tai+nghe", "/search?q=ssd", null]);
    // "Xóa lịch sử" is the last option, so the arrow keys reach it and Enter clears.
    expect(flattenGroups(groups).at(-1)).toEqual({ kind: "clear-recent", href: null });
  });

  it("no clear-history row when there is no history", () => {
    expect(buildSuggestions({ q: "", data: full, recent: [] }).groups).toEqual([]);
  });

  it("shows nothing for one character or a pasted link", () => {
    expect(buildSuggestions({ q: "s", data: full, recent: ["x"] }).groups).toEqual([]);
    expect(buildSuggestions({ q: "https://shopee.vn/x", link: true, data: full, recent: [] })).toEqual({ groups: [], empty: false });
  });

  it("compare picker: no category or brand pages, products and searches stay inside /compare", () => {
    const { groups } = buildSuggestions({ q: "ssd 2tb", data: full, recent: [], compare: { a: "wd-sn850x" } });
    expect(groups.map((g) => g.key)).toEqual(["query", "product"]);
    expect(flattenGroups(groups).map((r) => r.href)).toEqual([
      "/compare?a=wd-sn850x&q=ssd+2tb",
      "/compare?a=wd-sn850x&b=wd-sn850x",
      "/compare?a=wd-sn850x&b=samsung-990",
    ]);
    const recent = buildSuggestions({ q: "", data: null, recent: ["ssd"], compare: { b: "x" } });
    expect(flattenGroups(recent.groups)[0].href).toBe("/compare?b=x&q=ssd");
  });

  it("compare picker is empty when no product matched, even if a brand did", () => {
    const data = { ...full, products: [] };
    expect(buildSuggestions({ q: "ssd 2tb", data, recent: [], compare: {} })).toEqual({ groups: [], empty: true });
  });
});

describe("compareHref", () => {
  it("fills the side that is not chosen yet, A first", () => {
    expect(compareHref({}, "p")).toBe("/compare?a=p");
    expect(compareHref({ a: "x" }, "p")).toBe("/compare?a=x&b=p");
    expect(compareHref({ b: "y" }, "p")).toBe("/compare?a=p&b=y");
  });
});

describe("buildSuggestions — whitespace-only box", () => {
  it("shows no recent searches while the box holds only spaces", () => {
    const out = buildSuggestions({ q: "", boxEmpty: false, data: null, recent: ["ssd 1tb"] });
    expect(out.groups).toEqual([]);
  });

  it("still shows recent searches when the box is truly empty", () => {
    const out = buildSuggestions({ q: "", boxEmpty: true, data: null, recent: ["ssd 1tb"] });
    expect(out.groups[0]?.key).toBe("recent");
  });
});
