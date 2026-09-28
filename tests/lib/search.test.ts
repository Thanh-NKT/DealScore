import { describe, expect, it } from "vitest";
import { parseSearchParams, toSearchParams } from "@/lib/search";

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
