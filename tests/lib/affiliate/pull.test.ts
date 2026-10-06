import { describe, expect, it, vi } from "vitest";
import { PULL_SLICE_DAYS, PULL_WINDOW_DAYS, pullConversions } from "@/lib/affiliate/import";
import { FakeShopeeAffiliateClient, ShopeeAffiliateError, type ShopeeAffiliateClient } from "@/lib/affiliate/shopee-client";

const NOW = new Date("2026-10-06T00:00:00Z");
const DAY = 86_400_000;
const order = (id: string, purchaseTime = Math.floor((NOW.getTime() - DAY) / 1000)) => ({
  orderId: id,
  orderStatus: "COMPLETED",
  purchaseTime,
  items: [{ itemId: 1, qty: 1, itemPrice: 100 }, { itemPrice: 1 }], // item 2 lacks itemId → rejected
});

/** Serves `pages` only for the slice whose [start, end] contains `at`; other slices are empty. */
function sliceClient(pages: ReturnType<typeof order>[][], at = NOW.getTime() - DAY) {
  const calls: Array<{ start: Date; end: Date; scrollId: string | null }> = [];
  const client: ShopeeAffiliateClient = {
    async conversionReport({ start, end, scrollId }) {
      calls.push({ start, end, scrollId });
      if (at < start.getTime() || at > end.getTime()) return { orders: [], nextScrollId: null };
      const i = scrollId ? Number(scrollId) : 0;
      return { orders: pages[i] ?? [], nextScrollId: i + 1 < pages.length ? String(i + 1) : null };
    },
    generateShortLink: vi.fn(),
  };
  return { client, calls };
}

const upsertAll = () => vi.fn(async (rows: unknown[]) => ({ inserted: rows.length, updated: 0, matched: 0 }));

describe("pullConversions", () => {
  it("pulls the whole window in slices, newest first; 3 pages → 3 upserts; counts rejected", async () => {
    const { client, calls } = sliceClient([[order("A")], [order("B")], [order("C")]]);
    const upsert = upsertAll();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await pullConversions({ client, now: NOW }, upsert);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ rows: 3, rejected: 3, inserted: 3, complete: true });
    expect(r.pulledFrom).toBe(new Date(NOW.getTime() - PULL_WINDOW_DAYS * DAY).toISOString());

    const slices = calls.filter((c) => c.scrollId == null);
    expect(slices).toHaveLength(Math.ceil(PULL_WINDOW_DAYS / PULL_SLICE_DAYS));
    expect(slices[0].end.getTime()).toBe(NOW.getTime());
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].end.getTime()).toBe(slices[i - 1].start.getTime()); // contiguous, going back in time
    }
    expect(slices.at(-1)!.start.getTime()).toBe(NOW.getTime() - PULL_WINDOW_DAYS * DAY);
  });

  it("a deadline hit leaves only the OLDEST slices for later: the newest orders are already in", async () => {
    const { client } = sliceClient([[order("NEW")]]);
    const upsert = upsertAll();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let t = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (t += 1_000));
    const deadline = t + 2_500; // room for the first two slices only
    try {
      const r = await pullConversions({ client, now: NOW, deadline }, upsert);
      expect(r.complete).toBe(false);
      expect(upsert).toHaveBeenCalledTimes(1); // the newest slice, where "NEW" is
      expect(r.pulledFrom).not.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("deadline already passed → nothing pulled, complete = false", async () => {
    const client = new FakeShopeeAffiliateClient([[order("A")], [order("B")]]);
    const upsert = vi.fn(async () => ({ inserted: 0, updated: 0, matched: 0 }));
    const r = await pullConversions({ client, now: NOW, deadline: Date.now() - 1 }, upsert);
    expect(r).toMatchObject({ complete: false, pulledFrom: null, pages: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("retryable API error → throws the right type", async () => {
    const client = new FakeShopeeAffiliateClient([], new ShopeeAffiliateError("rate limited", true));
    await expect(pullConversions({ client, now: NOW }, vi.fn())).rejects.toMatchObject({ retryable: true });
  });
});
