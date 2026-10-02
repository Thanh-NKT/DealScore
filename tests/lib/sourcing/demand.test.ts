import { describe, expect, it } from "vitest";
import { demandDailyCap, demandKeyword, shouldRecordDemand } from "@/lib/sourcing/demand";

describe("shouldRecordDemand", () => {
  it("only for a text query with < 3 results on page 1", () => {
    expect(shouldRecordDemand({ q: "tai nghe sony", total: 2, page: 1 })).toBe(true);
    expect(shouldRecordDemand({ q: "tai nghe sony", total: 3, page: 1 })).toBe(false);
    expect(shouldRecordDemand({ q: "tai nghe sony", total: 0, page: 2 })).toBe(false);
    expect(shouldRecordDemand({ q: "  ", total: 0, page: 1 })).toBe(false);
    expect(shouldRecordDemand({ q: undefined, total: 0, page: 1 })).toBe(false);
  });
});

describe("demandKeyword", () => {
  it("uses brands + category name + remaining text from the intent", () => {
    expect(demandKeyword("tai nghe sony dưới 2 triệu", { text: "", brands: ["Sony"], categoryName: "Tai nghe" })).toBe("sony tai nghe");
    expect(demandKeyword("Nồi chiên  KHÔNG dầu", { text: "Nồi chiên  KHÔNG dầu" })).toBe("nồi chiên không dầu");
  });

  it("falls back to the raw query without intent", () => {
    expect(demandKeyword("  Kem Chống Nắng  ")).toBe("kem chống nắng");
  });

  it("rejects junk and personal data", () => {
    expect(demandKeyword("ab")).toBeNull();
    expect(demandKeyword("x".repeat(61))).toBeNull();
    expect(demandKeyword("một hai ba bốn năm sáu bảy tám chín")).toBeNull();
    expect(demandKeyword("lien he 0912345678")).toBeNull();
    expect(demandKeyword("ban@example.com")).toBeNull();
    expect(demandKeyword("xem http://abc.vn")).toBeNull();
    expect(demandKeyword("www.abc.vn")).toBeNull();
    expect(demandKeyword("12345")).toBeNull();
    expect(demandKeyword("https://shopee.vn/product/1/2")).toBeNull();
  });

  it("rejects phone numbers with separators", () => {
    expect(demandKeyword("lien he 0912 345 678")).toBeNull();
    expect(demandKeyword("0912.345.678")).toBeNull();
    expect(demandKeyword("0912-345-678")).toBeNull();
    expect(demandKeyword("+84 912 345 678")).toBeNull();
    // Keep legitimate queries with separate short numbers
    expect(demandKeyword("ssd 1tb 2280")).toBe("ssd 1tb 2280");
    expect(demandKeyword("tai nghe sony wh1000xm5")).toBe("tai nghe sony wh1000xm5");
  });

  it("rejects bare domains", () => {
    expect(demandKeyword("abc.vn")).toBeNull();
    expect(demandKeyword("shop abc.com")).toBeNull();
    expect(demandKeyword("visit abc.info")).toBeNull();
    expect(demandKeyword("mypage abc.io")).toBeNull();
  });

  it("rejects obfuscated emails", () => {
    expect(demandKeyword("abc at gmail dot com")).toBeNull();
    expect(demandKeyword("abc[at]gmail")).toBeNull();
    expect(demandKeyword("abc(at)gmail.com")).toBeNull();
    expect(demandKeyword("user(a)example.com")).toBeNull();
    expect(demandKeyword("contact[at]store[dot]vn")).toBeNull();
    // Keep legitimate queries
    expect(demandKeyword("kem chống nắng at home")).toBe("kem chống nắng at home");
  });

  it("rejects scheme-less marketplace links", () => {
    expect(demandKeyword("shp.ee/xyz")).toBeNull();
    expect(demandKeyword("vt.tiktok.com/abc")).toBeNull();
  });
});

describe("demandDailyCap", () => {
  it("defaults to 100; 0 disables; junk → default", () => {
    expect(demandDailyCap({})).toBe(100);
    expect(demandDailyCap({ SOURCING_DEMAND_DAILY_CAP: "0" })).toBe(0);
    expect(demandDailyCap({ SOURCING_DEMAND_DAILY_CAP: "20" })).toBe(20);
    expect(demandDailyCap({ SOURCING_DEMAND_DAILY_CAP: "x" })).toBe(100);
  });

});

describe("demandKeyword — hostnames", () => {
  it("rejects www. and any dotted hostname, keeps decimal numbers", () => {
    expect(demandKeyword("www.abc.xyz")).toBeNull();
    expect(demandKeyword("abc.xyz")).toBeNull();
    expect(demandKeyword("ổ cứng 2.5 inch")).toBe("ổ cứng 2.5 inch");
    expect(demandKeyword("tai nghe sony wh1000xm5")).toBe("tai nghe sony wh1000xm5");
    expect(demandKeyword("ssd 1tb 2280")).toBe("ssd 1tb 2280");
  });
});
