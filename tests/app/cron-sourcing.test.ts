import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const configuredMarketplaces = vi.fn(() => ["shopee", "tiktok"]);
vi.mock("@/lib/marketplaces/sources", () => ({ configuredMarketplaces }));
const runSourcing = vi.fn(async () => ({ queries: 1, seen: 1, ingested: 1, skippedExisting: 0, failed: 0, aborted: false }));
vi.mock("@/lib/sourcing/run", () => ({ runSourcing, supabaseSourcingDeps: () => ({}) }));

const { POST } = await import("@/app/api/cron/sourcing/route");
const req = (auth = "Bearer s") => new Request("https://kairo.vn/api/cron/sourcing", { method: "POST", headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/cron/sourcing", () => {
  it("rejects a wrong secret", async () => {
    expect((await POST(req("Bearer x") as never)).status).toBe(401);
  });
  it("nothing configured → skipped", async () => {
    configuredMarketplaces.mockReturnValueOnce([]);
    expect(await (await POST(req() as never)).json()).toEqual({ skipped: "not_configured" });
  });
  it("runs every configured marketplace and releases the lock", async () => {
    const body = await (await POST(req() as never)).json();
    expect(Object.keys(body)).toEqual(["shopee", "tiktok"]);
    expect(runSourcing).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "sourcing" }));
  });
  it("splits the remaining time between marketplaces (the first does not starve the second)", async () => {
    const start = Date.now();
    await POST(req() as never);
    const calls = runSourcing.mock.calls as unknown as [{ deadline: number }][];
    const first = calls[0][0].deadline;
    const second = calls[1][0].deadline;
    expect(first).toBeLessThan(start + 50_000 - 10_000); // ≈ half of the remaining time
    expect(first).toBeLessThan(second);
    expect(second).toBeGreaterThanOrEqual(start + 50_000 - 1_000);
  });
  it("lock held → skipped", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await (await POST(req() as never)).json()).toEqual({ skipped: "locked" });
  });
});
