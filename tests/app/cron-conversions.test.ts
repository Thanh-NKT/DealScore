import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const pullConversions = vi.fn();
vi.mock("@/lib/affiliate/import", () => ({ pullConversions }));
const createShopeeAffiliateClient = vi.fn();
vi.mock("@/lib/affiliate/shopee-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/affiliate/shopee-client")>()),
  createShopeeAffiliateClient,
}));

const { POST } = await import("@/app/api/cron/conversions/route");
const { ShopeeAffiliateError } = await import("@/lib/affiliate/shopee-client");
const req = () =>
  new Request("https://dealscore.vn/api/cron/conversions", { method: "POST", headers: { authorization: "Bearer s" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  createShopeeAffiliateClient.mockReturnValue({});
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/cron/conversions", () => {
  it("API not configured → skipped, 200", async () => {
    createShopeeAffiliateClient.mockReturnValue(null);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "not_configured" });
  });
  it("retryable error → 503, lock still released", async () => {
    pullConversions.mockRejectedValue(new ShopeeAffiliateError("rate", true));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req() as never);
    expect(res.status).toBe(503);
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "conversions" }));
  });
  it("success → 200 with stats", async () => {
    pullConversions.mockResolvedValue({ pages: 1, rows: 2, rejected: 0, inserted: 2, updated: 0, matched: 1, complete: true });
    const res = await POST(req() as never);
    expect(await res.json()).toMatchObject({ inserted: 2, matched: 1 });
  });
  it("incomplete pull → reported, 503 with the stats and error 'incomplete'", async () => {
    pullConversions.mockResolvedValue({
      pages: 9, rows: 2, rejected: 0, inserted: 2, updated: 0, matched: 1, complete: false, pulledFrom: "2026-09-01T00:00:00.000Z",
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req() as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "incomplete", complete: false, inserted: 2 });
    expect(err).toHaveBeenCalledWith("reportError", expect.objectContaining({ job: "conversions" }), expect.any(Error));
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "conversions" }));
  });
  it("lock RPC error → reported and thrown", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(POST(req() as never)).rejects.toThrow("Failed to acquire lock");
    expect(err).toHaveBeenCalledWith("reportError", expect.objectContaining({ job: "conversions" }), expect.any(Error));
  });
});
