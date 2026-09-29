import { describe, expect, it } from "vitest";
import {
  EMPTY_PREFERENCES,
  MAX_PREFERENCE_ITEMS,
  applyPreferences,
  isEmptyPreferences,
  normalizePreferences,
  parsePreferencesForm,
  togglePrefsParams,
  type Preferences,
} from "@/lib/preferences";
import type { SearchParams } from "@/lib/search";

const CAT_SSD = "11111111-1111-4111-8111-111111111111";
const CAT_MOUSE = "22222222-2222-4222-8222-222222222222";
const SLUGS = new Map([
  [CAT_SSD, "ssd"],
  [CAT_MOUSE, "chuot"],
]);

const prefs = (p: Partial<Preferences>): Preferences => ({ ...EMPTY_PREFERENCES, ...p });

describe("normalizePreferences", () => {
  it("returns empty preferences for junk input", () => {
    for (const raw of [null, undefined, 42, "x", [], { brands: "Samsung" }]) {
      expect(normalizePreferences(raw)).toEqual(EMPTY_PREFERENCES);
    }
  });

  it("reads both the camelCase shape and a DB row", () => {
    const row = {
      user_id: "ignored",
      brands: ["Samsung"],
      excluded_brands: ["Noname"],
      category_ids: [CAT_SSD],
      min_price: 100000,
      max_price: "3000000.00",
      marketplaces: ["shopee"],
      updated_at: "2026-09-29T00:00:00Z",
    };
    const expected: Preferences = {
      brands: ["Samsung"],
      excludedBrands: ["Noname"],
      categoryIds: [CAT_SSD],
      minPrice: 100000,
      maxPrice: 3000000,
      marketplaces: ["shopee"],
    };
    expect(normalizePreferences(row)).toEqual(expected);
    expect(normalizePreferences(expected)).toEqual(expected);
  });

  it("trims brands, drops blanks and non-strings, dedupes case-insensitively (first spelling wins)", () => {
    const p = normalizePreferences({ brands: ["  Samsung ", "samsung", "", "   ", 7, null, "WD", "SAMSUNG"] });
    expect(p.brands).toEqual(["Samsung", "WD"]);
  });

  it("keeps at most 20 items per list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `B${i}`);
    const p = normalizePreferences({ brands: many, excludedBrands: many });
    expect(p.brands).toHaveLength(MAX_PREFERENCE_ITEMS);
    expect(p.excludedBrands).toHaveLength(MAX_PREFERENCE_ITEMS);
    expect(p.brands[19]).toBe("B19");
  });

  it("keeps only valid uuids for categories, lower-cased and deduped", () => {
    const p = normalizePreferences({
      categoryIds: [CAT_SSD.toUpperCase(), CAT_SSD, "not-a-uuid", "'; drop table", CAT_MOUSE],
    });
    expect(p.categoryIds).toEqual([CAT_SSD, CAT_MOUSE]);
  });

  it("prices: finite and ≥ 0, otherwise null; min > max is swapped", () => {
    expect(normalizePreferences({ minPrice: -1, maxPrice: Number.NaN })).toMatchObject({ minPrice: null, maxPrice: null });
    expect(normalizePreferences({ minPrice: Infinity, maxPrice: "abc" })).toMatchObject({ minPrice: null, maxPrice: null });
    expect(normalizePreferences({ minPrice: 0, maxPrice: 500000 })).toMatchObject({ minPrice: 0, maxPrice: 500000 });
    expect(normalizePreferences({ minPrice: 5_000_000, maxPrice: 3_000_000 })).toMatchObject({
      minPrice: 3_000_000,
      maxPrice: 5_000_000,
    });
  });

  it("prices beyond numeric(14,2) are dropped", () => {
    expect(normalizePreferences({ maxPrice: 1e13 }).maxPrice).toBeNull();
  });

  it("marketplaces: only known ids, deduped, in marketplace order", () => {
    const p = normalizePreferences({ marketplaces: ["lazada", "amazon", "SHOPEE", "lazada"] });
    expect(p.marketplaces).toEqual(["shopee", "lazada"]);
  });
});

describe("isEmptyPreferences", () => {
  it("is true only when nothing is set", () => {
    expect(isEmptyPreferences(EMPTY_PREFERENCES)).toBe(true);
    expect(isEmptyPreferences(prefs({ brands: ["WD"] }))).toBe(false);
    expect(isEmptyPreferences(prefs({ categoryIds: [CAT_SSD] }))).toBe(false);
    expect(isEmptyPreferences(prefs({ minPrice: 0 }))).toBe(false);
    expect(isEmptyPreferences(prefs({ maxPrice: 100 }))).toBe(false);
    expect(isEmptyPreferences(prefs({ marketplaces: ["shopee"] }))).toBe(false);
  });
});

describe("applyPreferences", () => {
  const full = prefs({
    brands: ["Samsung", "WD"],
    categoryIds: [CAT_SSD],
    minPrice: 1_000_000,
    maxPrice: 3_000_000,
    marketplaces: ["shopee"],
  });

  it("fills every unset field", () => {
    const out = applyPreferences({ q: "ssd", sort: "relevance", page: 1, prefs: true }, full, SLUGS);
    expect(out).toEqual({
      q: "ssd",
      sort: "relevance",
      page: 1,
      prefs: true,
      brands: ["Samsung", "WD"],
      categorySlug: "ssd",
      minPrice: 1_000_000,
      maxPrice: 3_000_000,
      marketplaces: ["shopee"],
    });
  });

  it("the URL wins: explicit fields are never overwritten", () => {
    const params: SearchParams = {
      brands: ["Kingston"],
      categorySlug: "chuot",
      maxPrice: 500_000,
      marketplaces: ["lazada"],
    };
    expect(applyPreferences(params, full, SLUGS)).toEqual(params);
  });

  it("a URL min price alone blocks both preference prices", () => {
    const out = applyPreferences({ minPrice: 200_000 }, full, SLUGS);
    expect(out.minPrice).toBe(200_000);
    expect(out.maxPrice).toBeUndefined();
  });

  it("a categoryId in the URL blocks the category preference", () => {
    const out = applyPreferences({ categoryId: CAT_MOUSE }, full, SLUGS);
    expect(out.categorySlug).toBeUndefined();
    expect(out.categoryId).toBe(CAT_MOUSE);
  });

  it("sets categorySlug only for exactly one preferred category", () => {
    expect(applyPreferences({}, prefs({ categoryIds: [CAT_SSD, CAT_MOUSE] }), SLUGS).categorySlug).toBeUndefined();
    // Unknown (deleted) category: nothing to map.
    expect(
      applyPreferences({}, prefs({ categoryIds: ["33333333-3333-4333-8333-333333333333"] }), SLUGS).categorySlug,
    ).toBeUndefined();
  });

  it("empty preference lists and null prices leave params untouched", () => {
    const params: SearchParams = { q: "chuột", page: 2 };
    expect(applyPreferences(params, EMPTY_PREFERENCES, SLUGS)).toEqual(params);
  });

  it("an empty URL brand list counts as unset", () => {
    expect(applyPreferences({ brands: [] }, full, SLUGS).brands).toEqual(["Samsung", "WD"]);
  });

  it("does not mutate its inputs", () => {
    const params: SearchParams = { q: "x" };
    const out = applyPreferences(params, full, SLUGS);
    expect(params).toEqual({ q: "x" });
    out.brands!.push("Z");
    expect(full.brands).toEqual(["Samsung", "WD"]);
  });
});

describe("parsePreferencesForm", () => {
  function form(entries: Array<[string, string]>): FormData {
    const fd = new FormData();
    for (const [k, v] of entries) fd.append(k, v);
    return fd;
  }

  it("reads multi-value fields and Vietnamese price shorthand", () => {
    const r = parsePreferencesForm(
      form([
        ["brands", "Samsung"],
        ["brands", "WD"],
        ["categoryIds", CAT_SSD],
        ["minPrice", "500k"],
        ["maxPrice", "3.000.000"],
        ["marketplaces", "shopee"],
        ["marketplaces", "lazada"],
      ]),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        brands: ["Samsung", "WD"],
        excludedBrands: [],
        categoryIds: [CAT_SSD],
        minPrice: 500_000,
        maxPrice: 3_000_000,
        marketplaces: ["shopee", "lazada"],
      },
    });
  });

  it("empty or zero prices mean no bound", () => {
    const r = parsePreferencesForm(form([["minPrice", ""], ["maxPrice", "0"]]));
    expect(r).toEqual({ ok: true, value: EMPTY_PREFERENCES });
  });

  it("an unreadable price is a Vietnamese field error", () => {
    const r = parsePreferencesForm(form([["minPrice", "abc"], ["maxPrice", "-5"]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.minPrice).toMatch(/giá/i);
    expect(r.errors.maxPrice).toMatch(/giá/i);
  });

  it("swaps a reversed price range instead of failing", () => {
    const r = parsePreferencesForm(form([["minPrice", "3tr"], ["maxPrice", "1tr"]]));
    expect(r).toMatchObject({ ok: true, value: { minPrice: 1_000_000, maxPrice: 3_000_000 } });
  });

  it("ignores a userId field and anything else it does not know", () => {
    const r = parsePreferencesForm(form([["userId", "attacker"], ["user_id", "attacker"], ["brands", "WD"]]));
    expect(r).toEqual({ ok: true, value: { ...EMPTY_PREFERENCES, brands: ["WD"] } });
  });
});

describe("togglePrefsParams", () => {
  it("turns the flag on/off and goes back to page 1, keeping everything else", () => {
    const base: SearchParams = { q: "ssd", brands: ["WD"], page: 3, sort: "price_asc" };
    expect(togglePrefsParams(base, false)).toEqual({ q: "ssd", brands: ["WD"], sort: "price_asc", prefs: true });
    expect(togglePrefsParams({ ...base, prefs: true }, true)).toEqual({ q: "ssd", brands: ["WD"], sort: "price_asc" });
  });
});

describe("parsePreferencesForm limits", () => {
  it("more than 20 brands or categories → field error instead of silently dropping", () => {
    const fd = new FormData();
    for (let i = 0; i < 21; i++) fd.append("brands", `B${i}`);
    for (let i = 0; i < 21; i++) fd.append("categoryIds", `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const r = parsePreferencesForm(fd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.brands).toMatch(/20/);
    expect(r.errors.categoryIds).toMatch(/20/);
  });
});
