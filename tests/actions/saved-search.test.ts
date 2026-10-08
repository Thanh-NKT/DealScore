import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser: { id: string } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));
// Intent: "nồi chiên dưới 2 triệu" → category + price (what /search would apply).
vi.mock("@/lib/search/resolve-params", () => ({
  resolveSearchParams: async (raw: { q?: string }) =>
    raw.q === "nồi chiên dưới 2 triệu"
      ? { params: { ...raw, q: "nồi chiên", categorySlug: "noi-chien", maxPrice: 2_000_000 }, applied: [] }
      : { params: raw, applied: [] },
}));
const inserts: Array<Record<string, unknown>> = [];
let insertError: { code: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "s1" }, error: null }) }) };
      },
    }),
  }),
}));

const { saveSearch } = await import("@/actions/saved-search");

beforeEach(() => {
  currentUser = { id: "u1" };
  inserts.length = 0;
  insertError = null;
});

describe("saveSearch", () => {
  it("signed out → unauthenticated", async () => {
    currentUser = null;
    expect(await saveSearch({ query: "q=ssd&max=1000" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(inserts).toEqual([]);
  });
  it("stores the intent-applied params, drops sort / page / prefs; default name", async () => {
    expect(await saveSearch({ query: "q=nồi chiên dưới 2 triệu&sort=deal_score&page=2&prefs=1" })).toEqual({ ok: true, id: "s1" });
    expect(inserts[0]).toEqual({
      name: "nồi chiên · dưới 2 triệu",
      params: { q: "nồi chiên", categorySlug: "noi-chien", maxPrice: 2_000_000 },
    });
  });
  it("needs a condition (price or Nên mua) and a scope", async () => {
    expect(await saveSearch({ query: "q=ssd" })).toEqual({ ok: false, error: "no_condition" });
    expect(await saveSearch({ query: "max=1000" })).toEqual({ ok: false, error: "no_scope" });
    expect(await saveSearch({ query: "q=ssd", onlyBuy: true })).toEqual({ ok: true, id: "s1" });
    expect(inserts.at(-1)!.params).toEqual({ q: "ssd", onlyBuy: true });
  });
  it("maps the DB errors", async () => {
    insertError = { code: "23514" };
    expect(await saveSearch({ query: "q=ssd&max=1" })).toEqual({ ok: false, error: "limit" });
    insertError = { code: "23505" };
    expect(await saveSearch({ query: "q=ssd&max=1" })).toEqual({ ok: false, error: "duplicate" });
  });
  it("rejects a name over 60 characters", async () => {
    expect(await saveSearch({ query: "q=ssd&max=1", name: "x".repeat(61) })).toEqual({ ok: false, error: "invalid" });
  });
});
