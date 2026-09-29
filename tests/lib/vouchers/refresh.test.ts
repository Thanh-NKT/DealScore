import { afterEach, describe, expect, it, vi } from "vitest";
import { canRefreshVouchers } from "@/lib/vouchers/refresh";
import { getAdapter } from "@/lib/marketplaces";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canRefreshVouchers", () => {
  it("is false while the Shopee API is not configured", () => {
    vi.stubEnv("SHOPEE_CLIENT", "");
    expect(canRefreshVouchers("shopee")).toBe(false);
  });

  it("is true for Shopee listings once the Shopee source is configured", () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    expect(canRefreshVouchers("shopee")).toBe(true);
  });

  it("the Shopee adapter reads a listing's images and vouchers (dev fake source)", async () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    const detail = await getAdapter("shopee")!.fetchListingDetail!("123_456");
    expect(detail.source).toBe("seed");
    expect(Array.isArray(detail.images)).toBe(true);
    expect(Array.isArray(detail.vouchers)).toBe(true);
  });

  it("is false for marketplaces without a data source yet (TikTok Shop, Lazada)", () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    expect(canRefreshVouchers("lazada")).toBe(false);
    expect(canRefreshVouchers("tiktok")).toBe(false);
    expect(canRefreshVouchers("unknown")).toBe(false);
  });
});
