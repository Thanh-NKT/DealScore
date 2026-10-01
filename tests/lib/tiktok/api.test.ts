import { describe, expect, it, vi } from "vitest";
import { callTikTok } from "@/lib/tiktok/api";
import { tiktokConfig } from "@/lib/tiktok/config";
import { signTikTokRequest } from "@/lib/tiktok/sign";
import { MarketplaceUnavailableError } from "@/lib/marketplaces/types";

const cfg = tiktokConfig({ TIKTOK_SHOP_APP_KEY: "key", TIKTOK_SHOP_APP_SECRET: "sec", TIKTOK_SHOP_SERVICE_ID: "svc" })!;
const now = () => new Date(1_700_000_000_000);
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("callTikTok", () => {
  it("signs app_key + timestamp + query + body and sends the token header", async () => {
    const f = reply({ code: 0, data: { ok: true } });
    const data = await callTikTok(cfg, "/p/1", { query: { page_size: "20" }, body: { a: 1 } }, { accessToken: "TOK", fetchImpl: f as never, now });
    expect(data).toEqual({ ok: true });
    const [rawUrl, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(rawUrl);
    const query = { app_key: "key", timestamp: "1700000000", page_size: "20" };
    expect(url.searchParams.get("sign")).toBe(signTikTokRequest({ path: "/p/1", query, body: '{"a":1}', secret: "sec" }));
    expect((init.headers as Record<string, string>)["x-tts-access-token"]).toBe("TOK");
    expect(init.body).toBe('{"a":1}');
  });

  it("429 / 5xx / network / token errors → MarketplaceUnavailableError", async () => {
    for (const f of [
      reply({}, 429),
      reply({}, 502),
      reply({ code: 105002, message: "access token expired" }),
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    ]) {
      await expect(callTikTok(cfg, "/p", {}, { accessToken: "T", fetchImpl: f as never, now })).rejects.toBeInstanceOf(
        MarketplaceUnavailableError,
      );
    }
  });

  it("other API error codes → plain Error with the code", async () => {
    await expect(
      callTikTok(cfg, "/p", {}, { accessToken: "T", fetchImpl: reply({ code: 12345, message: "bad param" }) as never, now }),
    ).rejects.toThrow("12345");
  });
});
