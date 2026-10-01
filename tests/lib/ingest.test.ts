import { beforeEach, describe, expect, it, vi } from "vitest";

// ingestProduct must refresh the listing's effective price after every ingest — also when the
// detail carries no images or vouchers: the price changed, stored vouchers may apply differently
// (final review finding 1e). saveListingExtras ends with that refresh.
const rpcCalls: unknown[][] = [];
const saveListingExtras = vi.fn(async () => ({ images: 0, vouchers: 0 }));
const detail = {
  marketplace: "shopee",
  externalItemId: "1_2",
  url: "https://shopee.vn/product/1/2",
  title: "SSD X 1TB",
  source: "api",
  seller: { externalId: "1", name: "Shop", rating: 4.9, ratingCount: 10, isOfficial: false },
  images: [] as string[],
  vouchers: [] as unknown[],
  models: [{ modelId: "m1", name: "1TB", price: 980_000, originalPrice: null, stock: 3, isFlashSale: false }],
};

vi.mock("@/lib/marketplaces/sources", () => ({ getSource: () => ({ fetchItem: async () => detail }) }));
vi.mock("@/lib/matching/candidates", () => ({ loadMatchCandidates: async () => [] }));
vi.mock("@/lib/listing-extras", () => ({ saveListingExtras: (...a: unknown[]) => saveListingExtras(...(a as [])) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (...args: unknown[]) => {
      rpcCalls.push(args);
      return { data: { status: "ingested", product_slug: "ssd-x", category_slug: "ssd", variant_id: "v1" }, error: null };
    },
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => ({ data: { id: "listing-1" }, error: null });
      return c;
    },
  }),
}));

const { ingestProduct, ingestItem } = await import("@/lib/ingest");

beforeEach(() => saveListingExtras.mockClear());

describe("ingestProduct", () => {
  it("runs saveListingExtras (→ effective price refresh) even without images or vouchers", async () => {
    const res = await ingestProduct("shopee", "1_2");
    expect(res).toEqual({ status: "ingested", productUrl: "/ssd/ssd-x?variant=v1" });
    expect(rpcCalls.at(-1)![0]).toBe("ingest_listing");
    expect(rpcCalls.at(-1)![1]).toMatchObject({ p: { marketplace: "shopee", ext_item_id: "1_2", refresh_priority: 1 } });
    expect(saveListingExtras).toHaveBeenCalledTimes(1);
    expect(saveListingExtras.mock.calls[0]).toEqual([expect.anything(), "listing-1", { images: [], vouchers: [], source: "api" }]);
  });
});

describe("ingestItem", () => {
  it("refuses an item without any priced model", async () => {
    const res = await ingestItem({ ...detail, models: [{ ...detail.models[0], price: null }] } as never);
    expect(res).toEqual({ status: "error", code: "upstream_unavailable" });
  });
});
