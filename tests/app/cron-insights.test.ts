import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const recomputeSellerProfiles = vi.fn(async () => ({ sellers: 1, written: 1, errors: 0, done: true }));
vi.mock("@/lib/sellers/profile-job", () => ({ recomputeSellerProfiles }));
const recomputeCategorySeasons = vi.fn(async () => ({ categories: 1, written: 1, errors: 0, done: true }));
vi.mock("@/lib/seasons/job", () => ({ recomputeCategorySeasons }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

const { POST } = await import("@/app/api/cron/insights/route");
const req = (auth = "Bearer s") => new Request("https://dealscore.vn/api/cron/insights", { method: "POST", headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/cron/insights", () => {
  it("401 without the secret", async () => {
    expect((await POST(req("Bearer x") as never)).status).toBe(401);
    expect(recomputeSellerProfiles).not.toHaveBeenCalled();
  });
  it("skips when locked", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await (await POST(req() as never)).json()).toEqual({ skipped: "locked" });
    expect(recomputeCategorySeasons).not.toHaveBeenCalled();
  });
  it("runs sellers then seasons and releases the lock", async () => {
    const body = await (await POST(req() as never)).json();
    expect(body.sellers.written).toBe(1);
    expect(body.seasons.written).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith("release_job_lock", expect.objectContaining({ p_name: "insights" }));
  });
});
