import { describe, expect, it } from "vitest";
import {
  activeVouchers,
  bestCombination,
  compactVnd,
  discountOf,
  toGroups,
  totalsFor,
} from "@/lib/vouchers/select";
import type { Voucher } from "@/lib/vouchers/types";

const NOW = new Date("2026-09-26T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const SELLER = "seller-1";
const LISTING = "listing-1";
const ctx = { now: NOW, marketplace: "shopee", listingId: LISTING, sellerId: SELLER };

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

describe("activeVouchers", () => {
  it("keeps vouchers in scope: this listing, this seller, this marketplace", () => {
    const keep = [
      v({ kind: "platform" }),
      v({ kind: "shop", sellerId: SELLER }),
      v({ kind: "shop", sellerId: SELLER, listingId: LISTING }),
      v({ kind: "shipping" }),
      v({ kind: "payment" }),
    ];
    const drop = [
      v({ kind: "shop", sellerId: "other-seller" }),
      v({ kind: "shop", sellerId: SELLER, listingId: "other-listing" }),
      v({ kind: "platform", marketplace: "lazada" }),
      v({ kind: "shop", sellerId: null }),
    ];
    expect(activeVouchers([...keep, ...drop], ctx)).toEqual(keep);
  });

  it("drops expired and not-yet-started vouchers; null expiry is open-ended", () => {
    const open = v({ expiresAt: null });
    const future = v({ expiresAt: daysAgo(-1) });
    const expired = v({ expiresAt: daysAgo(0.01) });
    const exactlyNow = v({ expiresAt: NOW.toISOString() });
    const notStarted = v({ startsAt: daysAgo(-0.5) });
    expect(activeVouchers([open, future, expired, exactlyNow, notStarted], ctx)).toEqual([open, future]);
  });

  it("drops vouchers not seen in the last 7 days", () => {
    const fresh = v({ lastSeenAt: daysAgo(6.9) });
    const stale = v({ lastSeenAt: daysAgo(7.1) });
    expect(activeVouchers([fresh, stale], ctx)).toEqual([fresh]);
  });

  it("extension-only vouchers need at least 2 distinct reporters", () => {
    const one = v({ source: "extension", reporters: ["a"] });
    const dup = v({ source: "extension", reporters: ["a", "a"] });
    const two = v({ source: "extension", reporters: ["a", "b"] });
    const api = v({ source: "api", reporters: [] });
    const seed = v({ source: "seed", reporters: [] });
    expect(activeVouchers([one, dup, two, api, seed], ctx)).toEqual([two, api, seed]);
  });
});

describe("discountOf", () => {
  it("amount: the face value", () => {
    expect(discountOf(v({ discountValue: 50_000 }), 1_000_000, 0)).toBe(50_000);
  });

  it("percent: share of the price, capped by max_discount", () => {
    expect(discountOf(v({ discountType: "percent", discountValue: 8 }), 1_000_000, 0)).toBe(80_000);
    expect(discountOf(v({ discountType: "percent", discountValue: 8, maxDiscount: 50_000 }), 1_000_000, 0)).toBe(50_000);
  });

  it("rounds down so a saving is never overstated", () => {
    expect(discountOf(v({ discountType: "percent", discountValue: 3 }), 99_999, 0)).toBe(2_999);
  });

  it("below min spend → 0; exactly at min spend counts", () => {
    expect(discountOf(v({ minSpend: 500_000 }), 499_999, 0)).toBe(0);
    expect(discountOf(v({ minSpend: 500_000 }), 500_000, 0)).toBe(10_000);
  });

  it("shipping vouchers are capped by the shipping fee (0 when unknown)", () => {
    const ship = v({ kind: "shipping", discountValue: 30_000 });
    expect(discountOf(ship, 1_000_000, 18_000)).toBe(18_000);
    expect(discountOf(ship, 1_000_000, 40_000)).toBe(30_000);
    expect(discountOf(ship, 1_000_000, 0)).toBe(0);
  });

  it("never more than the price itself", () => {
    expect(discountOf(v({ discountValue: 200_000 }), 150_000, 0)).toBe(150_000);
    expect(discountOf(v(), 0, 0)).toBe(0);
  });
});

describe("bestCombination", () => {
  it("takes the largest voucher of each kind", () => {
    const shopSmall = v({ kind: "shop", sellerId: SELLER, discountValue: 20_000 });
    const shopBig = v({ kind: "shop", sellerId: SELLER, discountType: "percent", discountValue: 10, maxDiscount: 60_000 });
    const plat = v({ kind: "platform", discountValue: 30_000 });
    const ship = v({ kind: "shipping", discountValue: 15_000 });
    const r = bestCombination([shopSmall, shopBig, plat, ship], 1_000_000, 25_000);
    expect(r.picks.map((p) => [p.voucher.id, p.amount])).toEqual([
      [shopBig.id, 60_000],
      [plat.id, 30_000],
      [ship.id, 15_000],
    ]);
    expect(r.totalDiscount).toBe(105_000);
    expect(r.estimatedTotal).toBe(1_000_000 + 25_000 - 105_000);
  });

  it("skips vouchers below min spend even if their face value is larger", () => {
    const big = v({ discountValue: 100_000, minSpend: 2_000_000 });
    const small = v({ discountValue: 20_000 });
    const r = bestCombination([big, small], 1_000_000, 0);
    expect(r.picks.map((p) => p.voucher.id)).toEqual([small.id]);
    expect(r.estimatedTotal).toBe(980_000);
  });

  it("nothing usable → no picks, total unchanged", () => {
    const r = bestCombination([v({ minSpend: 5_000_000 }), v({ kind: "shipping" })], 1_000_000, 0);
    expect(r).toEqual({ picks: [], totalDiscount: 0, estimatedTotal: 1_000_000 });
  });

  it("the estimate never goes below zero", () => {
    const r = bestCombination(
      [v({ kind: "shop", sellerId: SELLER, discountValue: 90_000 }), v({ kind: "platform", discountValue: 90_000 })],
      100_000,
      0,
    );
    expect(r.totalDiscount).toBe(100_000);
    expect(r.estimatedTotal).toBe(0);
  });
});

describe("totalsFor", () => {
  it("counts at most one voucher per kind", () => {
    const a = v({ kind: "platform", discountValue: 10_000 });
    const b = v({ kind: "platform", discountValue: 50_000 });
    const r = totalsFor([a, b], 500_000, 0);
    expect(r.picks.map((p) => p.voucher.id)).toEqual([a.id]);
    expect(r.estimatedTotal).toBe(490_000);
  });
});

describe("toGroups", () => {
  it("builds picker groups in kind order, biggest discount first, with no invented code", () => {
    const shop = v({ kind: "shop", sellerId: SELLER, discountValue: 50_000, minSpend: 1_000_000, expiresAt: "2026-10-05T16:30:00Z" });
    const plat1 = v({ kind: "platform", discountType: "percent", discountValue: 8, maxDiscount: 150_000 });
    const plat2 = v({ kind: "platform", discountValue: 200_000, code: "SALE200" });
    const groups = toGroups([plat1, shop, plat2], 1_500_000, "Shopee");

    expect(groups.map((g) => g.id)).toEqual(["shop", "platform"]);
    expect(groups[0]).toMatchObject({ name: "Mã của Shop", rule: "Tối đa 1 mã mỗi loại" });
    expect(groups[0].items[0]).toMatchObject({
      code: null,
      big: "50K",
      small: "Giảm",
      title: "Giảm 50.000đ",
      cond: "Đơn tối thiểu 1.000.000đ",
      // 2026-10-05T16:30Z is 23:30 on 05/10 in Vietnam.
      exp: "05/10",
      amount: 50_000,
      minSpend: 1_000_000,
      terms: { id: shop.id, kind: "shop", discountType: "amount", discountValue: 50_000, maxDiscount: null, minSpend: 1_000_000 },
    });
    expect(groups[1].name).toBe("Mã của Shopee");
    expect(groups[1].items.map((i) => [i.code, i.amount])).toEqual([
      ["SALE200", 200_000],
      [null, 120_000],
    ]);
    expect(groups[1].items[1]).toMatchObject({ big: "8%", title: "Giảm 8%, tối đa 150.000đ", cond: "Không yêu cầu đơn tối thiểu", exp: "chưa rõ" });
  });

  it("no vouchers → no groups (the picker shows the honest empty card)", () => {
    expect(toGroups([], 1_000_000, "Shopee")).toEqual([]);
  });

  it("shipping vouchers are marked for the Freeship line", () => {
    const [g] = toGroups([v({ kind: "shipping", discountValue: 30_000 })], 500_000, "Shopee");
    expect(g).toMatchObject({ id: "ship", name: "Mã vận chuyển" });
    expect(g.items[0]).toMatchObject({ isShipping: true, small: "Phí ship", title: "Giảm 30.000đ phí vận chuyển" });
  });
});

describe("compactVnd", () => {
  it.each([
    [50_000, "50K"],
    [12_500, "12,5K"],
    [1_000_000, "1TR"],
    [1_500_000, "1,5TR"],
    [500, "500đ"],
  ])("%d → %s", (value, label) => {
    expect(compactVnd(value)).toBe(label);
  });
});
