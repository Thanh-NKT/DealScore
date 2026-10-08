import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { admin, SUPABASE_URL } from "./helpers";

// Migration 0052: admin affiliate report (roadmap P3 item 11). Seeded in March 2024, a range no other test uses.
const tag = `af${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const FROM = "2024-03-01";
const TO = "2024-03-07";
const orderIds: string[] = [];
const clickIds: string[] = [];
let productId: string;
let listingA: { id: string; ext: string; offerId: string };
let listingB: { id: string; ext: string; offerId: string };

/** VN local time → ISO (Asia/Ho_Chi_Minh is UTC+7, no DST). */
const vn = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();

async function listing(variantId: string | null) {
  const ext = `${tag}-${randomUUID().slice(0, 6)}`;
  const { data: l } = await admin.from("listings")
    .insert({ marketplace: "shopee", external_item_id: ext, url: `https://shopee.vn/${ext}`, title: `Tin ${ext}`, status: "active" })
    .select("id").single();
  const { data: o } = await admin.from("offers").insert({ listing_id: l!.id, variant_id: variantId, match_status: variantId ? "manual" : "pending" })
    .select("id").single();
  return { id: l!.id, ext, offerId: o!.id };
}

async function click(offerId: string, at: string, source = "web") {
  const { data, error } = await admin.from("click_events").insert({ offer_id: offerId, source, created_at: at }).select("id").single();
  if (error) throw error;
  clickIds.push(data.id);
  return data.id;
}

async function conversion(o: { order: string; item: string; status: string; at: string; value: number; commission: number; click?: string; channel?: string }) {
  const orderId = `${tag}-${o.order}`;
  if (!orderIds.includes(orderId)) orderIds.push(orderId);
  const { error } = await admin.from("conversions").insert({
    order_id: orderId, item_id: o.item, model_id: "", click_event_id: o.click ?? null, source_channel: o.channel ?? "web",
    purchase_time: o.at, status: o.status, raw_status: o.status.toUpperCase(), order_value: o.value, commission: o.commission,
    import_source: "csv", raw: {},
  });
  if (error) throw error;
}

beforeAll(async () => {
  const { data: c } = await admin.from("categories").select("id, slug").limit(1).single();
  const { data: p } = await admin.from("products")
    .insert({ canonical_name: `Aff ${tag}`, brand: "Test", status: "verified", slug: `test-${tag}`, category_id: c!.id })
    .select("id").single();
  productId = p!.id;
  const { data: v } = await admin.from("product_variants").insert({ product_id: productId, variant_key: "A" }).select("id").single();
  listingA = await listing(v!.id);
  listingB = await listing(null);

  // 23:30 VN on 03-02 is 16:30 UTC — the VN day, not the UTC day.
  const c1 = await click(listingA.offerId, vn("2024-03-02", "23:30"));
  await click(listingA.offerId, vn("2024-03-03", "08:00"), "email");
  await click(listingA.offerId, vn("2024-02-29", "23:59")); // outside
  // Order 1: two items of one order (A twice) — counts once; completed, matched.
  await conversion({ order: "o1", item: listingA.ext, status: "completed", at: vn("2024-03-02", "23:45"), value: 100_000, commission: 10_000, click: c1 });
  await conversion({ order: "o1", item: `${listingA.ext}-x`, status: "completed", at: vn("2024-03-02", "23:45"), value: 50_000, commission: 5_000, click: c1 });
  // Order 2: cancelled, unmatched, on listing B (no click).
  await conversion({ order: "o2", item: listingB.ext, status: "cancelled", at: vn("2024-03-05", "10:00"), value: 70_000, commission: 7_000 });
  // Order 3: pending; order 4: unknown status (neither enters gmv / commission).
  await conversion({ order: "o3", item: listingA.ext, status: "pending", at: vn("2024-03-06", "10:00"), value: 30_000, commission: 3_000, channel: "email" });
  await conversion({ order: "o4", item: listingB.ext, status: "unknown", at: vn("2024-03-06", "11:00"), value: 999_000, commission: 99_000 });
  await conversion({ order: "o5", item: listingA.ext, status: "completed", at: vn("2024-03-08", "00:10"), value: 1, commission: 1 }); // outside
});

afterAll(async () => {
  await admin.from("conversions").delete().in("order_id", orderIds);
  await admin.from("click_events").delete().in("id", clickIds);
  await admin.from("listings").delete().in("id", [listingA.id, listingB.id]);
  await admin.from("products").delete().eq("id", productId);
});

type Report = {
  from: string; to: string;
  totals: { clicks: number; orders: number; orders_matched: number; unmatched_orders: number;
    gmv: Record<string, number>; commission: Record<string, number> };
  daily: { day: string; clicks: number; orders: number; gmv_completed: number; commission_completed: number; commission_pending: number }[];
  by_channel: { channel: string; clicks: number; orders: number; orders_matched: number; commission_completed: number; commission_pending: number }[];
  by_marketplace: { marketplace: string; orders: number; gmv_completed: number; commission_completed: number; commission_pending: number }[];
  by_status: { status: string; orders: number; order_value: number; commission: number }[];
  links: { eligible: number; ineligible: number; with_short_link: number };
};

describe("admin_affiliate_report", () => {
  it("totals by VN calendar day, distinct orders, money by status", async () => {
    const { data, error } = await admin.rpc("admin_affiliate_report", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const r = data as Report;
    expect(r.from).toBe(FROM);
    expect(r.to).toBe(TO);
    expect(r.totals).toEqual({
      clicks: 2, orders: 4, orders_matched: 1, unmatched_orders: 3,
      gmv: { completed: 150_000, pending: 30_000, cancelled: 70_000 },
      commission: { completed: 15_000, pending: 3_000, cancelled: 7_000 },
    });
  });

  it("daily has every day of the range (empty days = 0); 23:30 VN counts on its VN day", async () => {
    const r = (await admin.rpc("admin_affiliate_report", { p_from: FROM, p_to: TO })).data as Report;
    expect(r.daily.map((d) => d.day)).toEqual(["2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07"]);
    expect(r.daily[0]).toEqual({ day: "2024-03-01", clicks: 0, orders: 0, gmv_completed: 0, commission_completed: 0, commission_pending: 0 });
    expect(r.daily[1]).toMatchObject({ clicks: 1, orders: 1, gmv_completed: 150_000, commission_completed: 15_000 });
    expect(r.daily[2]).toMatchObject({ clicks: 1, orders: 0 });
    expect(r.daily[5]).toMatchObject({ orders: 2, commission_pending: 3_000 });
  });

  it("by channel, by marketplace, by status, links", async () => {
    const r = (await admin.rpc("admin_affiliate_report", { p_from: FROM, p_to: TO })).data as Report;
    const web = r.by_channel.find((c) => c.channel === "web")!;
    const email = r.by_channel.find((c) => c.channel === "email")!;
    expect(web).toEqual({ channel: "web", clicks: 1, orders: 3, orders_matched: 1, commission_completed: 15_000, commission_pending: 0 });
    expect(email).toEqual({ channel: "email", clicks: 1, orders: 1, orders_matched: 0, commission_completed: 0, commission_pending: 3_000 });
    expect(r.by_marketplace).toEqual([{ marketplace: "shopee", orders: 4, gmv_completed: 150_000, commission_completed: 15_000, commission_pending: 3_000 }]);
    expect(r.by_status).toEqual([
      { status: "pending", orders: 1, order_value: 30_000, commission: 3_000 },
      { status: "completed", orders: 1, order_value: 150_000, commission: 15_000 },
      { status: "cancelled", orders: 1, order_value: 70_000, commission: 7_000 },
      { status: "unknown", orders: 1, order_value: 999_000, commission: 99_000 },
    ]);
    for (const k of ["eligible", "ineligible", "with_short_link"] as const) expect(typeof r.links[k]).toBe("number");
  });

  it("from > to or more than 365 days raise", async () => {
    for (const [f, t] of [["2024-03-07", "2024-03-01"], ["2023-01-01", "2024-01-02"]]) {
      const { error } = await admin.rpc("admin_affiliate_report", { p_from: f, p_to: t });
      expect(error?.message).toContain("admin_affiliate_report: khoảng ngày không hợp lệ");
    }
    expect((await admin.rpc("admin_affiliate_report", { p_from: "2023-03-02", p_to: "2024-03-01" })).error).toBeNull();
  });
});

describe("admin_affiliate_top_items", () => {
  it("joins clicks and orders per (marketplace, item): click-and-order, order-only, unlabeled items", async () => {
    const { data, error } = await admin.rpc("admin_affiliate_top_items", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const rows = data ?? [];
    for (const r of rows) {
      expect(r).not.toHaveProperty("user_id");
      expect(r).not.toHaveProperty("session_id");
      expect(r).not.toHaveProperty("order_id");
    }
    const a = rows.find((r) => r.external_item_id === listingA.ext)!;
    expect(a).toMatchObject({
      marketplace: "shopee", listing_id: listingA.id, product_id: productId, clicks: 2, orders: 2,
      gmv_completed: 100_000, commission_completed: 10_000,
    });
    const b = rows.find((r) => r.external_item_id === listingB.ext)!;
    expect(b).toMatchObject({ listing_id: listingB.id, product_id: null, clicks: 0, orders: 2, gmv_completed: 0 });
    const x = rows.find((r) => r.external_item_id === `${listingA.ext}-x`)!;
    expect(x).toMatchObject({ listing_id: null, listing_title: null, clicks: 0, orders: 1, gmv_completed: 50_000 });
  });

  it("sorts by clicks / commission and validates the sort; limit is clamped", async () => {
    const byClicks = (await admin.rpc("admin_affiliate_top_items", { p_from: FROM, p_to: TO, p_sort: "clicks", p_limit: 1 })).data ?? [];
    expect(byClicks).toHaveLength(1);
    expect(byClicks[0].external_item_id).toBe(listingA.ext);
    const byCommission = (await admin.rpc("admin_affiliate_top_items", { p_from: FROM, p_to: TO, p_sort: "commission" })).data ?? [];
    expect(byCommission[0].external_item_id).toBe(listingA.ext);
    expect((await admin.rpc("admin_affiliate_top_items", { p_from: FROM, p_to: TO, p_sort: "gmv" })).error?.message)
      .toContain("admin_affiliate_top_items:");
    expect((await admin.rpc("admin_affiliate_top_items", { p_from: TO, p_to: FROM })).error?.message).toContain("khoảng ngày không hợp lệ");
  });

  it("anon / authenticated cannot call the affiliate RPCs", async () => {
    const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await anon.rpc("admin_affiliate_report", { p_from: FROM, p_to: TO })).error?.code).toBe("42501");
    expect((await anon.rpc("admin_affiliate_top_items", { p_from: FROM, p_to: TO })).error?.code).toBe("42501");
  });
});
