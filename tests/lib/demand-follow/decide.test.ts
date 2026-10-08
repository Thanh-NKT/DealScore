import { describe, expect, it } from "vitest";
import { decideDemandFollow } from "@/lib/demand-follow/decide";
import { demandFollowOffer } from "@/lib/demand-follow/offer";
import type { SavedSearchMatch } from "@/lib/saved-search/decide";

const now = new Date("2026-10-08T03:00:00Z");
const r = (id: string, price: number, hoursAgo = 1): SavedSearchMatch => ({
  productId: id, variantId: null, price, recommendation: null, score: null,
  lastObservedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
});
const f = (o = {}) => ({ keyword: "g10", knownProductIds: ["a"], expiresAt: "2026-11-01T00:00:00Z", ...o });

describe("decideDemandFollow", () => {
  it("known ids only → wait", () => {
    expect(decideDemandFollow(f(), [r("a", 1)], now)).toEqual({ kind: "wait" });
  });
  it("a new fresh product → found, ≤ 3 items cheapest first", () => {
    const d = decideDemandFollow(f(), [r("a", 1), r("b", 50), r("c", 40), r("d", 30), r("e", 20)], now);
    expect(d).toMatchObject({ kind: "found", totalNew: 4 });
    expect(d.kind === "found" && d.items.map((i) => i.productId)).toEqual(["e", "d", "c"]);
  });
  it("a new but stale product does not count", () => {
    expect(decideDemandFollow(f(), [r("b", 1, 60)], now)).toEqual({ kind: "wait" });
  });
  it("past expiresAt → expire even if found", () => {
    expect(decideDemandFollow(f({ expiresAt: "2026-10-08T02:00:00Z" }), [r("b", 1)], now)).toEqual({ kind: "expire" });
  });
});

describe("demandFollowOffer", () => {
  it("only < 3 results, page 1, valid keyword", () => {
    expect(demandFollowOffer({ q: "Máy hút bụi G10", total: 2, page: 1 })).toEqual({ keyword: "máy hút bụi g10" });
    expect(demandFollowOffer({ q: "Máy hút bụi G10", total: 3, page: 1 })).toBeNull();
    expect(demandFollowOffer({ q: "Máy hút bụi G10", total: 0, page: 2 })).toBeNull();
    expect(demandFollowOffer({ q: "ab", total: 0, page: 1 })).toBeNull();
    expect(demandFollowOffer({ q: "shopee.vn/abc", total: 0, page: 1 })).toBeNull();
    expect(demandFollowOffer({ q: undefined, total: 0, page: 1 })).toBeNull();
  });
});
