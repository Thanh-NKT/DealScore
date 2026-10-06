import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSearchParams, searchItemHref, searchProducts, toSearchParams } from "@/lib/search";

// searchProducts talks to Supabase through the server client: stub it with a spy-able rpc.
const rpc = vi.fn();
/** Result of the categories lookup by slug (searchProducts resolves ?cat= to an id first). */
const category: { result: { data: { id: string } | null; error: { message: string } | null } } = {
  result: { data: null, error: null },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => category.result }) }) }),
  }),
}));

const parse = (qs: string) => parseSearchParams(new URLSearchParams(qs));

describe("parseSearchParams", () => {
  it("default sort is relevance when there is a query", () => {
    expect(parse("q=ssd").sort).toBe("relevance");
  });

  it("default sort is updated when there is no query", () => {
    expect(parse("").sort).toBe("updated");
  });

  it("accepts multiple brands", () => {
    expect(parse("brand=samsung&brand=wd").brands).toEqual(["samsung", "wd"]);
  });

  it("swaps when min is greater than max", () => {
    const p = parse("min=500&max=100");
    expect(p.minPrice).toBe(100);
    expect(p.maxPrice).toBe(500);
  });

  it("forces page to 1 when below 1 or not a number", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-3").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });

  it("ignores unknown sorts and falls back to the default", () => {
    expect(parse("q=ssd&sort=hacker").sort).toBe("relevance");
  });

  it("ignores non-numeric prices", () => {
    expect(parse("min=abc").minPrice).toBeUndefined();
  });

  it("also reads Next.js object-style searchParams", () => {
    const p = parseSearchParams({ q: "ssd", brand: ["samsung", "wd"], page: "2" });
    expect(p.q).toBe("ssd");
    expect(p.brands).toEqual(["samsung", "wd"]);
    expect(p.page).toBe(2);
  });
});

describe("round-trip parse ↔ serialize", () => {
  it("keeps every parameter — required for sharing filters via URL", () => {
    const original =
      "q=ssd+samsung&cat=o-cung-ssd&brand=samsung&brand=wd&min=100&max=500&sort=price_asc&page=3";
    const once = parseSearchParams(new URLSearchParams(original));
    const twice = parseSearchParams(toSearchParams(once));
    expect(twice).toEqual(once);
  });

  it("doesn't write default parameters into the URL", () => {
    // Writing the default sort into the URL produces two different paths for the same
    // page — duplicate content, harmful to SEO (section 1.7).
    const qs = toSearchParams(parse("q=ssd")).toString();
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("sort=");
  });
});

describe("parseSearchParams — catId", () => {
  it("drops a non-UUID catId instead of letting the RPC throw", () => {
    expect(parseSearchParams({ catId: "abc" }).categoryId).toBeUndefined();
  });

  it("keeps a well-formed UUID catId", () => {
    const id = "0b6f1c2e-5a8d-4c1e-9f3a-2d7b8e6c4a10";
    expect(parseSearchParams({ catId: id }).categoryId).toBe(id);
  });
});

describe("advanced filters (Phase 2)", () => {
  it("parses rating, free shipping and voucher, ignoring unknown values", () => {
    const p = parseSearchParams(new URLSearchParams("rating=4.8&freeship=1&voucher=1"));
    expect(p).toMatchObject({ minRating: 4.8, freeShipping: true, hasVoucher: true });
    const bad = parseSearchParams(new URLSearchParams("rating=3&freeship=yes&voucher=0"));
    expect(bad.minRating).toBeUndefined();
    expect(bad.freeShipping).toBeUndefined();
    expect(bad.hasVoucher).toBeUndefined();
  });

  it("round-trips through the URL", () => {
    const qs = toSearchParams(parseSearchParams(new URLSearchParams("q=ssd&rating=4.5&freeship=1"))).toString();
    expect(qs).toBe("q=ssd&rating=4.5&freeship=1");
  });
});

describe("marketplace filter (?market=)", () => {
  const markets = (qs: string) => parseSearchParams(new URLSearchParams(qs)).marketplaces;

  it("parses a comma list, in canonical order, deduped and case-insensitive", () => {
    expect(markets("market=lazada,SHOPEE,shopee")).toEqual(["shopee", "lazada"]);
  });

  it("also tolerates repeated market params", () => {
    expect(markets("market=lazada&market=tiktok")).toEqual(["tiktok", "lazada"]);
    expect(parseSearchParams({ market: ["lazada", "shopee"] }).marketplaces).toEqual(["shopee", "lazada"]);
  });

  it("drops unknown ids; nothing known means no filter", () => {
    expect(markets("market=shopee,amazon")).toEqual(["shopee"]);
    expect(markets("market=amazon")).toBeUndefined();
    expect(markets("market=")).toBeUndefined();
    expect(markets("")).toBeUndefined();
  });

  it("serializes as one comma-separated market param and round-trips", () => {
    const sp = toSearchParams(parseSearchParams(new URLSearchParams("q=ssd&market=lazada&market=shopee")));
    expect(sp.getAll("market")).toEqual(["shopee,lazada"]);
    expect(parseSearchParams(sp).marketplaces).toEqual(["shopee", "lazada"]);
  });

  it("writes nothing when no marketplace is selected", () => {
    expect(toSearchParams({ q: "ssd", marketplaces: [] }).has("market")).toBe(false);
  });
});

describe("query intent params (Phase 3 group A)", () => {
  it("parses cap as an integer GB within bounds", () => {
    expect(parse("cap=2048").capacityGb).toBe(2048);
    expect(parse("cap=1").capacityGb).toBe(1);
    expect(parse("cap=65536").capacityGb).toBe(65536);
  });

  it("ignores a non-numeric or out-of-range cap", () => {
    expect(parse("cap=abc").capacityGb).toBeUndefined();
    expect(parse("cap=0").capacityGb).toBeUndefined();
    expect(parse("cap=65537").capacityGb).toBeUndefined();
    expect(parse("cap=2.5").capacityGb).toBeUndefined();
  });

  it("intent=0 turns intent off; absent means on (undefined)", () => {
    expect(parse("intent=0").intent).toBe(false);
    expect(parse("").intent).toBeUndefined();
    expect(parse("intent=1").intent).toBeUndefined();
  });

  it("prefs=1 turns prefs on; absent means off (undefined)", () => {
    expect(parse("prefs=1").prefs).toBe(true);
    expect(parse("").prefs).toBeUndefined();
  });

  it("accepts effective_asc as a valid sort", () => {
    expect(parse("sort=effective_asc").sort).toBe("effective_asc");
    expect(parse("sort=effective_asc").sortExplicit).toBe(true);
  });

  it("sortExplicit is false when sort was defaulted", () => {
    expect(parse("q=ssd").sortExplicit).toBe(false);
    expect(parse("").sortExplicit).toBe(false);
    expect(parse("sort=hacker").sortExplicit).toBe(false);
  });

  it("toSearchParams writes cap, intent=0 and prefs=1", () => {
    const qs = toSearchParams({ capacityGb: 2048, intent: false, prefs: true });
    expect(qs.get("cap")).toBe("2048");
    expect(qs.get("intent")).toBe("0");
    expect(qs.get("prefs")).toBe("1");
  });

  it("toSearchParams writes nothing for intent when on (undefined or true)", () => {
    expect(toSearchParams({}).has("intent")).toBe(false);
    expect(toSearchParams({ intent: true }).has("intent")).toBe(false);
  });

  it("toSearchParams never writes sizeInch, color or boostTerms", () => {
    const qs = toSearchParams({ sizeInch: 27, color: "black", boostTerms: ["gaming"] });
    expect(qs.toString()).toBe("");
  });
});

describe("searchProducts — RPC arguments and row mapping", () => {
  const row = {
    product_id: "p1",
    slug: "ssd-a",
    canonical_name: "SSD A 2TB",
    brand: "Samsung",
    image: null,
    category_slug: "o-cung-ssd",
    best_price: "2500000",
    original_price: null,
    score: 72,
    recommendation: "buy",
    last_observed_at: "2026-09-28T00:00:00Z",
    relevance: 1,
    total_count: 1,
    effective_price: "2300000",
  };

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [row], error: null });
  });

  const argsOfLastCall = () => rpc.mock.calls.at(-1)![1] as Record<string, unknown>;

  it("passes capacityGb as p_capacity_gb", async () => {
    await searchProducts({ q: "ssd", capacityGb: 2048 });
    expect(rpc.mock.calls.at(-1)![0]).toBe("search_products");
    expect(argsOfLastCall().p_capacity_gb).toBe(2048);
  });

  it("omits p_capacity_gb and p_boost_terms when unset or empty", async () => {
    await searchProducts({ q: "ssd", boostTerms: [] });
    expect(argsOfLastCall().p_capacity_gb).toBeUndefined();
    expect(argsOfLastCall().p_boost_terms).toBeUndefined();
  });

  it("strips LIKE wildcards and backslashes from boost terms and drops empty ones", async () => {
    await searchProducts({ q: "ssd", boostTerms: ["gaming", "50%_off", "%", " \\ ", "a\\b"] });
    expect(argsOfLastCall().p_boost_terms).toEqual(["gaming", "50off", "ab"]);
  });

  it("sends undefined when every boost term is only wildcards", async () => {
    await searchProducts({ q: "ssd", boostTerms: ["%%", "__"] });
    expect(argsOfLastCall().p_boost_terms).toBeUndefined();
  });

  it("maps effective_price to a number, null when absent", async () => {
    const res = await searchProducts({ q: "ssd" });
    expect(res.items[0].effectivePrice).toBe(2_300_000);
    expect(res.items[0].bestPrice).toBe(2_500_000);

    rpc.mockResolvedValue({ data: [{ ...row, effective_price: null }], error: null });
    const res2 = await searchProducts({ q: "ssd" });
    expect(res2.items[0].effectivePrice).toBeNull();
  });
});

describe("searchProducts — representative variant", () => {
  const row = {
    product_id: "p1",
    slug: "ssd-a",
    canonical_name: "SSD A",
    brand: null,
    image: null,
    category_slug: "o-cung-ssd",
    best_price: "2500000",
    original_price: null,
    score: null,
    recommendation: null,
    last_observed_at: null,
    relevance: 1,
    total_count: 1,
    effective_price: null,
    variant_id: "var-2tb",
  };

  it("maps variant_id to variantId (null when absent)", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [row], error: null });
    expect((await searchProducts({ q: "ssd", capacityGb: 2048 })).items[0].variantId).toBe("var-2tb");
    rpc.mockResolvedValue({ data: [{ ...row, variant_id: null }], error: null });
    expect((await searchProducts({ q: "ssd" })).items[0].variantId).toBeNull();
  });
});

describe("searchItemHref", () => {
  const item = { categorySlug: "o-cung-ssd", slug: "ssd-a", variantId: "var-2tb" };

  it("links to the matched variant when the search filtered by capacity", () => {
    expect(searchItemHref(item, { capacityGb: 2048 })).toBe("/o-cung-ssd/ssd-a?variant=var-2tb");
  });

  it("plain product link otherwise, or when the variant is unknown", () => {
    expect(searchItemHref(item, {})).toBe("/o-cung-ssd/ssd-a");
    expect(searchItemHref({ ...item, variantId: null }, { capacityGb: 2048 })).toBe("/o-cung-ssd/ssd-a");
  });

  it("encodes the variant id", () => {
    expect(searchItemHref({ ...item, variantId: "a b&c" }, { capacityGb: 1024 })).toBe("/o-cung-ssd/ssd-a?variant=a%20b%26c");
  });
});

describe("searchProducts — category slug (?cat=)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
    category.result = { data: null, error: null };
  });

  it("an unknown slug returns an empty result and never runs the unfiltered search", async () => {
    const res = await searchProducts({ categorySlug: "typo", page: 2 });
    expect(res).toMatchObject({ items: [], total: 0, page: 2 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a failed category lookup throws instead of searching the whole catalog", async () => {
    category.result = { data: null, error: { message: "boom" } };
    await expect(searchProducts({ categorySlug: "o-cung-ssd" })).rejects.toThrow(/category/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a known slug filters by its id", async () => {
    category.result = { data: { id: "cat-1" }, error: null };
    await searchProducts({ categorySlug: "o-cung-ssd" });
    expect((rpc.mock.calls.at(-1)![1] as Record<string, unknown>).p_category_id).toBe("cat-1");
  });
});

describe("searchProducts — card marketplace and flash flag (0026)", () => {
  it("maps marketplace and is_flash_sale", async () => {
    category.result = { data: null, error: null };
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: [{ product_id: "p1", slug: "a", canonical_name: "A", category_slug: "x", total_count: 1, marketplace: "lazada", is_flash_sale: true }],
      error: null,
    });
    const [item] = (await searchProducts({ q: "a" })).items;
    expect(item).toMatchObject({ marketplace: "lazada", isFlashSale: true });

    rpc.mockResolvedValue({ data: [{ product_id: "p1", slug: "a", canonical_name: "A", total_count: 1 }], error: null });
    const [old] = (await searchProducts({ q: "a" })).items;
    expect(old).toMatchObject({ marketplace: null, isFlashSale: false });
  });
});
