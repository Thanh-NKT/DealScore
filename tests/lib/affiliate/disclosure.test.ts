import { describe, expect, it } from "vitest";
import { withAffiliateDisclosure } from "@/lib/affiliate/disclosure";

describe("withAffiliateDisclosure", () => {
  it("sets buy.affiliate from the eligible set, leaves items without buy alone", () => {
    const items = [
      { id: "a", buy: { offerId: "o1", marketplace: "shopee", affiliate: false } },
      { id: "b", buy: { offerId: "o2", marketplace: "tiktok", affiliate: true } },
      { id: "c", buy: null },
    ];
    const out = withAffiliateDisclosure(items, new Set(["o1"]));
    expect(out.map((i) => i.buy?.affiliate ?? null)).toEqual([true, false, null]);
    expect(out[2]).toBe(items[2]);
    expect(items[0].buy?.affiliate).toBe(false); // input not mutated
  });
});
