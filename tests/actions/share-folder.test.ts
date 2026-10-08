import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser: { id: string } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://dealscore.vn" }));
let folderExists = true;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: folderExists ? { id: "f" } : null, error: null }) }) }) }),
    }),
  }),
}));
const inserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { shareFolder } = await import("@/actions/share-folder");
const F = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  currentUser = { id: "u1" };
  folderExists = true;
  inserts.length = 0;
});

describe("shareFolder", () => {
  it("signed out → unauthenticated", async () => {
    currentUser = null;
    expect(await shareFolder(F, {})).toEqual({ ok: false, error: "unauthenticated" });
  });
  it("rejects an e-mail display name before any write", async () => {
    const r = await shareFolder(F, { displayName: "a@b.vn" });
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    expect(inserts).toEqual([]);
  });
  it("someone else's folder → not_found", async () => {
    folderExists = false;
    expect(await shareFolder(F, {})).toEqual({ ok: false, error: "not_found" });
  });
  it("the token is made on the server (43 chars), never taken from the input", async () => {
    const r = await shareFolder(F, { token: "x".repeat(43), title: "Quà" });
    expect(r.ok).toBe(true);
    expect(inserts[0].token).not.toBe("x".repeat(43));
    expect(String(inserts[0].token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inserts[0]).toMatchObject({ folder_id: F, user_id: "u1", title: "Quà", show_prices: true, show_notes: false });
    expect(r.ok && r.url).toBe(`https://dealscore.vn/shared/${inserts[0].token}`);
  });
});
