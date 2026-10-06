import { describe, expect, it, vi } from "vitest";
import { tiktokConfig } from "@/lib/tiktok/config";
import {
  buildAuthorizeUrl,
  consumeState,
  exchangeCode,
  oauthStateKey,
  parseTokenResponse,
  refreshTokens,
  registerState,
  signState,
  STATE_TTL_MS,
  verifyState,
} from "@/lib/tiktok/oauth";

const env = { TIKTOK_SHOP_APP_KEY: "key", TIKTOK_SHOP_APP_SECRET: "sec", TIKTOK_SHOP_SERVICE_ID: "svc" };
const cfg = tiktokConfig(env)!;
const now = new Date("2026-10-01T00:00:00Z");

describe("tiktokConfig", () => {
  it("needs key, secret and service id; hosts have defaults", () => {
    expect(tiktokConfig({ TIKTOK_SHOP_APP_KEY: "key" })).toBeNull();
    expect(cfg).toEqual({
      appKey: "key",
      appSecret: "sec",
      serviceId: "svc",
      apiUrl: "https://open-api.tiktokglobalshop.com",
      authUrl: "https://auth.tiktok-shops.com",
      authorizeUrl: "https://services.tiktokshop.com/open/authorize",
    });
  });
});

describe("state", () => {
  it("round-trips within 30 minutes and returns its nonce", () => {
    const s = signState("k", now, "AAAAAAAAAAAAAAAAAAAAAA");
    expect(verifyState("k", s, new Date(now.getTime() + STATE_TTL_MS - 1000))).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(signState("k", now)).not.toBe(signState("k", now)); // a fresh random nonce each time
  });
  it("rejects expired, wrong key, tampered, malformed", () => {
    const s = signState("k", now);
    expect(verifyState("k", s, new Date(now.getTime() + STATE_TTL_MS + 1000))).toBeNull();
    expect(verifyState("other", s, now)).toBeNull();
    expect(verifyState("k", s.replace(/.$/, (c) => (c === "a" ? "b" : "a")), now)).toBeNull();
    const [ts, , sig] = s.split(".");
    expect(verifyState("k", `${ts}.BBBBBBBBBBBBBBBBBBBBBB.${sig}`, now)).toBeNull(); // nonce swapped
    expect(verifyState("k", "garbage", now)).toBeNull();
    expect(verifyState("k", "", now)).toBeNull();
  });
  it("the key derives from ADMIN_API_SECRET, never CRON_SECRET", () => {
    expect(oauthStateKey({ CRON_SECRET: "cron" })).toBeNull();
    const k = oauthStateKey({ ADMIN_API_SECRET: "admin" });
    expect(k).toHaveLength(43);
    expect(k).not.toBe("admin");
  });
});

describe("single-use nonce", () => {
  it("registers the nonce as a 30-minute job lock and consumes it with one conditional update", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const select = vi.fn(async () => ({ data: [{ name: "x" }], error: null }));
    const filters: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.eq = (...a: unknown[]) => (filters.push(["eq", ...a]), chain);
    chain.gt = (...a: unknown[]) => (filters.push(["gt", ...a]), chain);
    chain.select = select;
    const update = vi.fn(() => chain);
    const client = { rpc, from: vi.fn(() => ({ update })) } as never;

    const s = signState("k", now, "CCCCCCCCCCCCCCCCCCCCCC");
    await registerState(client, s);
    expect(rpc).toHaveBeenCalledWith("try_acquire_job_lock", { p_name: "tiktok-oauth:CCCCCCCCCCCCCCCCCCCCCC", p_owner: "oauth-state", p_ttl_seconds: 1800 });

    expect(await consumeState(client, "CCCCCCCCCCCCCCCCCCCCCC", now)).toBe(true);
    expect(update).toHaveBeenCalledWith({ locked_until: "-infinity" });
    expect(filters).toContainEqual(["gt", "locked_until", now.toISOString()]);
    select.mockResolvedValueOnce({ data: [], error: null });
    expect(await consumeState(client, "CCCCCCCCCCCCCCCCCCCCCC", now)).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("adds service_id and state", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "st"));
    expect(url.origin + url.pathname).toBe("https://services.tiktokshop.com/open/authorize");
    expect(url.searchParams.get("service_id")).toBe("svc");
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("tokens (T3)", () => {
  const body = {
    code: 0,
    data: { access_token: "A", access_token_expire_in: 1790000000, refresh_token: "R", refresh_token_expire_in: 1800000000 },
  };

  it("parses epoch-second expiries", () => {
    expect(parseTokenResponse(body)).toEqual({
      accessToken: "A",
      accessExpiresAt: new Date(1790000000 * 1000),
      refreshToken: "R",
      refreshExpiresAt: new Date(1800000000 * 1000),
    });
  });

  it("rejects error responses and missing fields without echoing tokens", () => {
    expect(() => parseTokenResponse({ code: 36004004, message: "invalid code" })).toThrow("36004004");
    expect(() => parseTokenResponse({ code: 0, data: { access_token: "A" } })).toThrow("token response");
  });

  it("exchangeCode calls token/get with authorized_code", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(body)));
    await exchangeCode(cfg, "CODE", f as unknown as typeof fetch);
    const url = new URL(String((f.mock.calls[0] as unknown as [string])[0]));
    expect(url.pathname).toBe("/api/v2/token/get");
    expect(Object.fromEntries(url.searchParams)).toEqual({ app_key: "key", app_secret: "sec", auth_code: "CODE", grant_type: "authorized_code" });
  });

  it("refreshTokens calls token/refresh with refresh_token", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(body)));
    await refreshTokens(cfg, "R0", f as unknown as typeof fetch);
    const url = new URL(String((f.mock.calls[0] as unknown as [string])[0]));
    expect(url.pathname).toBe("/api/v2/token/refresh");
    expect(url.searchParams.get("refresh_token")).toBe("R0");
    expect(url.searchParams.get("grant_type")).toBe("refresh_token");
  });
});
