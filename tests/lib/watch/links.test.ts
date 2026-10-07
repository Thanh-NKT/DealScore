import { describe, expect, it } from "vitest";
import { watchBuyTarget, watchGoHref } from "@/lib/watch/links";
import type { WatchView } from "@/lib/watch/describe";

const view = (o: Partial<WatchView> = {}): WatchView => ({
  price: 900,
  inStock: true,
  isStale: false,
  observedAt: "2026-10-07T00:00:00Z",
  deal: null,
  target: { amount: 1000, gap: 0, gapPct: -0.1, reached: true },
  changeSinceStart: null,
  change7d: null,
  conditions: [],
  alertStatus: { kind: "none" },
  sortKey: 0,
  ...o,
});
const shopee = { marketplace: "shopee", affiliate: true };

describe("watchBuyTarget", () => {
  it("target reached, in stock, fresh, known offer on a marketplace with an adapter → target", () => {
    expect(watchBuyTarget(view(), shopee, "o1")).toEqual({ offerId: "o1", marketplace: "shopee", affiliate: true });
    expect(watchBuyTarget(view(), { marketplace: "tiktok", affiliate: false }, "o2"))
      .toEqual({ offerId: "o2", marketplace: "tiktok", affiliate: false });
  });

  it("null otherwise", () => {
    expect(watchBuyTarget(view({ target: null }), shopee, "o1")).toBeNull();
    expect(watchBuyTarget(view({ target: { amount: 800, gap: 100, gapPct: 0.1, reached: false } }), shopee, "o1")).toBeNull();
    expect(watchBuyTarget(view({ inStock: false }), shopee, "o1")).toBeNull();
    expect(watchBuyTarget(view({ isStale: true }), shopee, "o1")).toBeNull();
    expect(watchBuyTarget(view(), shopee, null)).toBeNull();
    expect(watchBuyTarget(view(), undefined, "o1")).toBeNull();
    expect(watchBuyTarget(view(), { marketplace: "amazon", affiliate: true }, "o1")).toBeNull();
  });
});

describe("watchGoHref", () => {
  it("encodes marketplace, offer and watch id", () => {
    expect(watchGoHref({ id: "w1", buy: { offerId: "o1", marketplace: "shopee", affiliate: true } }))
      .toBe("/go/shopee/o1?src=web&watch=w1");
    expect(watchGoHref({ id: "w/1&x", buy: { offerId: "o 1", marketplace: "a/b", affiliate: false } }))
      .toBe("/go/a%2Fb/o%201?src=web&watch=w%2F1%26x");
  });

  it("null without a buy target", () => {
    expect(watchGoHref({ id: "w1", buy: null })).toBeNull();
  });
});
