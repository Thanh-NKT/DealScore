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
  new Request("https://kairo.vn/api/cron/conversions", { method: "POST", headers: { authorization: "Bearer s" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  createShopeeAffiliateClient.mockReturnValue({});
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/cron/conversions", () => {
  it("chưa cấu hình API → skipped, 200", async () => {
    createShopeeAffiliateClient.mockReturnValue(null);
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "not_configured" });
  });
  it("lỗi retryable → 503, vẫn nhả lock", async () => {
    pullConversions.mockRejectedValue(new ShopeeAffiliateError("rate", true));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req() as never);
    expect(res.status).toBe(503);
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "conversions" }));
  });
  it("thành công → 200 kèm số liệu", async () => {
    pullConversions.mockResolvedValue({ pages: 1, rows: 2, rejected: 0, inserted: 2, updated: 0, matched: 1, complete: true });
    const res = await POST(req() as never);
    expect(await res.json()).toMatchObject({ inserted: 2, matched: 1 });
  });
});
