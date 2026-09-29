import { beforeEach, describe, expect, it, vi } from "vitest";

// ingestShopeeItem must refresh the listing's effective price after every ingest — also when the
// detail carries no images or vouchers: the price changed, stored vouchers may apply differently
// (final review finding 1e). saveListingExtras ends with that refresh.
const saveListingExtras = vi.fn(async () => ({ images: 0, vouchers: 0 }));
const detail = {
  title: "SSD X 1TB",
  source: "api",
  sellerName: "Shop",
  sellerRating: 4.9,
  sellerRatingCount: 10,
  sellerIsOfficial: false,
  images: [] as string[],
  vouchers: [] as unknown[],
  models: [{ modelId: "m1", name: "1TB", price: 980_000, originalPrice: null, stock: 3, isFlashSale: false }],
};

vi.mock("@/lib/shopee/client", () => ({
  getItemDetail: async () => detail,
  ShopeeUnavailableError: class extends Error {},
}));
vi.mock("@/lib/matching/candidates", () => ({ loadMatchCandidates: async () => [] }));
vi.mock("@/lib/listing-extras", () => ({ saveListingExtras: (...a: unknown[]) => saveListingExtras(...(a as [])) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({
      data: { status: "ingested", product_slug: "ssd-x", category_slug: "ssd", variant_id: "v1" },
      error: null,
    }),
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => ({ data: { id: "listing-1" }, error: null });
      return c;
    },
  }),
}));

const { ingestShopeeItem } = await import("@/lib/ingest");

beforeEach(() => saveListingExtras.mockClear());

describe("ingestShopeeItem", () => {
  it("runs saveListingExtras (→ effective price refresh) even without images or vouchers", async () => {
    const res = await ingestShopeeItem({ shopId: "1", itemId: "2" });
    expect(res).toEqual({ status: "ingested", productUrl: "/ssd/ssd-x?variant=v1" });
    expect(saveListingExtras).toHaveBeenCalledTimes(1);
    expect(saveListingExtras.mock.calls[0]).toEqual([expect.anything(), "listing-1", { images: [], vouchers: [], source: "api" }]);
  });
});
