import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({}) }));

const { toOgProduct } = await import("@/lib/product/og-data");

const variant = (price: number | null, inStock: boolean, vds: { recommendation: string; price_at_compute: number | null } | null) => ({
  variant_current_price: { price, in_stock: inStock },
  variant_deal_scores: vds,
});

describe("toOgProduct", () => {
  it("lowest in-stock price, with the verdict cached for exactly that price", () => {
    const og = toOgProduct({
      canonical_name: "SSD",
      brand: "WD",
      product_variants: [
        variant(900, false, { recommendation: "buy", price_at_compute: 900 }),
        variant(1200, true, { recommendation: "wait", price_at_compute: 1200 }),
        variant(1500, true, { recommendation: "avoid", price_at_compute: 1500 }),
      ],
    });
    expect(og).toEqual({ canonicalName: "SSD", brand: "WD", lowPrice: 1200, recommendation: "wait" });
  });

  it("no verdict when the cache was computed for another price", () => {
    const og = toOgProduct({ canonical_name: "SSD", brand: null, product_variants: [variant(1000, true, { recommendation: "buy", price_at_compute: 1100 })] });
    expect(og.recommendation).toBeNull();
    expect(og.lowPrice).toBe(1000);
  });

  it("nothing in stock → no price, no verdict", () => {
    const og = toOgProduct({ canonical_name: "SSD", brand: null, product_variants: [variant(1000, false, null)] });
    expect(og).toMatchObject({ lowPrice: null, recommendation: null });
  });
});
