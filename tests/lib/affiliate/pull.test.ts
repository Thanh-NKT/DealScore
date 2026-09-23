import { describe, expect, it, vi } from "vitest";
import { pullConversions } from "@/lib/affiliate/import";
import { FakeShopeeAffiliateClient, ShopeeAffiliateError } from "@/lib/affiliate/shopee-client";

const order = (id: string) => ({
  orderId: id,
  orderStatus: "COMPLETED",
  purchaseTime: 1_790_000_000,
  items: [{ itemId: 1, qty: 1, itemPrice: 100 }, { itemPrice: 1 }], // món 2 thiếu itemId → rejected
});

describe("pullConversions", () => {
  it("3 trang → upsert 3 lần; đếm rejected", async () => {
    const client = new FakeShopeeAffiliateClient([[order("A")], [order("B")], [order("C")]]);
    const upsert = vi.fn(async (rows: unknown[]) => ({ inserted: rows.length, updated: 0, matched: 0 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await pullConversions({ client, now: new Date() }, upsert);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ pages: 3, rows: 3, rejected: 3, inserted: 3, complete: true });
  });

  it("quá deadline giữa chừng → complete = false", async () => {
    const client = new FakeShopeeAffiliateClient([[order("A")], [order("B")]]);
    const upsert = vi.fn(async () => ({ inserted: 0, updated: 0, matched: 0 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await pullConversions({ client, now: new Date(), deadline: Date.now() - 1 }, upsert);
    expect(r.complete).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lỗi retryable từ API → ném đúng loại", async () => {
    const client = new FakeShopeeAffiliateClient([], new ShopeeAffiliateError("rate limited", true));
    await expect(pullConversions({ client, now: new Date() }, vi.fn())).rejects.toMatchObject({ retryable: true });
  });
});
