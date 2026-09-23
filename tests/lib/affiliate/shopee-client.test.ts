import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopeeAffiliateClient, ShopeeAffiliateError, signRequest } from "@/lib/affiliate/shopee-client";

describe("signRequest (G4)", () => {
  it("vector cố định", () => {
    expect(signRequest({ appId: "app123", secret: "s3cret", timestamp: 1700000000, payload: '{"query":"{ ping }"}' })).toBe(
      "SHA256 Credential=app123, Timestamp=1700000000, Signature=ebda1232379f7c692607e4787e2994dca9f58fc42c40f745adb00319b649595e",
    );
  });
});

describe("createShopeeAffiliateClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("thiếu khóa → null", () => {
    expect(createShopeeAffiliateClient({})).toBeNull();
  });

  it("gửi đúng header, trải nodes thành đơn, trả scrollId kế tiếp", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            conversionReport: {
              nodes: [
                {
                  purchaseTime: 1790000000,
                  utmContent: "abc-web",
                  orders: [{ orderId: "O1", orderStatus: "PENDING", items: [{ itemId: 1, qty: 1 }] }],
                },
              ],
              pageInfo: { scrollId: "next", hasNextPage: true },
            },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const c = createShopeeAffiliateClient({ SHOPEE_AFFILIATE_APP_ID: "a", SHOPEE_AFFILIATE_SECRET: "s" })!;
    const r = await c.conversionReport({ start: new Date(0), end: new Date(1000), scrollId: null, limit: 500 });
    expect(r.nextScrollId).toBe("next");
    expect(r.orders[0]).toMatchObject({ orderId: "O1", purchaseTime: 1790000000, utmContent: "abc-web", items: [{ itemId: 1 }] });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^SHA256 Credential=a, Timestamp=\d+, Signature=[0-9a-f]{64}$/);
  });

  it("5xx → retryable; lỗi GraphQL → không retryable", async () => {
    const c = createShopeeAffiliateClient({ SHOPEE_AFFILIATE_APP_ID: "a", SHOPEE_AFFILIATE_SECRET: "s" })!;
    const q = { start: new Date(0), end: new Date(1), scrollId: null, limit: 1 };

    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    await expect(c.conversionReport(q)).rejects.toMatchObject({ retryable: true });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "bad field" }] }))));
    const err = await c.conversionReport(q).catch((e) => e);
    expect(err).toBeInstanceOf(ShopeeAffiliateError);
    expect(err.retryable).toBe(false);
  });
});
