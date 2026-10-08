import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const evaluateSavedSearches = vi.fn(async () => ({ evaluated: 1, alerts: 1, suppressed: 0, errors: 0 }));
vi.mock("@/lib/saved-search/evaluate", () => ({ evaluateSavedSearches }));
const checkDemandFollows = vi.fn(async () => ({ checked: 1, found: 0, expired: 0, deferred: 0, errors: 0 }));
vi.mock("@/lib/demand-follow/check", () => ({ checkDemandFollows }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

const { POST } = await import("@/app/api/cron/discovery-alerts/route");
const req = (auth = "Bearer s") =>
  new Request("https://dealscore.vn/api/cron/discovery-alerts", { method: "POST", headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/cron/discovery-alerts", () => {
  it("401 without the secret, nothing runs", async () => {
    expect((await POST(req("Bearer x") as never)).status).toBe(401);
    expect(evaluateSavedSearches).not.toHaveBeenCalled();
  });
  it("lock held → skipped", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await (await POST(req() as never)).json()).toEqual({ skipped: "locked" });
    expect(checkDemandFollows).not.toHaveBeenCalled();
  });
  it("runs saved searches then follows; a failure in one does not stop the other; releases the lock", async () => {
    evaluateSavedSearches.mockRejectedValueOnce(new Error("boom"));
    const body = await (await POST(req() as never)).json();
    expect(body.savedSearches).toEqual({ error: "failed" });
    expect(body.demandFollows.checked).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "discovery-alerts" }));
  });
});
