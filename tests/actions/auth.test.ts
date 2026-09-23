import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { signInWithOtp: vi.fn(), verifyOtp: vi.fn() };
const profile = { data: { consent_version: "2026-09-23", deleted_at: null }, error: null };
const client = {
  auth,
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => profile }) }) })),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const { requestLoginCode, verifyLoginCode } = await import("@/actions/auth");

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://kairo.test";
});

describe("requestLoginCode", () => {
  it("malformed email → error, Supabase not called", async () => {
    const r = await requestLoginCode({ status: "idle" }, form({ email: "abc", next: "/" }));
    expect(r).toMatchObject({ status: "error", error: { code: "invalid_email" } });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends with emailRedirectTo carrying the sanitized ?next=", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const r = await requestLoginCode(
      { status: "idle" },
      form({ email: " An@Kairo.VN ", next: "https://evil.com" }),
    );
    expect(r).toEqual({ status: "sent", email: "an@kairo.vn", next: "/" });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "an@kairo.vn",
      options: { shouldCreateUser: true, emailRedirectTo: "https://kairo.test/auth/confirm?next=%2F" },
    });
  });

  it("rate limit error → mapped to rate_limited", async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit", message: "after 30 seconds", status: 429 },
    });
    const r = await requestLoginCode({ status: "idle" }, form({ email: "an@kairo.vn", next: "/x" }));
    expect(r).toMatchObject({ status: "error", error: { code: "rate_limited", retryAfterSeconds: 30 }, next: "/x" });
  });
});

describe("verifyLoginCode", () => {
  it("code not exactly 6 digits → otp_invalid, Supabase not called", async () => {
    const r = await verifyLoginCode({ status: "idle" }, form({ email: "an@kairo.vn", token: "12ab", next: "/" }));
    expect(r).toMatchObject({ status: "error", error: { code: "otp_invalid" } });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("success → redirect to next", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(
      verifyLoginCode({ status: "idle" }, form({ email: "an@kairo.vn", token: "123456", next: "/ssd/a" })),
    ).rejects.toMatchObject({ url: "/ssd/a" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "an@kairo.vn", token: "123456", type: "email" });
  });

  it("expired code → otp_expired", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired", status: 403 } });
    const r = await verifyLoginCode({ status: "idle" }, form({ email: "an@kairo.vn", token: "123456", next: "/" }));
    expect(r).toMatchObject({ status: "error", error: { code: "otp_expired" } });
  });
});
