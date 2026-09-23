import { describe, expect, it } from "vitest";
import { buildAffiliateUrl, decodeClickId, encodeClickId, encodeSubId, parseSubId } from "@/lib/affiliate/link";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const HEX = "3f2a1b4c5d6e4f708a9b0c1d2e3f4a5b";
const ORIGIN = "https://shopee.vn/product/123/456";

describe("encodeClickId / decodeClickId", () => {
  it("khứ hồi", () => {
    expect(encodeClickId(ID)).toBe(HEX);
    expect(decodeClickId(HEX)).toBe(ID);
  });
  it("chữ hoa vẫn nhận; sai độ dài / ký tự → null", () => {
    expect(decodeClickId(HEX.toUpperCase())).toBe(ID);
    expect(decodeClickId(HEX.slice(1))).toBeNull();
    expect(decodeClickId(`${HEX.slice(1)}z`)).toBeNull();
  });
});

describe("encodeSubId / parseSubId", () => {
  it.each(["web", "extension", "email", "push"] as const)("khứ hồi với %s", (src) => {
    expect(parseSubId(encodeSubId(ID, src))).toEqual({ clickId: ID, source: src });
  });
  it("clickId null → chỉ nguồn", () => {
    expect(encodeSubId(null, "email")).toBe("email");
    expect(parseSubId("email")).toEqual({ clickId: null, source: "email" });
  });
  it("nhận mảng đã tách sẵn, và thứ tự slot đảo", () => {
    expect(parseSubId([HEX, "push"])).toEqual({ clickId: ID, source: "push" });
    expect(parseSubId(["push", HEX])).toEqual({ clickId: ID, source: "push" });
  });
  it("rác → null / unknown, không ném", () => {
    expect(parseSubId("abc-xyz")).toEqual({ clickId: null, source: "unknown" });
    expect(parseSubId(null)).toEqual({ clickId: null, source: "unknown" });
    expect(parseSubId([])).toEqual({ clickId: null, source: "unknown" });
  });
});

describe("buildAffiliateUrl", () => {
  const base = {
    mode: "an_redir" as const,
    originUrl: ORIGIN,
    affiliateId: "17300000000",
    subId: `${HEX}-web`,
    shortLink: null,
    eligible: true,
  };

  it("an_redir: đúng tham số, origin_link đã encode", () => {
    const r = buildAffiliateUrl(base);
    expect(r.kind).toBe("affiliate");
    const u = new URL(r.url);
    expect(`${u.origin}${u.pathname}`).toBe("https://s.shopee.vn/an_redir");
    expect(u.searchParams.get("origin_link")).toBe(ORIGIN);
    expect(u.searchParams.get("affiliate_id")).toBe("17300000000");
    expect(u.searchParams.get("sub_id")).toBe(`${HEX}-web`);
    expect(r.url).toContain(`origin_link=${encodeURIComponent(ORIGIN)}`);
  });
  it("thiếu affiliateId → origin", () => {
    expect(buildAffiliateUrl({ ...base, affiliateId: null })).toEqual({ url: ORIGIN, kind: "origin" });
  });
  it("eligible = false → origin", () => {
    expect(buildAffiliateUrl({ ...base, eligible: false })).toEqual({ url: ORIGIN, kind: "origin" });
  });
  it("short_link: có → dùng nguyên; không → origin", () => {
    expect(buildAffiliateUrl({ ...base, mode: "short_link", shortLink: "https://s.shopee.vn/abc" })).toEqual({
      url: "https://s.shopee.vn/abc",
      kind: "affiliate",
    });
    expect(buildAffiliateUrl({ ...base, mode: "short_link" })).toEqual({ url: ORIGIN, kind: "origin" });
  });
  it("originUrl không phải Shopee → ném (lỗi dữ liệu)", () => {
    expect(() => buildAffiliateUrl({ ...base, originUrl: "https://evil.com/x" })).toThrow();
  });
});
