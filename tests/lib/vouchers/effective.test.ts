import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
import {
  effectivePriceFor,
  effectiveQuoteFor,
  effectiveReason,
  shownEffectivePrice,
  withEffectiveReason,
} from "@/lib/vouchers/effective";
import type { VariantPricing } from "@/lib/pricing/variant-pricing";
import type { Voucher } from "@/lib/vouchers/types";

const NOW = new Date("2026-09-28T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const ctx = { now: NOW, marketplace: "shopee", listingId: "listing-1", sellerId: "seller-1" };

let n = 0;
function v(over: Partial<Voucher> = {}): Voucher {
  n++;
  return {
    id: `v${n}`,
    marketplace: "shopee",
    kind: "platform",
    sellerId: null,
    listingId: null,
    code: null,
    discountType: "amount",
    discountValue: 10_000,
    maxDiscount: null,
    minSpend: 0,
    startsAt: null,
    expiresAt: null,
    source: "api",
    reporters: [],
    firstSeenAt: daysAgo(1),
    lastSeenAt: daysAgo(0),
    ...over,
  };
}

describe("effectivePriceFor", () => {
  it("percent voucher is capped by maxDiscount", () => {
    const list = [v({ discountType: "percent", discountValue: 10, maxDiscount: 50_000 })];
    expect(effectivePriceFor(1_000_000, list, ctx)).toBe(950_000);
  });

  it("amount vouchers of different kinds stack (one per kind)", () => {
    const list = [
      v({ kind: "platform", discountValue: 20_000 }),
      v({ kind: "platform", discountValue: 30_000 }),
      v({ kind: "shop", sellerId: "seller-1", discountValue: 15_000 }),
    ];
    expect(effectivePriceFor(500_000, list, ctx)).toBe(455_000);
  });

  it("below min spend → null", () => {
    expect(effectivePriceFor(400_000, [v({ minSpend: 500_000 })], ctx)).toBeNull();
  });

  it("expired voucher → null", () => {
    expect(effectivePriceFor(400_000, [v({ expiresAt: daysAgo(1) })], ctx)).toBeNull();
  });

  it("extension voucher with one reporter → null; two reporters → applied", () => {
    expect(effectivePriceFor(400_000, [v({ source: "extension", reporters: ["a"] })], ctx)).toBeNull();
    expect(effectivePriceFor(400_000, [v({ source: "extension", reporters: ["a", "b"] })], ctx)).toBe(390_000);
  });

  it("shipping-only vouchers → null (shipping fee unknown, counted as 0)", () => {
    expect(effectivePriceFor(400_000, [v({ kind: "shipping", discountValue: 30_000 })], ctx)).toBeNull();
  });

  it("no vouchers / bad price → null", () => {
    expect(effectivePriceFor(400_000, [], ctx)).toBeNull();
    expect(effectivePriceFor(0, [v()], ctx)).toBeNull();
    expect(effectivePriceFor(Number.NaN, [v()], ctx)).toBeNull();
  });

  it("never negative", () => {
    const list = [v({ kind: "platform", discountValue: 900_000 }), v({ kind: "payment", discountValue: 900_000 })];
    expect(effectivePriceFor(100_000, list, ctx)).toBe(0);
  });
});

describe("effectiveQuoteFor", () => {
  const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

  it("until = earliest expiry among the vouchers actually picked", () => {
    const list = [
      v({ kind: "platform", discountValue: 20_000, expiresAt: inDays(5) }),
      v({ kind: "shop", sellerId: "seller-1", discountValue: 15_000, expiresAt: inDays(2) }),
      // Not picked (smaller platform discount): its earlier expiry must not count.
      v({ kind: "platform", discountValue: 5_000, expiresAt: inDays(1) }),
    ];
    expect(effectiveQuoteFor(500_000, list, ctx)).toEqual({ price: 465_000, until: inDays(2) });
  });

  it("until is null when no picked voucher expires; null quote when nothing applies", () => {
    expect(effectiveQuoteFor(500_000, [v({ discountValue: 20_000 })], ctx)).toEqual({ price: 480_000, until: null });
    expect(effectiveQuoteFor(400_000, [v({ minSpend: 500_000, expiresAt: inDays(1) })], ctx)).toBeNull();
  });

  it("a voucher below min spend at the current price is not picked (price dropped under min spend)", () => {
    const list = [v({ discountValue: 100_000, minSpend: 1_000_000 })];
    expect(effectivePriceFor(1_050_000, list, ctx)).toBe(950_000);
    expect(effectivePriceFor(980_000, list, ctx)).toBeNull();
  });

  it("effectivePriceFor is the quote's price", () => {
    const list = [v({ discountValue: 20_000, expiresAt: inDays(3) })];
    expect(effectivePriceFor(500_000, list, ctx)).toBe(effectiveQuoteFor(500_000, list, ctx)!.price);
  });
});

describe("shownEffectivePrice", () => {
  const cur = (price: number | null, observedAt: string | null = daysAgo(2)) => ({ price, observedAt });
  const stored = (price: number | null, at: string | null = daysAgo(1), until: string | null = null) => ({ price, at, until });

  it("shown only when lower than the price and computed within 7 days", () => {
    expect(shownEffectivePrice(stored(90), cur(100), NOW)).toBe(90);
    expect(shownEffectivePrice(stored(100), cur(100), NOW)).toBeNull();
    expect(shownEffectivePrice(stored(90, daysAgo(8)), cur(100, daysAgo(9)), NOW)).toBeNull();
    expect(shownEffectivePrice(stored(null), cur(100), NOW)).toBeNull();
    expect(shownEffectivePrice(stored(90, null), cur(100), NOW)).toBeNull();
    expect(shownEffectivePrice(stored(90), cur(null), NOW)).toBeNull();
  });

  it("hidden when the current observation is newer than the computation (price changed since)", () => {
    expect(shownEffectivePrice(stored(90, daysAgo(1)), cur(100, daysAgo(0.5)), NOW)).toBeNull();
    // Same instant: computed from that observation.
    expect(shownEffectivePrice(stored(90, daysAgo(1)), cur(100, daysAgo(1)), NOW)).toBe(90);
  });

  it("hidden without the current observation time", () => {
    expect(shownEffectivePrice(stored(90), cur(100, null), NOW)).toBeNull();
  });

  it("hidden once a voucher of the combination expired (until passed)", () => {
    expect(shownEffectivePrice(stored(90, daysAgo(1), daysAgo(0.1)), cur(100), NOW)).toBeNull();
    expect(shownEffectivePrice(stored(90, daysAgo(1), NOW.toISOString()), cur(100), NOW)).toBeNull();
    expect(shownEffectivePrice(stored(90, daysAgo(1), daysAgo(-1)), cur(100), NOW)).toBe(90);
  });
});

describe("effective reason", () => {
  it("copy", () => {
    expect(effectiveReason(1_234_000)).toBe(`Dùng voucher: ước tính còn ${formatVnd(1_234_000)} (chưa gồm phí ship).`);
  });

  const pricing = (
    cheapest: Record<string, unknown> | null,
    score: number | null = 80,
    bestBuy: Record<string, unknown> | null = cheapest,
  ) =>
    ({
      cheapest,
      bestBuy,
      headline: cheapest ? { score, recommendation: "buy", reasons: ["✓ a"] } : null,
    }) as unknown as VariantPricing;

  it("names the marketplace when the voucher makes a different marketplace the best buy", () => {
    const out = withEffectiveReason(
      pricing(
        { marketplace: "shopee", price: 1_000_000, effectivePrice: null },
        80,
        { marketplace: "tiktok", price: 1_050_000, effectivePrice: 950_000 },
      ),
    );
    expect(out.headline!.reasons).toEqual(["✓ a", effectiveReason(950_000, "TikTok Shop")]);
    expect(effectiveReason(950_000, "TikTok Shop")).toBe(
      `Dùng voucher trên TikTok Shop: ước tính còn ${formatVnd(950_000)} (chưa gồm phí ship).`,
    );
  });

  it("appends to the headline reasons when the best offer has a lower effective price", () => {
    const out = withEffectiveReason(pricing({ price: 1_000_000, effectivePrice: 950_000 }));
    expect(out.headline!.reasons).toEqual(["✓ a", effectiveReason(950_000)]);
  });

  it("also appends while the Deal Score is insufficient (spec §4: the voucher line shows regardless)", () => {
    const out = withEffectiveReason(pricing({ price: 1_000_000, effectivePrice: 950_000 }, null));
    expect(out.headline!.reasons).toEqual(["✓ a", effectiveReason(950_000)]);
  });

  it("unchanged without a (lower) effective price or a headline", () => {
    for (const p of [
      pricing({ price: 1_000_000, effectivePrice: null }),
      pricing({ price: 1_000_000, effectivePrice: 1_000_000 }),
      pricing(null),
    ]) {
      expect(withEffectiveReason(p)).toBe(p);
    }
  });
});
