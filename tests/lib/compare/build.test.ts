import { describe, expect, it } from "vitest";
import { buildComparison } from "@/lib/compare/build";
import { parseUnitQuantity } from "@/lib/pricing/unit-price";
import type { ProductPageData } from "@/lib/product/page-data";
import type { Recommendation } from "@/lib/pricing/deal-score";

function page(over: {
  slug: string;
  price?: number | null;
  score?: number | null;
  rec?: Recommendation;
  low?: number | null;
  median?: number | null;
  offers?: number;
  specs?: Record<string, unknown>;
  fake?: string | null;
}): ProductPageData {
  const price = over.price === undefined ? 1_000_000 : over.price;
  const cheapest = price == null ? null : ({ price, inStock: true } as never);
  return {
    product: {
      id: over.slug,
      slug: over.slug,
      canonicalName: over.slug.toUpperCase(),
      brand: "B",
      model: null,
      image: null,
      specs: over.specs ?? {},
      status: "verified",
      categorySlug: "ssd",
      categoryName: "SSD",
    },
    variants: [],
    selectedVariantId: `${over.slug}-v`,
    pricing: {
      offers: Array.from({ length: over.offers ?? 1 }, () => ({}) as never),
      cheapest,
      bestBuy: cheapest,
      lastKnown: null,
      allOutOfStock: false,
      headline:
        over.score === undefined && over.rec === undefined
          ? ({ score: 70, recommendation: "wait", reasons: [], stats: {} } as never)
          : ({ score: over.score ?? null, recommendation: over.rec ?? "wait", reasons: [], stats: {} } as never),
      stats: { low: over.low ?? 900_000, median: over.median ?? 1_000_000, high: 1_200_000, dayCount: 30 },
      fakeSaleMessage: over.fake ?? null,
      trackingSince: "2026-06-01",
      updatedAt: null,
      isStale: false,
    },
    dailyPrices: [],
  };
}

const row = (c: ReturnType<typeof buildComparison>, key: string) => c.rows.find((r) => r.key === key)!;

describe("buildComparison", () => {
  it("cheaper price wins, higher Deal Score wins, better verdict wins", () => {
    const c = buildComparison(
      page({ slug: "a", price: 900_000, score: 80, rec: "buy" }),
      page({ slug: "b", price: 1_000_000, score: 60, rec: "wait" }),
    );
    expect(row(c, "price")).toMatchObject({ a: "900.000đ", b: "1.000.000đ", winner: "a" });
    expect(row(c, "score")).toMatchObject({ a: "80/100", b: "60/100", winner: "a" });
    expect(row(c, "verdict").winner).toBe("a");
  });

  it("calls differences under 1% a tie", () => {
    const c = buildComparison(page({ slug: "a", price: 1_000_000 }), page({ slug: "b", price: 1_005_000 }));
    expect(row(c, "price").winner).toBe("tie");
  });

  it("never invents a value: a missing side shows — and no winner", () => {
    const c = buildComparison(page({ slug: "a", price: null }), page({ slug: "b" }));
    expect(row(c, "price")).toMatchObject({ a: "—", winner: null });
    expect(row(c, "vs_median")).toMatchObject({ a: "—", winner: null });
  });

  it("insufficient_data gives no verdict winner", () => {
    const c = buildComparison(page({ slug: "a", score: null, rec: "insufficient_data" }), page({ slug: "b", rec: "buy", score: 80 }));
    expect(row(c, "verdict").winner).toBeNull();
    expect(row(c, "score").a).toBe("—");
  });

  it("vs-median row: lower (further under the median) wins", () => {
    const c = buildComparison(
      page({ slug: "a", price: 900_000, median: 1_000_000 }),
      page({ slug: "b", price: 1_100_000, median: 1_000_000 }),
    );
    expect(row(c, "vs_median")).toMatchObject({ a: "−10%", b: "+10%", winner: "a" });
  });

  it("tracking and fake-sale rows are informational (never a winner)", () => {
    const c = buildComparison(page({ slug: "a", fake: "Giảm ảo" }), page({ slug: "b" }));
    expect(row(c, "tracking").winner).toBeNull();
    expect(row(c, "tracking").a).toBe("01/06/2026");
    expect(row(c, "fake_sale")).toMatchObject({ a: "Có", b: "Không", winner: null });
  });

  it("spec rows are the sorted union of both products' keys", () => {
    const c = buildComparison(
      page({ slug: "a", specs: { "Dung lượng": "2TB", "Chuẩn": "NVMe" } }),
      page({ slug: "b", specs: { "Dung lượng": "1TB", "Bảo hành": 5 } }),
    );
    expect(c.specRows.map((r) => [r.label, r.a, r.b])).toEqual([
      ["Bảo hành", "—", "5"],
      ["Chuẩn", "NVMe", "—"],
      ["Dung lượng", "2TB", "1TB"],
    ]);
  });

  it("summary says which is cheaper by how much, and which is at Nên mua", () => {
    const c = buildComparison(page({ slug: "a", price: 900_000, rec: "buy", score: 80 }), page({ slug: "b", price: 1_000_000, rec: "wait", score: 60 }));
    expect(c.summary).toEqual(["A đang rẻ hơn 100.000đ (10%).", "Chỉ A đang ở mức Nên mua theo lịch sử giá của chính nó."]);
  });

  it("summary never compares a missing price", () => {
    const c = buildComparison(page({ slug: "a", price: null }), page({ slug: "b" }));
    expect(c.summary[0]).toMatch(/chưa so được giá/);
  });

  it("sides carry name, price and a link to the exact variant", () => {
    const c = buildComparison(page({ slug: "a" }), page({ slug: "b" }));
    expect(c.a).toMatchObject({ name: "A", href: "/ssd/a?variant=a-v", recommendation: "wait" });
  });
});

describe("buildComparison — unit price row (P4 G)", () => {
  const withUnit = (slug: string, price: number, key: string) => {
    const p = page({ slug, price });
    p.variants = [{ id: `${slug}-v`, variantKey: key, price, inStock: true, cachedScore: null, unitQuantity: parseUnitQuantity(key) }];
    return p;
  };
  it("shows 'Giá theo đơn vị' only when both sides share a unit; cheaper per unit wins", () => {
    const c = buildComparison(withUnit("a", 300_000, "48 miếng"), withUnit("b", 500_000, "96 miếng"));
    expect(c.rows.find((r) => r.key === "unit_price")).toMatchObject({ a: "6.250 đ/miếng", b: "5.208 đ/miếng", winner: "b" });
    const d = buildComparison(withUnit("a", 300_000, "48 miếng"), withUnit("b", 500_000, "1L"));
    expect(d.rows.find((r) => r.key === "unit_price")).toBeUndefined();
    const e = buildComparison(withUnit("a", 300_000, "2TB"), withUnit("b", 500_000, "2TB"));
    expect(e.rows.find((r) => r.key === "unit_price")).toBeUndefined();
  });
});
