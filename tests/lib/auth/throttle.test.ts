import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const reportError = vi.fn();
vi.mock("@/lib/observability", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const { AUTH_LIMITS, throttleAuth } = await import("@/lib/auth/throttle");
const { rateKeyHash } = await import("@/lib/rate-limit");

const headers = new Headers({ "x-real-ip": "203.0.113.7" });

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("throttleAuth", () => {
  it("counts the hashed IP and the hashed email + network under the action's window", async () => {
    expect(await throttleAuth("sign_in", { email: "an@kairo.vn", headers })).toBeNull();
    const { windowSeconds, perIp, perEmail } = AUTH_LIMITS.sign_in;
    expect(rpc).toHaveBeenCalledWith("rate_hit", {
      p_key: `auth:sign_in:ip:${rateKeyHash("203.0.113.7")}`,
      p_window_seconds: windowSeconds,
      p_limit: perIp,
    });
    expect(rpc).toHaveBeenCalledWith("rate_hit", {
      p_key: `auth:sign_in:email:${rateKeyHash("email:an@kairo.vn|net:203.0.113.0/24")}`,
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

  it("the email bucket is per network: attempts from another network never touch the user's own", async () => {
    await throttleAuth("sign_in", { email: "an@kairo.vn", headers: new Headers({ "x-real-ip": "198.51.100.9" }) });
    await throttleAuth("sign_in", { email: "an@kairo.vn", headers: new Headers({ "x-real-ip": "203.0.113.200" }) });
    const emailKeys = rpc.mock.calls.map(([, a]) => a.p_key as string).filter((k) => k.includes(":email:"));
    expect(emailKeys).toHaveLength(2);
    expect(emailKeys[0]).not.toBe(emailKeys[1]);
    // Same /24 as the first test's 203.0.113.7: same bucket.
    expect(emailKeys[1]).toBe(`auth:sign_in:email:${rateKeyHash("email:an@kairo.vn|net:203.0.113.0/24")}`);
  });

  it("without LOOKUP_IP_SALT in production it still counts both keys and reports the configuration error", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { salt: env.LOOKUP_IP_SALT, node: env.NODE_ENV };
    try {
      delete env.LOOKUP_IP_SALT;
      env.NODE_ENV = "production";
      rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
      const r = await throttleAuth("sign_in", { email: "an@kairo.vn", headers });
      expect(r?.code).toBe("rate_limited");
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), { where: "auth_throttle_config", action: "sign_in" });
    } finally {
      env.NODE_ENV = saved.node;
      if (saved.salt === undefined) delete env.LOOKUP_IP_SALT;
      else env.LOOKUP_IP_SALT = saved.salt;
    }
  });

  it("every action has sane limits", () => {
    for (const l of Object.values(AUTH_LIMITS)) {
      expect(l.perEmail).toBeGreaterThan(0);
      expect(l.perIp).toBeGreaterThanOrEqual(l.perEmail);
      expect(l.windowSeconds).toBeGreaterThanOrEqual(60);
    }
  });
});
