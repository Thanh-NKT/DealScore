import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const evaluateWatches = vi.fn(async () => ({ evaluated: 1, alerts: 1, suppressed: 0, skippedStale: 0, errors: 0 }));
const dispatchDueDeliveries = vi.fn(async () => ({ sent: 1, failed: 0, retried: 0, skipped: 0 }));
vi.mock("@/lib/alerts/evaluate", () => ({ evaluateWatches }));
vi.mock("@/lib/alerts/dispatch", () => ({ dispatchDueDeliveries }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));

const { POST } = await import("@/app/api/cron/alerts/route");
const req = (auth?: string) =>
  new Request("https://dealscore.vn/api/cron/alerts", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
});

describe("POST /api/cron/alerts", () => {
  it("missing CRON_SECRET → 500", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("Bearer s") as never)).status).toBe(500);
  });
  it("sai header → 401", async () => {
    expect((await POST(req("Bearer x") as never)).status).toBe(401);
  });
  it("lock not acquired → skipped", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(req("Bearer s") as never);
    expect(await res.json()).toEqual({ skipped: "locked" });
    expect(evaluateWatches).not.toHaveBeenCalled();
  });
  it("runs both stages then releases the lock", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(req("Bearer s") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ evaluate: { alerts: 1 }, dispatch: { sent: 1 } });
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "alerts" }));
  });
});
