import { describe, expect, it, vi } from "vitest";
import { recomputeSellerProfiles } from "@/lib/sellers/profile-job";

const now = new Date("2026-10-08T03:00:00Z");

function client(opts: { fresh: string[]; sellers: string[] }) {
  const upserts: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "seller_offer_ids") {
      const after = args.p_after as string | null;
      const rest = opts.sellers.filter((s) => after == null || s > after).slice(0, args.p_limit as number);
      return { data: rest.map((s) => ({ seller_id: s, offer_ids: [`o-${s}`], variant_ids: [`v-${s}`] })), error: null };
    }
    if (fn === "offer_daily_prices") return { data: [], error: null };
    throw new Error(fn);
  });
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const k of ["select", "in", "gte", "order", "limit"]) c[k] = () => c;
    c.then = (res: (v: unknown) => void) => res({ data: rows, error: null });
    return c;
  };
  const from = vi.fn((table: string) => {
    if (table === "seller_price_profiles") {
      return {
        ...chain(opts.fresh.map((s) => ({ seller_id: s, computed_at: "2026-10-06T00:00:00Z" }))),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
      };
    }
    return chain([]);
  });
  return { c: { rpc, from } as never, upserts, rpc };
}

describe("recomputeSellerProfiles", () => {
  it("processes only stale or missing sellers and pages to the end", async () => {
    const { c, upserts } = client({ sellers: ["a", "b", "c"], fresh: ["b"] });
    const r = await recomputeSellerProfiles({ now, batch: 2 }, c);
    expect(r).toMatchObject({ sellers: 2, written: 2, errors: 0, done: true });
    expect(upserts.map((u) => u.seller_id)).toEqual(["a", "c"]);
    expect(upserts[0]).toMatchObject({ version: "h1", window_days: 90, offers_tracked: 0, computed_at: now.toISOString() });
  });
  it("respects the deadline", async () => {
    const { c, upserts } = client({ sellers: ["a", "b"], fresh: [] });
    const r = await recomputeSellerProfiles({ now, deadline: Date.now() - 1 }, c);
    expect(r.done).toBe(false);
    expect(upserts).toEqual([]);
  });
});
