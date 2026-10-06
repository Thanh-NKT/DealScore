import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "@/lib/vouchers/types";

// loadProductPageData computes each offer's effective price LIVE from its current price and the
// vouchers active now (final review finding 1d) — never from the stored offers.effective_price.
const LISTING = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";

const state: { price: number; vouchers: Voucher[] } = { price: 0, vouchers: [] };

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "order", "in", "or", "limit"]) c[m] = () => c;
  c.maybeSingle = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

function fakeClient() {
  const now = new Date().toISOString();
  return {
    from(table: string) {
      if (table === "products") {
        return chain({
          data: {
            id: "p1",
            slug: "ssd-x",
            canonical_name: "SSD X",
            brand: null,
            model: null,
            image: null,
            specs: {},
            status: "verified",
            categories: { slug: "ssd", name: "SSD" },
            product_variants: [
              {
                id: "v1",
                variant_key: "default",
                specs: {},
                variant_current_price: { price: state.price, original_price: null, in_stock: true, observed_at: now },
              },
            ],
          },
          error: null,
        });
      }
      if (table === "offers") {
        return chain({
          data: [
            {
              id: "o1",
              match_status: "auto",
              // A stale stored value must be ignored.
              effective_price: 1,
              effective_price_at: now,
              listings: {
                id: LISTING,
                seller_id: SELLER,
                images: [],
                marketplace: "shopee",
                url: "https://shopee.vn/x",
                title: "SSD X",
                status: "active",
                last_observed_at: now,
                sellers: { name: "Shop", rating: 4.9, rating_count: 10, is_official: false },
              },
              affiliate_offers: null,
            },
          ],
          error: null,
        });
      }
      return chain({ data: [], error: null });
    },
    rpc(name: string) {
      if (name === "latest_price_per_offer") {
        return Promise.resolve({
          data: [{ offer_id: "o1", price: state.price, original_price: null, stock: 5, is_flash_sale: false, observed_at: now }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
const voucherReads = vi.fn();
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({}) }));
vi.mock("@/lib/vouchers/store", () => ({
  VOUCHERS_CACHE_TAG: "vouchers",
  listVouchersForListings: async (_client: unknown, scopes: Array<{ listingId: string }>) => {
    voucherReads(scopes);
    return Object.fromEntries(scopes.map((s) => [s.listingId, state.vouchers]));
  },
}));

const { loadProductPageData } = await import("@/lib/product/page-data");
const { effectiveReason } = await import("@/lib/vouchers/effective");
const { bestCombination } = await import("@/lib/vouchers/select");

function voucher(over: Partial<Voucher> = {}): Voucher {
  const now = new Date().toISOString();
  return {
    id: "v1",
    marketplace: "shopee",
    kind: "platform",
    sellerId: null,
    listingId: null,
    code: null,
    discountType: "amount",
    discountValue: 100_000,
    maxDiscount: null,
    minSpend: 1_000_000,
    startsAt: null,
    expiresAt: null,
    source: "api",
    reporters: [],
    firstSeenAt: now,
    lastSeenAt: now,
    ...over,
  };
}

beforeEach(() => {
  state.vouchers = [voucher()];
  voucherReads.mockClear();
});

describe("loadProductPageData — live effective price", () => {
  it("price above min spend → price minus the voucher, same as the picker's best combination", async () => {
    state.price = 1_050_000;
    const data = (await loadProductPageData({ productSlug: "ssd-x" }))!;
    const cheapest = data.pricing.cheapest!;
    expect(cheapest.effectivePrice).toBe(950_000);
    expect(bestCombination(data.offerVouchers!["o1"], cheapest.price!, 0).estimatedTotal).toBe(950_000);
    // Reason line shows even though the Deal Score is still insufficient (no history).
    expect(data.pricing.headline!.score).toBeNull();
    expect(data.pricing.headline!.reasons).toContain(effectiveReason(950_000));
  });

  it("price dropped below min spend → no effective price and no voucher reason", async () => {
    state.price = 980_000;
    const data = (await loadProductPageData({ productSlug: "ssd-x" }))!;
    expect(data.pricing.cheapest!.effectivePrice).toBeNull();
    expect(data.pricing.headline!.reasons.some((r) => r.startsWith("Dùng voucher"))).toBe(false);
  });

  it("vouchers are read once per page, for all listings together", async () => {
    state.price = 1_050_000;
    await loadProductPageData({ productSlug: "ssd-x" });
    expect(voucherReads).toHaveBeenCalledTimes(1);
    expect(voucherReads.mock.calls[0][0]).toEqual([{ listingId: LISTING, sellerId: SELLER, marketplace: "shopee" }]);
  });

  it("expired voucher → no effective price", async () => {
    state.price = 1_050_000;
    state.vouchers = [voucher({ expiresAt: new Date(Date.now() - 60_000).toISOString() })];
    const data = (await loadProductPageData({ productSlug: "ssd-x" }))!;
    expect(data.pricing.cheapest!.effectivePrice).toBeNull();
    expect(data.offerVouchers!["o1"]).toEqual([]);
  });
});
