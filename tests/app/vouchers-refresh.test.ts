import { beforeEach, describe, expect, it, vi } from "vitest";

const OFFER = "0d953a06-9122-4009-b4f5-6babdd060364";
let listing: { id: string; marketplace: string; external_item_id: string; status: string } | null;
let underCap: boolean;
const rpc = vi.fn(async () => ({ data: underCap, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: listing ? { id: OFFER, listings: listing } : null, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
const finishLookup = vi.fn(async () => undefined);
vi.mock("@/lib/rate-limit", () => ({
  beginLookup: async () => ({ allowed: true, requestId: 7 }),
  finishLookup: (...a: unknown[]) => finishLookup(...(a as [])),
  clientIp: () => "1.2.3.4",
  hashIp: () => "h",
}));
const fetchItem = vi.fn(async () => ({ images: [], vouchers: [], source: "api" }));
vi.mock("@/lib/marketplaces/sources", () => ({ getSource: () => ({ isConfigured: () => true, fetchItem }) }));
vi.mock("@/lib/listing-extras", () => ({ saveListingExtras: async () => ({ images: 0, vouchers: 0 }) }));
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

const { POST } = await import("@/app/api/vouchers/refresh/route");
const call = () =>
  POST(new Request("https://kairo.vn/api/vouchers/refresh", { method: "POST", body: JSON.stringify({ offerId: OFFER }) }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  listing = { id: "l1", marketplace: "shopee", external_item_id: "1_2", status: "active" };
  underCap = true;
});

describe("POST /api/vouchers/refresh", () => {
  it("refreshes an active listing under the daily cap", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(fetchItem).toHaveBeenCalledWith("1_2");
    expect(rpc).toHaveBeenCalledWith("rate_hit", expect.objectContaining({ p_window_seconds: 86_400, p_limit: 500 }));
    // The page's cached voucher reads are expired at once, so the refresh is visible on the next render.
    expect(revalidateTag).toHaveBeenCalledWith("vouchers", { expire: 0 });
  });

  it("global daily cap reached → 503, no upstream call, lookup marked rejected", async () => {
    underCap = false;
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream_unavailable" });
    expect(fetchItem).not.toHaveBeenCalled();
    expect(finishLookup).toHaveBeenCalledWith(7, "rejected");
  });

  it("inactive / gone listings are not refreshed", async () => {
    listing!.status = "inactive";
    const res = await call();
    expect(res.status).toBe(404);
    expect(fetchItem).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
