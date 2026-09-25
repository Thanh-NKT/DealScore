import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));
const gate = vi.fn(async (_s: unknown, _id: string, next: string) => {
  throw new Redirect(next);
});
vi.mock("@/lib/auth/session", () => ({ redirectAfterLogin: (...a: [unknown, string, string]) => gate(...a) }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));

const { GET } = await import("@/app/auth/callback/route");

async function call(qs: string): Promise<string> {
  try {
    await GET(new Request(`https://kairo.vn/auth/callback?${qs}`) as never);
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  exchange.mockReset();
  gate.mockClear();
});

describe("GET /auth/callback", () => {
  it("exchanges the code, then runs the AuthGate with a safe next path", async () => {
    exchange.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect(await call("code=abc&next=%2Faccount%2Fwatch")).toBe("/account/watch");
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(gate).toHaveBeenCalledWith(expect.anything(), "u1", "/account/watch");
  });

  it("never follows an external next", async () => {
    exchange.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect(await call("code=abc&next=https%3A%2F%2Fevil.com")).toBe("/");
  });

  it("user refused Google consent → oauth_cancelled", async () => {
    expect(await call("error=access_denied&next=%2F")).toBe("/login?error=oauth_cancelled&next=%2F");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("bad or expired code → oauth_failed, no session", async () => {
    exchange.mockResolvedValue({ data: { user: null }, error: { message: "invalid grant" } });
    expect(await call("code=old")).toBe("/login?error=oauth_failed&next=%2F");
    expect(gate).not.toHaveBeenCalled();
  });
});
