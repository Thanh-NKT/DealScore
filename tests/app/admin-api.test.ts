import { beforeEach, describe, expect, it, vi } from "vitest";

// try_acquire_job_lock registers the OAuth nonce; every other RPC (admin_log) answers null.
const rpcDefault = async (name: string) => ({ data: name === "try_acquire_job_lock" ? true : null, error: null });
const rpc = vi.fn(rpcDefault);
// variant_current_price rows that still exist after a recompute; variant_deal_scores deletions are recorded.
let priced: string[] = [];
const deletedScores: string[][] = [];
const from = vi.fn((table: string) => ({
  select: () => ({
    in: async (_col: string, ids: string[]) => ({
      data: table === "variant_current_price" ? ids.filter((i) => priced.includes(i)).map((variant_id) => ({ variant_id })) : [],
      error: null,
    }),
  }),
  delete: () => ({
    in: async (_col: string, ids: string[]) => {
      if (table === "variant_deal_scores") deletedScores.push(ids);
      return { error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
const recomputeDealScores = vi.fn(async () => ({ scored: 3, tally: {} }));
vi.mock("@/lib/pricing/recompute-scores", () => ({ recomputeDealScores }));

const loadAttributeTables = vi.fn(async (_db: unknown, ids: string[]) => ids.slice(0, 1).map((candidateId) => ({ candidateId, rows: [] })));
vi.mock("@/lib/matching/attribute-table", () => ({ loadAttributeTables }));

const status = await import("@/app/api/admin/status/route");
const authorize = await import("@/app/api/admin/tiktok/authorize-url/route");
const recompute = await import("@/app/api/admin/deal-scores/recompute/route");
const scan = await import("@/app/api/admin/price-anomalies/scan/route");
const attributes = await import("@/app/api/admin/matching/attributes/route");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const req = (url: string, init: RequestInit = {}, auth = "Bearer s") =>
  new Request(`https://dealscore.vn${url}`, { ...init, headers: { authorization: auth, "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(rpcDefault);
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

  it("exposes the collector refresh cadence from the DealScore constants", async () => {
    const { REFRESH_INTERVAL_HOURS } = await import("@/lib/collector/schedule");
    const { STALE_HOURS } = await import("@/lib/watch/constants");
    const body = await (await status.GET(req("/api/admin/status") as never)).json();
    expect(body.collector).toEqual({
      refreshIntervalHours: { "1": REFRESH_INTERVAL_HOURS[1], "2": REFRESH_INTERVAL_HOURS[2], "3": REFRESH_INTERVAL_HOURS[3] },
      watchedPriority: 1,
      staleHours: STALE_HOURS,
    });
    expect(body.collector.refreshIntervalHours).toEqual({ "1": 2, "2": 6, "3": 24 });
    // Older keys stay (backward compatible).
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["marketplaces", "cronSecretSet", "siteUrl", "collector"]));
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
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://dealscore.vn");
    const res = await authorize.POST(req("/api/admin/tiktok/authorize-url", { method: "POST" }) as never);
    const body = await res.json();
    expect(new URL(body.url).searchParams.get("service_id")).toBe("svc");
    expect(rpc).toHaveBeenCalledWith("try_acquire_job_lock", expect.objectContaining({ p_owner: "oauth-state", p_ttl_seconds: 1800 }));
    expect(body.redirectUri).toBe("https://dealscore.vn/api/tiktok/oauth/callback");
    expect(rpc).toHaveBeenCalledWith("admin_log", expect.objectContaining({ p_action: "tiktok.authorize_link" }));
  });
});

describe("POST /api/admin/deal-scores/recompute", () => {
  it("recomputes the given variants", async () => {
    const res = await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: [A, B] }) }) as never);
    expect(await res.json()).toEqual({ recomputed: 3 });
    expect(recomputeDealScores).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ variantIds: [A, B] }));
  });
  it("deletes stale scores of variants that lost their current price", async () => {
    priced = [A];
    deletedScores.length = 0;
    const res = await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: [A, B] }) }) as never);
    expect(res.status).toBe(200);
    expect(deletedScores).toEqual([[B]]);
  });
  it("deletes nothing when every variant still has a price", async () => {
    priced = [A, B];
    deletedScores.length = 0;
    await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: [A, B] }) }) as never);
    expect(deletedScores).toEqual([]);
  });
  it("reads and deletes in chunks of at most 200 ids", async () => {
    const many = Array.from({ length: 450 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    priced = [];
    deletedScores.length = 0;
    const res = await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: many }) }) as never);
    expect(res.status).toBe(200);
    expect(deletedScores.map((d) => d.length)).toEqual([200, 200, 50]);
  });
  it("400 for a bad body or > 500 ids", async () => {
    expect((await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: "{}" }) as never)).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: many }) }) as never)).status).toBe(400);
  });
  it("400 for non-UUID ids", async () => {
    expect((await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: ["a"] }) }) as never)).status).toBe(400);
  });
  it("500 JSON with no-store when recompute throws", async () => {
    recomputeDealScores.mockRejectedValueOnce(new Error("boom"));
    const res = await recompute.POST(req("/api/admin/deal-scores/recompute", { method: "POST", body: JSON.stringify({ variantIds: [A] }) }) as never);
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("authorize-url nonce registration", () => {
  it("500 and no link when the nonce cannot be registered", async () => {
    vi.stubEnv("TIKTOK_SHOP_APP_KEY", "k"); vi.stubEnv("TIKTOK_SHOP_APP_SECRET", "sec"); vi.stubEnv("TIKTOK_SHOP_SERVICE_ID", "svc");
    rpc.mockImplementation((async () => ({ data: null, error: { message: "db down" } })) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await authorize.POST(req("/api/admin/tiktok/authorize-url", { method: "POST" }) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("authorize-url audit failure", () => {
  const env = () => { vi.stubEnv("TIKTOK_SHOP_APP_KEY", "k"); vi.stubEnv("TIKTOK_SHOP_APP_SECRET", "sec"); vi.stubEnv("TIKTOK_SHOP_SERVICE_ID", "svc"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://dealscore.vn"); };
  const failAdminLog = (result: () => Promise<unknown>) =>
    rpc.mockImplementation((async (name: string) => (name === "admin_log" ? result() : rpcDefault(name))) as never);
  it("still returns the link when admin_log returns an error", async () => {
    env();
    failAdminLog(async () => ({ data: null, error: { message: "x" } }));
    const res = await authorize.POST(req("/api/admin/tiktok/authorize-url", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("svc");
  });
  it("still returns the link when admin_log rejects", async () => {
    env();
    failAdminLog(async () => { throw new Error("down"); });
    const res = await authorize.POST(req("/api/admin/tiktok/authorize-url", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("svc");
  });
});

describe("GET /api/admin/status anomalies", () => {
  it("exposes the detection thresholds from the DealScore constants", async () => {
    const c = await import("@/lib/anomalies/constants");
    const body = await (await status.GET(req("/api/admin/status") as never)).json();
    expect(body.anomalies).toEqual({
      spikeRatio: c.ANOMALY_SPIKE_RATIO, dropRatio: c.ANOMALY_DROP_RATIO, baselineDays: c.ANOMALY_BASELINE_DAYS,
      minBaselineObs: c.ANOMALY_MIN_BASELINE_OBS, scanMaxHours: c.ANOMALY_SCAN_MAX_HOURS,
    });
  });
});

describe("POST /api/admin/price-anomalies/scan", () => {
  const post = (body: unknown, auth?: string) =>
    scan.POST(req("/api/admin/price-anomalies/scan", { method: "POST", body: JSON.stringify(body) }, auth) as never);

  it("401 without the right secret, and no RPC", async () => {
    expect((await post({ hours: 24 }, "Bearer x")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400 for hours 0, 169, a string or a fraction", async () => {
    for (const hours of [0, 169, "24", 1.5, null]) {
      const res = await post({ hours });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scans the last N hours with the thresholds and returns { inserted }", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "detect_price_anomalies" ? 3 : null, error: null }) as never);
    const before = Date.now();
    const res = await post({ hours: 24 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ inserted: 3 });
    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("detect_price_anomalies");
    expect(args).toMatchObject({ p_baseline_days: 30, p_spike_ratio: 3, p_drop_ratio: 0.4, p_min_baseline_obs: 5 });
    expect(args).not.toHaveProperty("p_offer_ids");
    const since = Date.parse(args.p_since as string);
    expect(before - since).toBeGreaterThanOrEqual(24 * 3_600_000 - 5_000);
    expect(before - since).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
  });

  it("500 internal when the RPC fails", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "boom" } }) as never);
    const res = await post({ hours: 1 });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("POST /api/admin/matching/attributes", () => {
  const post = (body: unknown, auth?: string) =>
    attributes.POST(req("/api/admin/matching/attributes", { method: "POST", body: JSON.stringify(body) }, auth) as never);

  it("401 without the right secret", async () => {
    expect((await post({ candidateIds: [A] }, "Bearer x")).status).toBe(401);
    expect(loadAttributeTables).not.toHaveBeenCalled();
  });

  it("400 for 0 ids, 51 ids, non-uuid ids or a bad body", async () => {
    const many = Array.from({ length: 51 }, () => A);
    for (const body of [{ candidateIds: [] }, { candidateIds: many }, { candidateIds: ["x"] }, { candidateIds: A }, {}]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(loadAttributeTables).not.toHaveBeenCalled();
  });

  it("returns { items } from the loader (gone candidates already dropped there)", async () => {
    const res = await post({ candidateIds: [A, B] });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ items: [{ candidateId: A, rows: [] }] });
    expect(loadAttributeTables).toHaveBeenCalledWith(expect.anything(), [A, B]);
  });

  it("500 internal when loading fails", async () => {
    loadAttributeTables.mockRejectedValueOnce(new Error("db down"));
    const res = await post({ candidateIds: [A] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});
