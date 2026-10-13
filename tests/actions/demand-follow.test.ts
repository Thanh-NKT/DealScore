import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser: { id: string } | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/marketplaces/sources", () => ({ configuredMarketplaces: () => ["shopee"] }));
vi.mock("@/lib/search/resolve-params", () => ({
  resolveSearchParams: async (raw: { q: string }) => ({ params: raw, applied: [] }),
}));
let searchTotal = 1;
vi.mock("@/lib/search", async (orig) => ({
  ...(await orig<typeof import("@/lib/search")>()),
  searchProducts: async () => ({
    items: Array.from({ length: searchTotal }, (_, i) => ({ productId: `p${i}` })),
    total: searchTotal,
    page: 1,
    pageSize: 24,
  }),
}));
const upserts: Array<Record<string, unknown>> = [];
let upsertError: { code: string; message: string } | null = null;
const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return {
          select: () => ({
            single: async () =>
              upsertError ? { data: null, error: upsertError } : { data: { id: "f1", expires_at: row.expires_at }, error: null },
          }),
        };
      },
    }),
  }),
}));

const { followDemand } = await import("@/actions/demand-follow");

beforeEach(() => {
  currentUser = null;
  searchTotal = 1;
  upserts.length = 0;
  upsertError = null;
  rpc.mockClear();
});

describe("followDemand", () => {
  it("signed out → unauthenticated, nothing written", async () => {
    expect(await followDemand({ q: "máy hút bụi g10" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(upserts).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores only the cleaned keyword (recomputed, lower-cased), ≤ 3 known ids, waiting + expiry; queues sourcing", async () => {
    currentUser = { id: "u1" };
    searchTotal = 2;
    const r = await followDemand({ q: "  Máy Hút   Bụi G10 " });
    expect(r).toMatchObject({ ok: true, id: "f1" });
    expect(upserts).toHaveLength(1);
    expect(Object.keys(upserts[0]).sort()).toEqual(
      ["expires_at", "found_at", "keyword", "known_product_ids", "last_checked_at", "status", "user_id"].sort(),
    );
    expect(upserts[0]).toMatchObject({ user_id: "u1", keyword: "máy hút bụi g10", known_product_ids: ["p0", "p1"], status: "waiting" });
    expect(rpc).toHaveBeenCalledWith("request_sourcing_query", expect.objectContaining({ p_value: "máy hút bụi g10" }));
  });

  it("not eligible when the search has ≥ 3 results or the keyword is an e-mail / phone", async () => {
    currentUser = { id: "u1" };
    searchTotal = 3;
    expect(await followDemand({ q: "ssd samsung" })).toEqual({ ok: false, error: "not_eligible" });
    searchTotal = 0;
    expect(await followDemand({ q: "a@b.com" })).toEqual({ ok: false, error: "not_eligible" });
    expect(await followDemand({ q: "0912 345 678" })).toEqual({ ok: false, error: "not_eligible" });
    expect(upserts).toEqual([]);
  });

  it("the 11th waiting follow → limit", async () => {
    currentUser = { id: "u1" };
    upsertError = { code: "23514", message: "Bạn đang chờ tối đa 10 tìm kiếm." };
    expect(await followDemand({ q: "máy hút bụi g10" })).toEqual({ ok: false, error: "limit" });
  });
});
