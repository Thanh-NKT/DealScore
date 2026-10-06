import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn<(opts: { scope: string }) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null })),
};
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

const throttleAuth = vi.fn<(action: string, input: unknown) => Promise<unknown>>(async () => null);
vi.mock("@/lib/auth/throttle", () => ({ throttleAuth: (action: string, input: unknown) => throttleAuth(action, input) }));
const requestHeaders = new Headers({ "x-real-ip": "203.0.113.7" });
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { signIn, signUp, resendConfirmation, requestPasswordReset, updatePassword } = await import("@/actions/auth");

const IDLE = { status: "idle" } as const;

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://dealscore.test";
});

describe("signIn", () => {
  it("malformed email / empty password → field errors, Supabase not called", async () => {
    const r = await signIn(IDLE, form({ email: "abc", password: "", next: "/" }));
    expect(r).toMatchObject({ status: "error", fields: { email: expect.any(String), password: "Nhập mật khẩu." } });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not apply sign-up rules to existing passwords", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(signIn(IDLE, form({ email: "an@dealscore.vn", password: "old", next: "/" }))).rejects.toMatchObject({ url: "/" });
  });

  it("wrong credentials → generic message", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", status: 400 } });
    const r = await signIn(IDLE, form({ email: " An@DealScore.VN ", password: "abc12345", next: "/x" }));
    expect(r).toMatchObject({ status: "error", error: { code: "invalid_credentials" }, email: "an@dealscore.vn", next: "/x" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "an@dealscore.vn", password: "abc12345" });
  });

  it("unconfirmed email → email_not_confirmed", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "email_not_confirmed", status: 400 } });
    const r = await signIn(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", next: "/" }));
    expect(r).toMatchObject({ status: "error", error: { code: "email_not_confirmed" } });
  });

  it("success → redirect to the sanitized next", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(
      signIn(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", next: "https://evil.com" })),
    ).rejects.toMatchObject({ url: "/" });
    await expect(
      signIn(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", next: "/ssd/a" })),
    ).rejects.toMatchObject({ url: "/ssd/a" });
  });
});

describe("signUp", () => {
  it("weak password → field error, Supabase not called", async () => {
    const r = await signUp(IDLE, form({ email: "an@dealscore.vn", password: "abcdefgh", next: "/" }));
    expect(r).toMatchObject({ status: "error", fields: { password: "Mật khẩu cần có ít nhất một chữ số." } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("confirmation differs → field error, Supabase not called", async () => {
    const r = await signUp(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", confirm: "abc12346", next: "/" }));
    expect(r).toMatchObject({ status: "error", fields: { confirm: "Hai mật khẩu chưa khớp nhau." } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("success → check_email with the confirm redirect", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [] }, session: null }, error: null });
    const r = await signUp(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", confirm: "abc12345", next: "/ssd/a" }));
    expect(r).toEqual({ status: "check_email", email: "an@dealscore.vn", next: "/ssd/a" });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "an@dealscore.vn",
      password: "abc12345",
      options: { emailRedirectTo: "https://dealscore.test/auth/confirm?next=%2Fssd%2Fa" },
    });
  });

  it("session returned (confirmations off) → signed in straight away", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: {} }, error: null });
    await expect(signUp(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", confirm: "abc12345", next: "/x" }))).rejects.toMatchObject({ url: "/x" });
  });
});

describe("resendConfirmation", () => {
  it("resends the signup email", async () => {
    auth.resend.mockResolvedValue({ data: {}, error: null });
    const r = await resendConfirmation(IDLE, form({ email: "an@dealscore.vn", next: "/" }));
    expect(r).toMatchObject({ status: "check_email" });
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "an@dealscore.vn",
      options: { emailRedirectTo: "https://dealscore.test/auth/confirm?next=%2F" },
    });
  });
});

describe("requestPasswordReset", () => {
  it("unknown email still answers check_email (no enumeration)", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: { code: "user_not_found", status: 404 } });
    const r = await requestPasswordReset(IDLE, form({ email: "ghost@dealscore.vn" }));
    expect(r).toMatchObject({ status: "check_email", email: "ghost@dealscore.vn" });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ghost@dealscore.vn", {
      redirectTo: "https://dealscore.test/auth/confirm?next=%2Freset-password",
    });
  });

  it("rate limited → error with wait time", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: { status: 429, message: "after 20 seconds" } });
    const r = await requestPasswordReset(IDLE, form({ email: "an@dealscore.vn" }));
    expect(r).toMatchObject({ status: "error", error: { code: "rate_limited", retryAfterSeconds: 20 } });
  });
});

describe("updatePassword", () => {
  it("no session → back to forgot-password", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }))).rejects.toMatchObject({
      url: "/forgot-password?error=link_expired",
    });
  });

  it("mismatched confirmation → field error, updateUser not called", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    const r = await updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12346" }));
    expect(r).toMatchObject({ status: "error", fields: { confirm: "Hai mật khẩu chưa khớp nhau." } });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("same password → same_password", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    auth.updateUser.mockResolvedValue({ data: {}, error: { code: "same_password", status: 422 } });
    const r = await updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }));
    expect(r).toMatchObject({ status: "error", error: { code: "same_password" } });
  });

  it("success → /account", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    await expect(updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }))).rejects.toMatchObject({
      url: "/account",
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "abc12345" });
    // Other sessions (a stolen token, an old device) are revoked; this one stays.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("revoking other sessions fails → the password change still succeeds", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    auth.signOut.mockResolvedValueOnce({ error: { message: "boom" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }))).rejects.toMatchObject({
      url: "/account",
    });
    log.mockRestore();
  });

  it("failed change → other sessions are not touched", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    auth.updateUser.mockResolvedValue({ data: {}, error: { code: "same_password", status: 422 } });
    await updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }));
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("reauthentication needed (session older than 24h) → ask for a new reset link", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    auth.updateUser.mockResolvedValue({ data: {}, error: { code: "reauthentication_needed", status: 400 } });
    const r = await updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }));
    expect(r).toMatchObject({ status: "error", error: { code: "link_expired" } });
  });
});

describe("app-level throttle in front of every auth call", () => {
  const LIMITED = { code: "rate_limited", message: "Bạn đã thử quá nhiều lần. Đợi khoảng 15 phút rồi thử lại.", retryAfterSeconds: 900 };

  it("counts each action with its own key, the normalized email and the request headers", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", status: 400 } });
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    auth.resend.mockResolvedValue({ data: {}, error: null });
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "An@DealScore.vn" } } });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });

    await signIn(IDLE, form({ email: " An@DealScore.VN ", password: "abc12345", next: "/" }));
    await signUp(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", confirm: "abc12345", next: "/" }));
    await resendConfirmation(IDLE, form({ email: "an@dealscore.vn", next: "/" }));
    await requestPasswordReset(IDLE, form({ email: "an@dealscore.vn" }));
    await updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" })).catch(() => undefined);

    expect(throttleAuth.mock.calls.map((c) => c[0])).toEqual(["sign_in", "sign_up", "resend", "reset", "update_password"]);
    for (const [, input] of throttleAuth.mock.calls) {
      expect(input).toEqual({ email: "an@dealscore.vn", headers: requestHeaders });
    }
  });

  it("invalid input is rejected locally and does not consume an attempt", async () => {
    await signIn(IDLE, form({ email: "bad", password: "", next: "/" }));
    await signUp(IDLE, form({ email: "an@dealscore.vn", password: "short", next: "/" }));
    await requestPasswordReset(IDLE, form({ email: "" }));
    expect(throttleAuth).not.toHaveBeenCalled();
  });

  it("throttled sign-in → rate_limited, Supabase not called", async () => {
    throttleAuth.mockResolvedValueOnce(LIMITED);
    const r = await signIn(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", next: "/x" }));
    expect(r).toEqual({ status: "error", error: LIMITED, email: "an@dealscore.vn", next: "/x" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("throttled sign-up / resend / reset → rate_limited, no email is sent", async () => {
    throttleAuth.mockResolvedValue(LIMITED);
    const states = [
      await signUp(IDLE, form({ email: "an@dealscore.vn", password: "abc12345", confirm: "abc12345", next: "/" })),
      await resendConfirmation(IDLE, form({ email: "an@dealscore.vn", next: "/" })),
      await requestPasswordReset(IDLE, form({ email: "ghost@dealscore.vn" })),
    ];
    throttleAuth.mockResolvedValue(null);
    for (const s of states) expect(s).toMatchObject({ status: "error", error: { code: "rate_limited" } });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.resend).not.toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("throttled password change → rate_limited, updateUser not called", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "an@dealscore.vn" } } });
    throttleAuth.mockResolvedValueOnce(LIMITED);
    const r = await updatePassword(IDLE, form({ password: "abc12345", confirm: "abc12345" }));
    expect(r).toMatchObject({ status: "error", error: { code: "rate_limited" } });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("no state ever echoes the password", () => {
  it("error states have no password key", async () => {
    const states = [
      await signUp(IDLE, form({ email: "an@dealscore.vn", password: "short", next: "/" })),
      await signIn(IDLE, form({ email: "bad", password: "abc12345", next: "/" })),
    ];
    for (const s of states) expect(JSON.stringify(s)).not.toContain("abc12345");
    for (const s of states) expect(s).not.toHaveProperty("password");
  });
});
