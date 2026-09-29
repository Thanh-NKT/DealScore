import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
import {
  effectivePriceFor,
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

describe("shownEffectivePrice", () => {
  it("shown only when lower than the price and computed within 7 days", () => {
    expect(shownEffectivePrice(90, daysAgo(1), 100, NOW)).toBe(90);
    expect(shownEffectivePrice(100, daysAgo(1), 100, NOW)).toBeNull();
    expect(shownEffectivePrice(90, daysAgo(8), 100, NOW)).toBeNull();
    expect(shownEffectivePrice(null, daysAgo(1), 100, NOW)).toBeNull();
    expect(shownEffectivePrice(90, null, 100, NOW)).toBeNull();
    expect(shownEffectivePrice(90, daysAgo(1), null, NOW)).toBeNull();
  });
});

describe("effective reason", () => {
  it("copy", () => {
    expect(effectiveReason(1_234_000)).toBe(`Dùng voucher: ước tính còn ${formatVnd(1_234_000)} (chưa gồm phí ship).`);
  });

  const pricing = (cheapest: Record<string, unknown> | null, score: number | null = 80) =>
    ({
      cheapest,
      headline: cheapest ? { score, recommendation: "buy", reasons: ["✓ a"] } : null,
    }) as unknown as VariantPricing;

  it("appends to the headline reasons when the best offer has a lower effective price", () => {
    const out = withEffectiveReason(pricing({ price: 1_000_000, effectivePrice: 950_000 }));
    expect(out.headline!.reasons).toEqual(["✓ a", effectiveReason(950_000)]);
  });

  it("unchanged without a (lower) effective price, a headline or a score", () => {
    for (const p of [
      pricing({ price: 1_000_000, effectivePrice: null }),
      pricing({ price: 1_000_000, effectivePrice: 1_000_000 }),
      pricing(null),
      pricing({ price: 1_000_000, effectivePrice: 950_000 }, null),
    ]) {
      expect(withEffectiveReason(p)).toBe(p);
    }
  });
});
