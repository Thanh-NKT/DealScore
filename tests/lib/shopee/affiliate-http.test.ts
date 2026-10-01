import { afterEach, describe, expect, it, vi } from "vitest";
import { callShopeeAffiliate, ShopeeAffiliateError, shopeeAffiliateCredentials } from "@/lib/shopee/affiliate-http";

afterEach(() => vi.unstubAllGlobals());
const creds = { appId: "app", secret: "s", url: "https://api.test/graphql" };
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("shopeeAffiliateCredentials", () => {
  it("needs app id and secret; URL has a default", () => {
    expect(shopeeAffiliateCredentials({ SHOPEE_AFFILIATE_APP_ID: "a" })).toBeNull();
    expect(shopeeAffiliateCredentials({ SHOPEE_AFFILIATE_APP_ID: "a", SHOPEE_AFFILIATE_SECRET: "b" })).toEqual({
      appId: "a",
      secret: "b",
      url: "https://open-api.affiliate.shopee.vn/graphql",
    });
  });
});

describe("callShopeeAffiliate", () => {
  it("returns data and sends the signed header", async () => {
    const f = reply({ data: { ok: 1 } });
    vi.stubGlobal("fetch", f);
    await expect(callShopeeAffiliate(creds, "{ ok }", {})).resolves.toEqual({ ok: 1 });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(String((init.headers as Record<string, string>).Authorization)).toMatch(/^SHA256 Credential=app, Timestamp=\d+, Signature=[0-9a-f]{64}$/);
  });

  it("rate limit error 10030 is retryable", async () => {
    vi.stubGlobal("fetch", reply({ errors: [{ message: "rate limit", extensions: { code: 10030 } }] }));
    await expect(callShopeeAffiliate(creds, "{ ok }", {})).rejects.toMatchObject({ retryable: true });
    vi.stubGlobal("fetch", reply({ errors: [{ message: "Error 10030: too many requests" }] }));
    await expect(callShopeeAffiliate(creds, "{ ok }", {})).rejects.toMatchObject({ retryable: true });
  });

  it("other GraphQL errors are not retryable; 429/5xx are", async () => {
    vi.stubGlobal("fetch", reply({ errors: [{ message: "bad field" }] }));
    await expect(callShopeeAffiliate(creds, "{ ok }", {})).rejects.toMatchObject({ retryable: false });
    vi.stubGlobal("fetch", reply({}, 503));
    await expect(callShopeeAffiliate(creds, "{ ok }", {})).rejects.toMatchObject({ retryable: true });
  });

  it("network failure is retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const err = await callShopeeAffiliate<never>(creds, "{ ok }", {}).catch((e: unknown) => e as ShopeeAffiliateError);
    expect(err).toBeInstanceOf(ShopeeAffiliateError);
    expect(err.retryable).toBe(true);
  });
});
