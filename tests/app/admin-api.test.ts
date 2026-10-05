import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const recomputeDealScores = vi.fn(async () => ({ scored: 3, tally: {} }));
vi.mock("@/lib/pricing/recompute-scores", () => ({ recomputeDealScores }));

const status = await import("@/app/api/admin/status/route");
const authorize = await import("@/app/api/admin/tiktok/authorize-url/route");
const recompute = await import("@/app/api/admin/deal-scores/recompute/route");

const req = (url: string, init: RequestInit = {}, auth = "Bearer s") =>
  new Request(`https://kairo.vn${url}`, { ...init, headers: { authorization: auth, "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_API_SECRET", "s");
  for (const k of ["SHOPEE_CLIENT", "TIKTOK_CLIENT", "SHOPEE_AFFILIATE_APP_ID", "SHOPEE_AFFILIATE_SECRET", "TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET", "TIKTOK_SHOP_SERVICE_ID"]) vi.stubEnv(k, "");
});

describe("admin API auth", () => {
  it("500 without ADMIN_API_SECRET, 401 with a wrong one", async () => {
    vi.stubEnv("ADMIN_API_SECRET", "");
    expect((await status.GET(req("/api/admin/status") as never)).status).toBe(500);
    vi.stubEnv("ADMIN_API_SECRET", "s");
    expect((await status.GET(req("/api/admin/status", {}, "Bearer x") as never)).status).toBe(401);
  });
});

describe("GET /api/admin/status", () => {
  it("lists marketplaces without leaking secrets", async () => {
    vi.stubEnv("SHOPEE_AFFILIATE_APP_ID", "app");
    vi.stubEnv("SHOPEE_AFFILIATE_SECRET", "topsecret");
    vi.stubEnv("SHOPEE_AFFILIATE_ID", "aff");
    const res = await status.GET(req("/api/admin/status") as never);
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.marketplaces.find((m: { id: string }) => m.id === "shopee")).toMatchObject({ configured: true, fake: false, affiliateLinks: true });
    expect(body.marketplaces.find((m: { id: string }) => m.id === "tiktok")).toMatchObject({ configured: false, affiliateLinks: false });
    expect(JSON.stringify(body)).not.toContain("topsecret");
  });
});

describe("POST /api/admin/tiktok/authorize-url", () => {
  it("409 when TikTok is not configured", async () => {
    expect((await authorize.POST(req("/api/admin/tiktok/authorize-url", { method: "POST" }) as never)).status).toBe(409);
  });
  it("returns a signed link and logs the action", async () => {
    vi.stubEnv("TIKTOK_SHOP_APP_KEY", "k");
    vi.stubEnv("TIKTOK_SHOP_APP_SECRET", "sec");
    vi.stubEnv("TIKTOK_SHOP_SERVICE_ID", "svc");
    vi.stubEnv("CRON_SECRET", "cron");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://kairo.vn");
    const res = await authorize.POST(req("/api/admin/tiktok/authorize-url", { method: "POST" }) as never);
    const body = await res.json();
    expect(new URL(body.url).searchParams.get("service_id")).toBe("svc");
    expect(body.redirectUri).toBe("https://kairo.vn/api/tiktok/oauth/callback");
    expect(rpc).toHaveBeenCalledWith("admin_log", expect.objectContaining({ p_action: "tiktok.authorize_link" }));
  });
});

describe("POST /api/admin/deal-scores/recompute", () => {
  it("recomputes the given variants", async () => {
    const res = await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: ["a", "b"] }) }) as never);
    expect(await res.json()).toEqual({ recomputed: 3 });
    expect(recomputeDealScores).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ variantIds: ["a", "b"] }));
  });
  it("400 for a bad body or > 500 ids", async () => {
    expect((await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: "{}" }) as never)).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => String(i));
    expect((await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: many }) }) as never)).status).toBe(400);
  });
});
