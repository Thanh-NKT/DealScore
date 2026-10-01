import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn(async () => undefined);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/tiktok/credentials", () => ({ supabaseTokenStore: () => ({ save }) }));
const exchangeCode = vi.fn();
vi.mock("@/lib/tiktok/oauth", async (orig) => ({
  ...(await orig<typeof import("@/lib/tiktok/oauth")>()),
  exchangeCode: (...a: unknown[]) => exchangeCode(...a),
}));

const { GET } = await import("@/app/api/tiktok/oauth/callback/route");
const { signState } = await import("@/lib/tiktok/oauth");
const req = (q: string) => new Request(`https://kairo.vn/api/tiktok/oauth/callback?${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron");
  vi.stubEnv("TIKTOK_SHOP_APP_KEY", "key");
  vi.stubEnv("TIKTOK_SHOP_APP_SECRET", "sec");
  vi.stubEnv("TIKTOK_SHOP_SERVICE_ID", "svc");
});

describe("GET /api/tiktok/oauth/callback", () => {
  it("valid state → exchanges code, saves tokens, never echoes them", async () => {
    exchangeCode.mockResolvedValue({ accessToken: "SECRET-A", refreshToken: "SECRET-R", accessExpiresAt: new Date(), refreshExpiresAt: new Date() });
    const res = await GET(req(`code=C1&state=${signState("cron", new Date())}`) as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Đã kết nối TikTok Shop");
    expect(text).not.toContain("SECRET");
    expect(exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ appKey: "key" }), "C1");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("bad or expired state → 400, no exchange", async () => {
    const old = signState("cron", new Date(Date.now() - 31 * 60_000));
    for (const q of ["code=C1&state=nope", `code=C1&state=${old}`, `state=${signState("cron", new Date())}`]) {
      const res = await GET(req(q) as never);
      expect(res.status).toBe(400);
    }
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("TikTok not configured → 503", async () => {
    vi.stubEnv("TIKTOK_SHOP_APP_KEY", "");
    const res = await GET(req(`code=C1&state=${signState("cron", new Date())}`) as never);
    expect(res.status).toBe(503);
  });

  it("exchange failure → 502 without details", async () => {
    exchangeCode.mockRejectedValue(new Error("TikTok token endpoint error 36004004"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET(req(`code=C1&state=${signState("cron", new Date())}`) as never);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("36004004");
  });
});
