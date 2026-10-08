import { beforeEach, describe, expect, it, vi } from "vitest";

// Final review Minor 2: a follow whose search or record RPC throws must move last_checked_at (back off), or it
// heads the due queue every run and starves the others — the saved-search evaluator's touch(), mirrored.
const { searchProductsWith } = vi.hoisted(() => ({ searchProductsWith: vi.fn() }));
vi.mock("@/lib/search", () => ({ searchProductsWith }));
vi.mock("@/lib/search/resolve-params", () => ({
  resolveSearchParams: async (p: { q: string }) => ({ params: { q: p.q } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

const { checkDemandFollows } = await import("@/lib/demand-follow/check");

type Call = { table: string; op: string; args: unknown[] }[];

function fakeClient(rows: Record<string, unknown>[]) {
  const reads: Call = [];
  const updates: { values: unknown; filters: [string, unknown][] }[] = [];
  const rpcs: unknown[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      let update: { values: unknown; filters: [string, unknown][] } | null = null;
      for (const op of ["select", "is", "or", "order", "limit", "in"]) {
        chain[op] = (...args: unknown[]) => {
          reads.push({ table, op, args });
          return chain;
        };
      }
      chain.update = (values: unknown) => {
        update = { values, filters: [] };
        updates.push(update);
        return chain;
      };
      chain.eq = (col: string, v: unknown) => {
        if (update) update.filters.push([col, v]);
        else reads.push({ table, op: "eq", args: [col, v] });
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) => resolve(update ? { error: null } : { data: rows, error: null });
      return chain;
    },
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return { data: null, error: null };
    }),
  };
  return { client, reads, updates, rpcs };
}

const follow = (id: string, keyword: string) => ({
  id,
  keyword,
  known_product_ids: [],
  expires_at: "2099-01-01T00:00:00Z",
  users: { deleted_at: null, notification_settings: null },
});

beforeEach(() => {
  searchProductsWith.mockReset();
});

describe("checkDemandFollows queue", () => {
  it("a follow whose search throws moves its cursor (status still waiting); the others are checked", async () => {
    searchProductsWith.mockImplementation(async (_c: unknown, p: { q: string }) => {
      if (p.q === "boom") throw new Error("search down");
      return { items: [] };
    });
    const now = new Date("2026-10-08T03:00:00Z");
    const f = fakeClient([follow("f1", "boom"), follow("f2", "ok")]);
    const stats = await checkDemandFollows({ now }, f.client as never);
    expect(stats).toMatchObject({ errors: 1, checked: 2 });
    expect(f.updates).toEqual([
      { values: { last_checked_at: now.toISOString() }, filters: [["id", "f1"], ["status", "waiting"]] },
    ]);
    // f2 went through the normal record path.
    expect(f.client.rpc).toHaveBeenCalledWith("record_demand_follow_check", expect.objectContaining({ p_id: "f2", p_status: "waiting" }));
  });

  it("the due order has an id tie-break", async () => {
    const f = fakeClient([]);
    await checkDemandFollows({ now: new Date() }, f.client as never);
    const orders = f.reads.filter((r) => r.op === "order").map((r) => r.args[0]);
    expect(orders).toEqual(["last_checked_at", "id"]);
  });
});
