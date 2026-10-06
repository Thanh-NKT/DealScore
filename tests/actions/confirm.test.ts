import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { verifyOtp: vi.fn() };
const profile = { data: { consent_version: "2026-09-23", deleted_at: null }, error: null };
const client = {
  auth,
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => profile }) }) })),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));

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

const { confirmEmailLink } = await import("@/actions/confirm");
const { default: ConfirmPage } = await import("@/app/auth/confirm/page");

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe("/auth/confirm page (GET)", () => {
  it("renders the confirm button and never spends the token (link scanners)", async () => {
    const page = await ConfirmPage({ searchParams: Promise.resolve({ token_hash: "abc", type: "recovery", next: "/x" }) });
    expect(page).toBeTruthy();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    // The hidden fields carry the token to the POST.
    const html = JSON.stringify(page);
    expect(html).toContain('"value":"abc"');
    expect(html).toContain('"value":"recovery"');
  });

  it("broken link → straight to the matching failure page", async () => {
    await expect(ConfirmPage({ searchParams: Promise.resolve({ type: "recovery" }) })).rejects.toMatchObject({
      url: "/forgot-password?error=link_expired",
    });
    await expect(ConfirmPage({ searchParams: Promise.resolve({ token_hash: "abc", type: "magiclink" }) })).rejects.toMatchObject({
      url: "/login?error=link_expired&next=%2F",
    });
  });
});

describe("confirmEmailLink (POST)", () => {
  it("recovery → verifies the token, then /reset-password", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(confirmEmailLink(form({ token_hash: "abc", type: "recovery", next: "/" }))).rejects.toMatchObject({
      url: "/reset-password",
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "recovery" });
  });

  it("signup confirmation → signed in, to the sanitized next", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(confirmEmailLink(form({ token_hash: "abc", type: "email", next: "/ssd/a" }))).rejects.toMatchObject({
      url: "/ssd/a",
    });
    await expect(confirmEmailLink(form({ token_hash: "abc", type: "email", next: "/.//evil.com" }))).rejects.toMatchObject({
      url: "/",
    });
  });

  it("expired or used token → link_expired on the matching page", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired", status: 403 } });
    await expect(confirmEmailLink(form({ token_hash: "abc", type: "recovery" }))).rejects.toMatchObject({
      url: "/forgot-password?error=link_expired",
    });
    await expect(confirmEmailLink(form({ token_hash: "abc", type: "signup", next: "/x" }))).rejects.toMatchObject({
      url: "/login?error=link_expired&next=%2Fx",
    });
  });

  it("missing fields → link_expired without calling Supabase", async () => {
    await expect(confirmEmailLink(form({ type: "signup" }))).rejects.toMatchObject({ url: "/login?error=link_expired&next=%2F" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});
