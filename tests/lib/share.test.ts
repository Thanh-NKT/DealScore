import { describe, expect, it } from "vitest";
import { isShareVisit, shareText, shareUrl } from "@/lib/share";

const p = { slug: "wd-sn850x", categorySlug: "ssd", canonicalName: "SSD WD SN850X", price: 2_390_000, recommendation: "buy" as const };

describe("share", () => {
  it("links to the canonical page with ref=share", () => {
    expect(shareUrl("https://dealscore.vn", p)).toBe("https://dealscore.vn/ssd/wd-sn850x?ref=share");
  });
  it("text has name, price and verdict", () => {
    expect(shareText(p)).toBe("SSD WD SN850X — 2.390.000đ (Nên mua) trên DealScore");
  });
  it("text drops the price when there is none, and the verdict when not scored", () => {
    expect(shareText({ ...p, price: null, recommendation: "insufficient_data" })).toBe("SSD WD SN850X trên DealScore");
  });
  it("detects visits coming from a shared link", () => {
    expect(isShareVisit("share")).toBe(true);
    expect(isShareVisit(["share"])).toBe(true);
    expect(isShareVisit(undefined)).toBe(false);
    expect(isShareVisit("email")).toBe(false);
  });
});
