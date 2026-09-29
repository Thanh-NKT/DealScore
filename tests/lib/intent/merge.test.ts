import { describe, expect, it } from "vitest";
import { applyIntent, removeChip } from "@/lib/intent/merge";
import type { QueryIntent } from "@/lib/intent/types";
import { parseSearchParams, toSearchParams, type SearchParams } from "@/lib/search";

function intent(overrides: Partial<QueryIntent>): QueryIntent {
  return { text: "", boostTerms: [], chips: [], ...overrides };
}

describe("applyIntent", () => {
  it("URL max beats intent maxPrice — the whole price chip is dropped", () => {
    const params: SearchParams = { maxPrice: 5_000_000 };
    const qi = intent({
      maxPrice: 3_000_000,
      chips: [{ kind: "price", label: "≤ 3.000.000đ" }],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.maxPrice).toBe(5_000_000);
    expect(applied).toEqual([]);
  });

  it("brands already in the URL keep the intent brand chip out of applied", () => {
    const params: SearchParams = { brands: ["Samsung"] };
    const qi = intent({
      brands: ["WD"],
      chips: [{ kind: "brand", label: "WD" }],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.brands).toEqual(["Samsung"]);
    expect(applied).toEqual([]);
  });

  it("replaces q with intent.text when ≥ 1 chip is applied", () => {
    const params: SearchParams = { q: "ssd 2tb duoi 3tr" };
    const qi = intent({
      text: "ssd",
      capacityGb: 2048,
      chips: [{ kind: "capacity", label: "2TB" }],
    });
    const { params: next } = applyIntent(params, qi);
    expect(next.q).toBe("ssd");
    expect(next.capacityGb).toBe(2048);
  });

  it("leaves q unchanged when no chips are applied", () => {
    const params: SearchParams = { q: "pro", brands: ["Apple"] };
    const qi = intent({
      text: "pro",
      brands: ["Apple"],
      chips: [{ kind: "brand", label: "Apple" }],
    });
    // brand already set in URL with the same value → chip dropped, no field actually free.
    const { params: next, applied } = applyIntent(params, qi);
    expect(applied).toEqual([]);
    expect(next.q).toBe("pro");
  });

  it("empty intent.text clears q to undefined when a chip is applied", () => {
    const params: SearchParams = { q: "2tb" };
    const qi = intent({
      text: "",
      capacityGb: 2048,
      chips: [{ kind: "capacity", label: "2TB" }],
    });
    const { params: next } = applyIntent(params, qi);
    expect(next.q).toBeUndefined();
  });

  it("respects sortExplicit — sort chip is dropped when the URL sort was explicit", () => {
    const params: SearchParams = { sort: "price_desc", sortExplicit: true };
    const qi = intent({
      sort: "deal_score",
      chips: [{ kind: "sort", label: "Đáng mua nhất" }],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.sort).toBe("price_desc");
    expect(applied).toEqual([]);
  });

  it("applies the sort chip when the URL sort was defaulted", () => {
    const params: SearchParams = { sort: "relevance", sortExplicit: false };
    const qi = intent({
      sort: "deal_score",
      chips: [{ kind: "sort", label: "Đáng mua nhất" }],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.sort).toBe("deal_score");
    expect(applied).toHaveLength(1);
  });

  it("size and color chips are always applied and feed boostTerms", () => {
    const params: SearchParams = {};
    const qi = intent({
      sizeInch: 27,
      color: "black",
      chips: [
        { kind: "size", label: "27 inch" },
        { kind: "color", label: "Màu đen" },
      ],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.sizeInch).toBe(27);
    expect(next.color).toBe("black");
    expect(next.boostTerms).toEqual(expect.arrayContaining(["27 inch", "black"]));
    expect(applied).toHaveLength(2);
  });

  it("merges intent.boostTerms even when no chip is applied, deduping", () => {
    const params: SearchParams = { boostTerms: ["gaming"] };
    const qi = intent({ boostTerms: ["gaming", "wireless"] });
    const { params: next } = applyIntent(params, qi);
    expect(next.boostTerms).toEqual(["gaming", "wireless"]);
  });

  it("applies marketplace chip only when URL has no marketplaces", () => {
    const params: SearchParams = {};
    const qi = intent({
      marketplaces: ["shopee"],
      chips: [{ kind: "marketplace", label: "Shopee" }],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.marketplaces).toEqual(["shopee"]);
    expect(applied).toHaveLength(1);
  });

  it("applies free_shipping and voucher flags", () => {
    const params: SearchParams = {};
    const qi = intent({
      freeShipping: true,
      hasVoucher: true,
      chips: [
        { kind: "free_shipping", label: "Freeship" },
        { kind: "voucher", label: "Có voucher" },
      ],
    });
    const { params: next, applied } = applyIntent(params, qi);
    expect(next.freeShipping).toBe(true);
    expect(next.hasVoucher).toBe(true);
    expect(applied).toHaveLength(2);
  });

  it("applies category chip only when URL has neither categorySlug nor categoryId", () => {
    const withCat: SearchParams = { categorySlug: "ram" };
    const qi = intent({
      categorySlug: "ssd",
      chips: [{ kind: "category", label: "Ổ cứng SSD" }],
    });
    expect(applyIntent(withCat, qi).applied).toEqual([]);

    const withoutCat: SearchParams = {};
    const { params: next, applied } = applyIntent(withoutCat, qi);
    expect(next.categorySlug).toBe("ssd");
    expect(applied).toHaveLength(1);
  });
});

describe("removeChip", () => {
  it("clears the price fields and turns intent off", () => {
    const params: SearchParams = { q: "ssd", minPrice: 1, maxPrice: 3_000_000 };
    const next = removeChip(params, "price");
    expect(next.minPrice).toBeUndefined();
    expect(next.maxPrice).toBeUndefined();
    expect(next.intent).toBe(false);
    expect(next.q).toBe("ssd");
  });

  it("clears sort and sortExplicit", () => {
    const next = removeChip({ sort: "deal_score", sortExplicit: false }, "sort");
    expect(next.sort).toBeUndefined();
  });

  it("removes the size term it added from boostTerms", () => {
    const params: SearchParams = { sizeInch: 27, boostTerms: ["27 inch", "gaming"] };
    const next = removeChip(params, "size");
    expect(next.sizeInch).toBeUndefined();
    expect(next.boostTerms).toEqual(["gaming"]);
  });

  it("removes the color term it added from boostTerms", () => {
    const params: SearchParams = { color: "black", boostTerms: ["black", "gaming"] };
    const next = removeChip(params, "color");
    expect(next.color).toBeUndefined();
    expect(next.boostTerms).toEqual(["gaming"]);
  });

  it("round-trips through toSearchParams: intent=0, field dropped", () => {
    const params = parseSearchParams(new URLSearchParams("q=ssd&min=100&max=500"));
    const next = removeChip(params, "price");
    const qs = toSearchParams(next);
    expect(qs.get("intent")).toBe("0");
    expect(qs.has("min")).toBe(false);
    expect(qs.has("max")).toBe(false);
    expect(qs.get("q")).toBe("ssd");
  });

  it("clears brand/marketplace/category/free_shipping/voucher", () => {
    expect(removeChip({ brands: ["WD"] }, "brand").brands).toBeUndefined();
    expect(removeChip({ marketplaces: ["shopee"] }, "marketplace").marketplaces).toBeUndefined();
    expect(removeChip({ categorySlug: "ssd", categoryId: "x" }, "category").categorySlug).toBeUndefined();
    expect(removeChip({ categorySlug: "ssd", categoryId: "x" }, "category").categoryId).toBeUndefined();
    expect(removeChip({ freeShipping: true }, "free_shipping").freeShipping).toBeUndefined();
    expect(removeChip({ hasVoucher: true }, "voucher").hasVoucher).toBeUndefined();
    expect(removeChip({ capacityGb: 2048 }, "capacity").capacityGb).toBeUndefined();
  });
});
