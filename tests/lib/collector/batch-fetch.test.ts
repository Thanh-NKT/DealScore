import { describe, expect, it, vi } from "vitest";
import { batchedFetcher, type FetchMany } from "@/lib/collector/batch-fetch";
import { MarketplaceItemNotFoundError, type MarketplaceId, type MarketplaceItem } from "@/lib/marketplaces/types";

const item = (id: string) => ({ externalItemId: id }) as MarketplaceItem;
const q = (marketplace: MarketplaceId, externalItemId: string) => ({ marketplace, externalItemId });

describe("batchedFetcher", () => {
  it("batches same-marketplace listings ahead in the queue and serves them from that call", async () => {
    const queue = [q("tiktok", "1"), q("shopee", "s1"), q("tiktok", "2"), q("tiktok", "3")];
    const fetchOne = vi.fn(async (_m: MarketplaceId, id: string) => item(id));
    const fetchMany = vi.fn<FetchMany>((m, ids) => (m === "tiktok" ? Promise.resolve(new Map(ids.map((id) => [id, item(id)]))) : null));
    const fetchAt = batchedFetcher(queue, fetchOne, fetchMany, 50);

    const got = [];
    for (let i = 0; i < queue.length; i++) got.push((await fetchAt(i)).externalItemId);
    expect(got).toEqual(["1", "s1", "2", "3"]);
    expect(fetchMany).toHaveBeenCalledWith("tiktok", ["1", "2", "3"]);
    expect(fetchMany.mock.calls.filter(([m]) => m === "tiktok")).toHaveLength(1);
    expect(fetchOne).toHaveBeenCalledTimes(1); // shopee has no batch API
    expect(fetchOne).toHaveBeenCalledWith("shopee", "s1");
  });

  it("respects the batch size", async () => {
    const queue = ["1", "2", "3", "4", "5"].map((id) => q("tiktok", id));
    const fetchMany = vi.fn<FetchMany>((_m, ids) => Promise.resolve(new Map(ids.map((id) => [id, item(id)]))));
    const fetchAt = batchedFetcher(queue, vi.fn(), fetchMany, 2);
    for (let i = 0; i < queue.length; i++) await fetchAt(i);
    expect(fetchMany.mock.calls.map(([, ids]) => ids)).toEqual([["1", "2"], ["3", "4"], ["5"]]);
  });

  it("an id missing from the batch → not found, only for that listing", async () => {
    const queue = [q("tiktok", "1"), q("tiktok", "2")];
    const fetchAt = batchedFetcher(queue, vi.fn(), () => Promise.resolve(new Map([["2", item("2")]])), 50);
    await expect(fetchAt(0)).rejects.toBeInstanceOf(MarketplaceItemNotFoundError);
    expect((await fetchAt(1)).externalItemId).toBe("2");
  });

  it("a failed batch fails each of its listings once, without unhandled rejections for unreached ones", async () => {
    const queue = [q("tiktok", "1"), q("tiktok", "2"), q("tiktok", "3")];
    const fetchMany = vi.fn<FetchMany>(() => Promise.reject(new Error("boom")));
    const fetchAt = batchedFetcher(queue, vi.fn(), fetchMany, 50);
    await expect(fetchAt(0)).rejects.toThrow("boom");
    await expect(fetchAt(1)).rejects.toThrow("boom");
    // Listing 3 is never reached (e.g. the marketplace was aborted): its rejection is already handled.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMany).toHaveBeenCalledTimes(1);
  });
});
