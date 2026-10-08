// Shared by tests/lib/saved-search/params.test.ts (parseSavedParams) and tests/db/saved-searches.test.ts
// (saved_search_params_valid, 0060): both must give the same answer for every entry.
export const SAVED_PARAMS_FIXTURES: Array<[string, unknown, boolean]> = [
  ["q + maxPrice", { q: "nồi chiên", maxPrice: 1500000 }, true],
  ["category + onlyBuy", { categorySlug: "ssd", onlyBuy: true }, true],
  ["brand-only scope", { brands: ["Philips"], maxPrice: 900000 }, true],
  ["everything", {
    q: "ssd", categorySlug: "ssd", brands: ["Samsung"], minPrice: 1000, maxPrice: 3000000, marketplaces: ["shopee", "lazada"],
    capacityGb: 2048, onlyBuy: true, freeShipping: true, hasVoucher: true, minRating: 4.5,
  }, true],
  ["no condition", { q: "ssd" }, false],
  ["no scope", { maxPrice: 1000 }, false],
  ["unknown key", { q: "ssd", maxPrice: 1, sort: "price_asc" }, false],
  ["q too long", { q: "x".repeat(101), maxPrice: 1 }, false],
  ["q blank", { q: "   ", maxPrice: 1 }, false],
  ["onlyBuy false", { q: "ssd", onlyBuy: false }, false],
  ["maxPrice string", { q: "ssd", maxPrice: "1000" }, false],
  ["maxPrice zero", { q: "ssd", maxPrice: 0 }, false],
  ["min > max", { q: "ssd", minPrice: 5, maxPrice: 4 }, false],
  ["brands empty", { brands: [], maxPrice: 1 }, false],
  ["brands non-string", { brands: [1], maxPrice: 1 }, false],
  ["unknown marketplace", { q: "ssd", maxPrice: 1, marketplaces: ["amazon"] }, false],
  ["capacity fractional", { q: "ssd", maxPrice: 1, capacityGb: 1.5 }, false],
  ["rating not allowed", { q: "ssd", maxPrice: 1, minRating: 4 }, false],
  ["array", [], false],
  ["string", "q", false],
];
