import { describe, expect, it } from "vitest";
import { precheckLookup } from "@/components/lookup/use-lookup";

describe("precheckLookup", () => {
  it("TikTok video link → not_shopee + TikTok Shop", () => {
    expect(precheckLookup("https://www.tiktok.com/@user/video/7300000000000000000")).toEqual({ code: "not_shopee", market: "TikTok Shop" });
  });
  it("Lazada category link → not_shopee + Lazada", () => {
    expect(precheckLookup("https://www.lazada.vn/dien-thoai/")).toEqual({ code: "not_shopee", market: "Lazada" });
  });
  it("Shopee shop link → unrecognized_format", () => {
    expect(precheckLookup("https://shopee.vn/some_shop")).toEqual({ code: "unrecognized_format", market: undefined });
  });
  it("plain text → not_a_url", () => {
    expect(precheckLookup("tai nghe sony")).toEqual({ code: "not_a_url", market: undefined });
  });
  it("random host link → not_shopee without market", () => {
    expect(precheckLookup("https://evil.com/x")).toEqual({ code: "not_shopee", market: undefined });
  });
  it("product link passes", () => {
    expect(precheckLookup("https://shopee.vn/product/1/2")).toBeNull();
  });
});
