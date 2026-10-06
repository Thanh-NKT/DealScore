import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser: { id: string } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const trackAfter = vi.fn();
vi.mock("@/lib/analytics/track", () => ({ trackAfter: (...a: unknown[]) => trackAfter(...a) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "198.51.100.4" }) }));

const { recordShare } = await import("@/actions/share");
const { SHARE_EVENTS_PER_HOUR } = await import("@/lib/analytics/events");
const { hashIp } = await import("@/lib/rate-limit");

const PID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("recordShare", () => {
  it("anonymous → counted per hashed IP, then tracked", async () => {
    await recordShare(PID, "copy");
    expect(rpc).toHaveBeenCalledWith("rate_hit", {
      p_key: `share:ip:${hashIp("198.51.100.4")}`,
      p_window_seconds: 3600,
      p_limit: SHARE_EVENTS_PER_HOUR,
    });
    expect(trackAfter).toHaveBeenCalledWith("deal_shared", { userId: null, props: { product_id: PID, method: "copy" } });
  });

  it("signed in → counted per user", async () => {
    currentUser = { id: "u1" };
    await recordShare(PID, "native");
    expect(rpc.mock.calls[0][1].p_key).toBe("share:u:u1");
    expect(trackAfter).toHaveBeenCalledWith("deal_shared", { userId: "u1", props: { product_id: PID, method: "native" } });
  });

  it("over the limit → event dropped", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await recordShare(PID, "copy");
    expect(trackAfter).not.toHaveBeenCalled();
  });

  it("throttle error → event dropped, never throws", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordShare(PID, "copy")).resolves.toBeUndefined();
    expect(trackAfter).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
