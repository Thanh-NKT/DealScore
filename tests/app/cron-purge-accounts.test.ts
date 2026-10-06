import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/cron", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cron")>();
  return { ...actual, acquireJobLock: async () => "owner", releaseJobLock: async () => undefined };
});
const purgeDeletedAccounts = vi.fn();
vi.mock("@/lib/account/purge", () => ({ purgeDeletedAccounts: (...a: unknown[]) => purgeDeletedAccounts(...a) }));
const reportError = vi.fn();
vi.mock("@/lib/observability", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const { GET } = await import("@/app/api/cron/purge-accounts/route");
const req = () => new Request("https://kairo.vn/api/cron/purge-accounts", { headers: { authorization: "Bearer s" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
});

describe("GET /api/cron/purge-accounts", () => {
  it("passes a time budget and reports a backlog of due accounts (count only)", async () => {
    purgeDeletedAccounts.mockResolvedValue({ purged: ["a"], failed: [], remaining: 7 });
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 1, failed: 0, remaining: 7 });
    const [opts] = purgeDeletedAccounts.mock.calls[0] as [{ deadline: number }];
    expect(opts.deadline).toBeGreaterThan(Date.now());
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), { job: "purge-accounts", remaining: 7 });
  });

  it("empty backlog → no report", async () => {
    purgeDeletedAccounts.mockResolvedValue({ purged: [], failed: [], remaining: 0 });
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    expect(reportError).not.toHaveBeenCalled();
  });
});
