import { describe, expect, it } from "vitest";
import {
  canSaveSearch,
  defaultSavedSearchName,
  parseSavedParams,
  savedToSearchParams,
  toSavedParams,
} from "@/lib/saved-search/params";
import { SAVED_PARAMS_FIXTURES } from "./fixtures";

describe("toSavedParams", () => {
  it("keeps intent-applied category / price, drops sort, page, prefs, intent, categoryId", () => {
    const p = toSavedParams({
      q: "  nồi  chiên ",
      categorySlug: "noi-chien",
      categoryId: "00000000-0000-4000-8000-000000000000",
      maxPrice: 1_500_000,
      sort: "deal_score",
      page: 3,
      prefs: true,
      intent: false,
      onlyBuy: true,
    });
    expect(p).toEqual({ q: "nồi chiên", categorySlug: "noi-chien", maxPrice: 1_500_000, onlyBuy: true });
  });
});

describe("canSaveSearch", () => {
  it("needs a scope and a condition", () => {
    expect(canSaveSearch({ maxPrice: 1 })).toEqual({ ok: false, reason: "no_scope" });
    expect(canSaveSearch({ q: "ssd" })).toEqual({ ok: false, reason: "no_condition" });
    expect(canSaveSearch({ brands: ["Philips"], onlyBuy: true })).toEqual({ ok: true });
  });
});

describe("parseSavedParams", () => {
  it.each(SAVED_PARAMS_FIXTURES)("%s", (_name, raw, valid) => {
    expect(parseSavedParams(raw) !== null).toBe(valid);
  });
});

describe("savedToSearchParams", () => {
  it("intent off, cheapest first, page 1", () => {
    expect(savedToSearchParams({ q: "ssd", maxPrice: 2_000_000 })).toMatchObject({
      q: "ssd",
      maxPrice: 2_000_000,
      intent: false,
      sort: "price_asc",
      page: 1,
    });
  });
});

describe("defaultSavedSearchName", () => {
  it("reads like the condition", () => {
    expect(defaultSavedSearchName({ q: "nồi chiên Philips", maxPrice: 1_500_000, onlyBuy: true })).toBe(
      "nồi chiên philips · dưới 1,5 triệu · Nên mua",
    );
    expect(defaultSavedSearchName({ categorySlug: "ssd", maxPrice: 850_000 }, "Ổ cứng SSD")).toBe("ổ cứng ssd · dưới 850.000đ");
  });
});
