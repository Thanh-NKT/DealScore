import { describe, expect, it, vi } from "vitest";
import { runSourcing, type SourcingDeps } from "@/lib/sourcing/run";
import type { SourcingQuery } from "@/lib/sourcing/plan";
import { MarketplaceUnavailableError, type MarketplaceItem, type SearchPage } from "@/lib/marketplaces/types";

const item = (id: string, price: number | null = 100_000): MarketplaceItem => ({
  marketplace: "shopee",
  externalItemId: id,
  url: `https://shopee.vn/product/1/${id}`,
  title: `Item ${id}`,
  seller: { externalId: "1", name: null, rating: null, ratingCount: null, isOfficial: false },
  models: [{ modelId: "default", name: "", price, originalPrice: null, stock: null, isFlashSale: false }],
  images: [],
  vouchers: [],
  source: "api",
});
const query = (id: string, nextPage: string | null = null): SourcingQuery => ({
  id, marketplace: "shopee", kind: "keyword", value: id, active: true, nextPage, lastRunAt: null,
});

function deps(pages: Record<string, SearchPage | Error>, over: Partial<SourcingDeps> = {}) {
  const saved: Array<[string, { nextPage: string | null }]> = [];
  const runs: unknown[] = [];
  const d: SourcingDeps = {
    source: {
      id: "shopee",
      isConfigured: () => true,
      isFake: () => false,
      fetchItem: vi.fn(),
      searchItems: vi.fn(async (q) => {
        const p = pages[`${q.value}@${q.cursor}`];
        if (p instanceof Error) throw p;
        return p ?? { items: [], nextCursor: null };
      }),
    },
    loadQueries: async () => [query("a"), query("b", "3")],
    saveQuery: async (id, patch) => void saved.push([id, patch]),
    existingIds: async (_m, ids) => new Set(ids.filter((i) => i.startsWith("old"))),
    ingest: vi.fn(async () => ({ status: "ingested" as const, productUrl: "/x" })),
    ingestedToday: async () => 0,
    recordRun: async (r) => void runs.push(r),
    ...over,
  };
  return { d, saved, runs };
}

describe("runSourcing", () => {
  it("ingests new items at priority 3, skips existing, saves next page per query", async () => {
    const { d, saved, runs } = deps({
      "a@null": { items: [item("1"), item("old1"), item("2", null)], nextCursor: "2" },
      "b@3": { items: [item("3")], nextCursor: null },
    });
    const r = await runSourcing({ marketplace: "shopee", cap: 10 }, d);
    expect(r).toEqual({ queries: 2, seen: 4, ingested: 2, skippedExisting: 1, failed: 0, aborted: false });
    expect(d.ingest).toHaveBeenCalledTimes(2); // "2" has no price → skipped silently
    expect(saved).toEqual([
      ["a", expect.objectContaining({ nextPage: "2" })],
      ["b", expect.objectContaining({ nextPage: null })],
    ]);
    expect(runs).toHaveLength(1);
  });

  it("stops at the cap, counting what was already ingested today", async () => {
    const { d } = deps({ "a@null": { items: [item("1"), item("2"), item("3")], nextCursor: null } }, { ingestedToday: async () => 8 });
    const r = await runSourcing({ marketplace: "shopee", cap: 10 }, d);
    expect(r).toMatchObject({ ingested: 2 });
  });

  it("cap 0 or reached → no API call", async () => {
    const { d } = deps({});
    expect(await runSourcing({ marketplace: "shopee", cap: 0 }, d)).toEqual({ skipped: "cap_reached" });
    const { d: d2 } = deps({}, { ingestedToday: async () => 10 });
    expect(await runSourcing({ marketplace: "shopee", cap: 10 }, d2)).toEqual({ skipped: "cap_reached" });
    expect(d.source!.searchItems).not.toHaveBeenCalled();
  });

  it("marketplace down → aborts, records the run", async () => {
    const { d, runs } = deps({ "a@null": new MarketplaceUnavailableError("503") });
    const r = await runSourcing({ marketplace: "shopee", cap: 10 }, d);
    expect(r).toMatchObject({ aborted: true, ingested: 0 });
    expect(runs).toHaveLength(1);
  });

  it("a failing search on a saved page resets the cursor so the query restarts from page 1", async () => {
    const { d, saved } = deps({ "b@3": new Error("invalid page_token") });
    const r = await runSourcing({ marketplace: "shopee", cap: 10 }, d);
    expect(r).toMatchObject({ failed: 1, aborted: false });
    expect(saved).toContainEqual(["b", expect.objectContaining({ nextPage: null })]);
  });

  it("not configured → skipped", async () => {
    const { d } = deps({}, { source: null });
    expect(await runSourcing({ marketplace: "shopee", cap: 10 }, d)).toEqual({ skipped: "not_configured" });
  });
  it("cap hit mid-page keeps the query's cursor so the rest is revisited", async () => {
    const { d, saved } = deps(
      { "a@null": { items: [item("1"), item("2"), item("3")], nextCursor: "2" } },
      { loadQueries: async () => [query("a")], ingestedToday: async () => 8 },
    );
    await runSourcing({ marketplace: "shopee", cap: 10 }, d);
    expect(saved).toEqual([["a", expect.objectContaining({ nextPage: null })]]);
  });

  it("unexpected throw after ingesting still records the run, then rethrows", async () => {
    let calls = 0;
    const { d, runs } = deps(
      {
        "a@null": { items: [item("1")], nextCursor: null },
        "b@3": { items: [item("3")], nextCursor: null },
      },
      {
        existingIds: async () => {
          if (++calls === 2) throw new Error("db down");
          return new Set();
        },
      },
    );
    await expect(runSourcing({ marketplace: "shopee", cap: 10 }, d)).rejects.toThrow("db down");
    expect(runs).toEqual([expect.objectContaining({ ingested: 1, errorSummary: expect.stringContaining("db down") })]);
  });

});
