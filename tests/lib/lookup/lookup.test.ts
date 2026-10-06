import { beforeEach, describe, expect, it, vi } from "vitest";

const beginLookup = vi.fn(async () => ({ allowed: true, requestId: 7 }));
const beginIngest = vi.fn(async () => ({ allowed: true }));
const finishLookup = vi.fn(async () => undefined);
vi.mock("@/lib/rate-limit", () => ({ beginLookup, beginIngest, finishLookup }));
const findExistingProductUrl = vi.fn(async () => null as string | null);
const ingestProduct = vi.fn(async () => ({ status: "ingested", productUrl: "/tai-nghe/sony" }));
vi.mock("@/lib/ingest", () => ({ findExistingProductUrl, ingestProduct }));
const configured = new Set<string>();
vi.mock("@/lib/marketplaces/sources", () => ({
  getSource: (id: string) => (id === "lazada" ? null : { isConfigured: () => configured.has(id) }),
}));
vi.mock("@/lib/lookup/resolve-redirect", () => ({ resolveProductRedirect: vi.fn() }));

const { lookupProductUrl } = await import("@/lib/lookup");
const call = (raw: string) => lookupProductUrl({ raw, ipHash: "h", userId: null });

beforeEach(() => {
  vi.clearAllMocks();
  configured.clear();
});

describe("lookupProductUrl", () => {
  it("TikTok configured → ingests through the generic path", async () => {
    configured.add("tiktok");
    expect(await call("https://www.tiktok.com/view/product/1729384756")).toEqual({ status: "ingested", productUrl: "/tai-nghe/sony" });
    expect(findExistingProductUrl).toHaveBeenCalledWith({ marketplace: "tiktok", externalItemId: "1729384756" });
    expect(ingestProduct).toHaveBeenCalledWith("tiktok", "1729384756");
  });

  it("TikTok not configured → not_shopee with market, before any quota", async () => {
    expect(await call("https://www.tiktok.com/view/product/1729384756")).toEqual({ status: "error", code: "not_shopee", market: "TikTok Shop" });
    expect(await call("https://www.lazada.vn/products/x-i123456.html")).toEqual({ status: "error", code: "not_shopee", market: "Lazada" });
    expect(beginLookup).not.toHaveBeenCalled();
  });

  it("Shopee not configured keeps the old answer (upstream_unavailable) after quota", async () => {
    expect(await call("https://shopee.vn/product/1/2")).toMatchObject({ status: "error", code: "upstream_unavailable" });
  });

  it("unknown host → not_shopee without market; garbage → unrecognized_format path unchanged", async () => {
    expect(await call("https://evil.com/x")).toEqual({ status: "error", code: "not_shopee" });
  });

  it("ingest quota denied → the lookup row is closed as rejected, not left pending", async () => {
    configured.add("shopee");
    beginIngest.mockResolvedValueOnce({ allowed: false, reason: "global_daily", retryAfterSeconds: 86_400 } as never);
    expect(await call("https://shopee.vn/product/1/2")).toMatchObject({ status: "error", code: "upstream_unavailable" });
    expect(finishLookup).toHaveBeenCalledWith(7, "rejected");
    expect(ingestProduct).not.toHaveBeenCalled();
  });

  it("existing listing → ok without ingest", async () => {
    configured.add("shopee");
    findExistingProductUrl.mockResolvedValueOnce("/ssd/x");
    expect(await call("https://shopee.vn/product/1/2")).toEqual({ status: "ok", productUrl: "/ssd/x" });
    expect(ingestProduct).not.toHaveBeenCalled();
    expect(findExistingProductUrl).toHaveBeenCalledWith({ marketplace: "shopee", externalItemId: "1_2" });
  });
});
