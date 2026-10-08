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
// Breadth check (P4 review I2): how many products the saved params match today.
let matchTotal = 3;
vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  searchProductsWith: vi.fn(async () => ({ items: [], total: matchTotal, page: 1, pageSize: 24 })),
}));
// The immediate baseline runs in after(): collect the callbacks, run them by hand.
const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
const evaluateSavedSearches = vi.fn(async () => ({ evaluated: 1, alerts: 0, suppressed: 0, skipped: 0, errors: 0 }));
vi.mock("@/lib/saved-search/evaluate", () => ({ evaluateSavedSearches }));
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
  matchTotal = 3;
  afterCallbacks.length = 0;
  evaluateSavedSearches.mockClear();
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
  it("baselines the new search right after the save, scoped to its id", async () => {
    expect(await saveSearch({ query: "q=ssd&max=1000" })).toEqual({ ok: true, id: "s1" });
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(evaluateSavedSearches).toHaveBeenCalledWith(expect.objectContaining({ ids: ["s1"] }));
  });
  it("more matches than SAVED_SEARCH_MATCH_CAP → too_broad, nothing stored", async () => {
    const { SAVED_SEARCH_MATCH_CAP } = await import("@/lib/saved-search/constants");
    matchTotal = SAVED_SEARCH_MATCH_CAP + 1;
    expect(await saveSearch({ query: "q=ssd&max=1000" })).toEqual({ ok: false, error: "too_broad" });
    expect(inserts).toEqual([]);
    matchTotal = SAVED_SEARCH_MATCH_CAP;
    expect(await saveSearch({ query: "q=ssd&max=1000" })).toEqual({ ok: true, id: "s1" });
  });
  it("rejects a name over 60 characters", async () => {
    expect(await saveSearch({ query: "q=ssd&max=1", name: "x".repeat(61) })).toEqual({ ok: false, error: "invalid" });
  });
});
