import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const reportError = vi.fn();
vi.mock("@/lib/observability", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const { AUTH_LIMITS, throttleAuth } = await import("@/lib/auth/throttle");
const { hashIp } = await import("@/lib/rate-limit");

const headers = new Headers({ "x-real-ip": "203.0.113.7" });

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("throttleAuth", () => {
  it("counts the hashed IP and the hashed email under the action's window", async () => {
    expect(await throttleAuth("sign_in", { email: "an@kairo.vn", headers })).toBeNull();
    const { windowSeconds, perIp, perEmail } = AUTH_LIMITS.sign_in;
    expect(rpc).toHaveBeenCalledWith("rate_hit", {
      p_key: `auth:sign_in:ip:${hashIp("203.0.113.7")}`,
      p_window_seconds: windowSeconds,
      p_limit: perIp,
    });
    expect(rpc).toHaveBeenCalledWith("rate_hit", {
      p_key: `auth:sign_in:email:${hashIp("email:an@kairo.vn")}`,
      p_window_seconds: windowSeconds,
      p_limit: perEmail,
    });
    // Neither raw IP nor raw email is stored in a key.
    for (const [, args] of rpc.mock.calls) {
      expect(args.p_key).not.toContain("203.0.113.7");
      expect(args.p_key).not.toContain("an@kairo.vn");
      expect(args.p_key.length).toBeLessThanOrEqual(200);
    }
  });

  it("over the IP or the email limit → a Vietnamese rate_limited error", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const r = await throttleAuth("reset", { email: "an@kairo.vn", headers });
    expect(r).toEqual({
      code: "rate_limited",
      message: "Bạn đã thử quá nhiều lần. Đợi khoảng 60 phút rồi thử lại.",
      retryAfterSeconds: AUTH_LIMITS.reset.windowSeconds,
    });
  });

  it("a counter failure lets the attempt through and is reported", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await throttleAuth("sign_up", { email: "an@kairo.vn", headers })).toBeNull();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), { where: "auth_throttle", action: "sign_up" });
  });

  it("every action has sane limits", () => {
    for (const l of Object.values(AUTH_LIMITS)) {
      expect(l.perEmail).toBeGreaterThan(0);
      expect(l.perIp).toBeGreaterThanOrEqual(l.perEmail);
      expect(l.windowSeconds).toBeGreaterThanOrEqual(60);
    }
  });
});
