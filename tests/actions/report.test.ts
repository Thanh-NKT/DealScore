import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser: { id: string } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "198.51.100.4" }) }));

const { submitDataReport } = await import("@/actions/report");
const { networkPrefix, rateKeyHash } = await import("@/lib/rate-limit");
const C = await import("@/lib/reports/constants");

const P = "11111111-1111-4111-8111-111111111111";
const input = { productId: P, variantId: null, offerId: null, kind: "wrong_price" as const, message: null };

function rpcOk(over: { underLimit?: (key: string) => boolean; submit?: unknown; submitError?: string } = {}) {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "rate_hit") return { data: over.underLimit ? over.underLimit(args.p_key as string) : true, error: null };
    if (fn === "submit_data_report")
      return over.submitError ? { data: null, error: { message: over.submitError } } : { data: over.submit ?? { id: "r1", duplicate: false }, error: null };
    throw new Error(fn);
  });
}
const keys = () => rpc.mock.calls.filter((c) => c[0] === "rate_hit").map((c) => c[1]);
const submitted = () => rpc.mock.calls.find((c) => c[0] === "submit_data_report")?.[1].p;

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  rpcOk();
});

describe("submitDataReport", () => {
  it("guest → hashed network key (3/h) + global cap; no user id", async () => {
    expect(await submitDataReport(input)).toEqual({ ok: true, duplicate: false });
    expect(keys()).toEqual([
      { p_key: `report:ip:${rateKeyHash(networkPrefix("198.51.100.4"))}`, p_window_seconds: 3600, p_limit: C.REPORTS_PER_HOUR_GUEST },
      { p_key: "report:all", p_window_seconds: 86_400, p_limit: C.REPORTS_PER_DAY_GLOBAL },
    ]);
    expect(submitted()).toMatchObject({ product_id: P, user_id: null, dedup_hours: C.REPORT_DEDUP_HOURS });
  });

  it("member → per-user key (10/h); user id from the session, never the input", async () => {
    currentUser = { id: "u1" };
    rpcOk({ submit: { id: "r1", duplicate: true } });
    const forged = { ...input, userId: "someone-else" } as typeof input;
    expect(await submitDataReport(forged)).toEqual({ ok: true, duplicate: true });
    expect(keys()[0]).toEqual({ p_key: "report:u:u1", p_window_seconds: 3600, p_limit: C.REPORTS_PER_HOUR_USER });
    expect(submitted().user_id).toBe("u1");
  });

  it("over the per-user or the global cap → rate_limited, no insert", async () => {
    rpcOk({ underLimit: (k) => k !== "report:all" });
    expect(await submitDataReport(input)).toEqual({ ok: false, error: "rate_limited" });
    expect(submitted()).toBeUndefined();
  });

  it("throttle error → unavailable and no RPC insert", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "rate_hit" ? { data: null, error: { message: "down" } } : { data: {}, error: null }));
    expect(await submitDataReport(input)).toEqual({ ok: false, error: "unavailable" });
    expect(submitted()).toBeUndefined();
  });

  it("bad shape → invalid before any RPC", async () => {
    expect(await submitDataReport({ ...input, productId: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("RPC business refusal → invalid; other errors → unavailable", async () => {
    rpcOk({ submitError: "submit_data_report: tin bán không thuộc sản phẩm này" });
    expect(await submitDataReport(input)).toEqual({ ok: false, error: "invalid" });
    rpcOk({ submitError: "connection reset" });
    expect(await submitDataReport(input)).toEqual({ ok: false, error: "unavailable" });
  });
});
