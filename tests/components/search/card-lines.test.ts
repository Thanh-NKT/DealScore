import { describe, expect, it } from "vitest";
import { cardSourceLine, fakeSaleNote } from "@/components/search/card-lines";

const text = (l: ReturnType<typeof cardSourceLine>) => (l ? `${l.lead}${l.count ?? ""}${l.tail}` : null);

describe("cardSourceLine", () => {
  it("from 2 offers: cheapest marketplace + count", () => {
    expect(text(cardSourceLine(2, "Shopee"))).toBe("Rẻ nhất ở Shopee · 2 nơi bán");
    expect(text(cardSourceLine(5, null))).toBe("5 nơi bán");
  });
  it("under 2 or unknown: where it was recorded, or nothing", () => {
    expect(text(cardSourceLine(1, "TikTok Shop"))).toBe("Ghi nhận trên TikTok Shop");
    expect(text(cardSourceLine(null, null))).toBeNull();
  });
});

describe("fakeSaleNote", () => {
  it("copy per kind", () => {
    expect(fakeSaleNote("list_inflated", 30)).toContain("giá niêm yết ghi giảm 30%");
    expect(fakeSaleNote("list_inflated", null)).not.toContain("%");
    expect(fakeSaleNote("pre_sale_hike", 30)).toBe("Giá vừa được nâng lên trước đợt giảm này.");
  });
});
