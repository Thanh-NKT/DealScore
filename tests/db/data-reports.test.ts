import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { admin, createTestUser, deleteTestUser, SUPABASE_URL, type TestUser } from "./helpers";
import { seedVariantWithHistory, type SeededVariant } from "./seed-history";

// Migration 0043: data_reports, submit_data_report and the admin review RPCs.
let a: SeededVariant;
let b: SeededVariant;
let member: TestUser;
const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

beforeAll(async () => {
  a = await seedVariantWithHistory({ price: 1_000_000, days: 3, daily: () => 1_000_000 });
  b = await seedVariantWithHistory({ price: 2_000_000, days: 3, daily: () => 2_000_000 });
  await admin.from("price_observations").insert({ offer_id: a.offerId, price: 990_000, observed_at: new Date().toISOString(), is_valid: true, source: "api" });
  member = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(member.id);
  await a.cleanup();
  await b.cleanup();
});

const submit = (p: Record<string, unknown>) => admin.rpc("submit_data_report", { p: p as never });

describe("submit_data_report", () => {
  it("records the offer's latest valid price as seen_price", async () => {
    const { data, error } = await submit({ product_id: a.productId, variant_id: a.variantId, offer_id: a.offerId, kind: "wrong_price" });
    expect(error).toBeNull();
    const res = data as { id: string; duplicate: boolean };
    expect(res.duplicate).toBe(false);
    const { data: row } = await admin.from("data_reports").select("seen_price, user_id, status").eq("id", res.id).single();
    expect(row).toEqual({ seen_price: 990_000, user_id: null, status: "open" });
  });

  it("falls back to the variant's current price without an offer", async () => {
    const { data } = await submit({ product_id: a.productId, variant_id: a.variantId, kind: "stock" });
    const { data: row } = await admin.from("data_reports").select("seen_price").eq("id", (data as { id: string }).id).single();
    expect(row!.seen_price).toBe(1_000_000);
  });

  it("refuses mismatched variant / offer / product", async () => {
    const r1 = await submit({ product_id: a.productId, variant_id: b.variantId, kind: "wrong_price" });
    expect(r1.error?.message).toContain("submit_data_report: phân loại không thuộc sản phẩm này");
    const r2 = await submit({ product_id: a.productId, offer_id: b.offerId, kind: "wrong_price" });
    expect(r2.error?.message).toContain("submit_data_report: tin bán không thuộc sản phẩm này");
    const r3 = await submit({ product_id: a.productId, variant_id: a.variantId, offer_id: b.offerId, kind: "wrong_price" });
    expect(r3.error?.message).toContain("tin bán không thuộc sản phẩm này");
    const r4 = await submit({ product_id: "00000000-0000-4000-8000-000000000000", kind: "wrong_price" });
    expect(r4.error?.message).toContain("sản phẩm không tồn tại");
    const r5 = await submit({ product_id: a.productId, kind: "other", message: "   " });
    expect(r5.error?.message).toContain("Khác");
    const r6 = await submit({ product_id: a.productId, kind: "spam" });
    expect(r6.error?.message).toContain("loại góp ý không hợp lệ");
  });

  it("a member's repeat within the window returns the open report with duplicate: true", async () => {
    const p = { product_id: b.productId, offer_id: b.offerId, kind: "wrong_match", user_id: member.id, dedup_hours: 24 };
    const first = (await submit(p)).data as { id: string; duplicate: boolean };
    const again = (await submit({ ...p, message: "vẫn sai" })).data as { id: string; duplicate: boolean };
    expect(again).toEqual({ id: first.id, duplicate: true });
    // Another offer (here: none) is another report.
    const other = (await submit({ ...p, offer_id: null })).data as { duplicate: boolean };
    expect(other.duplicate).toBe(false);
  });

  it("guests are never de-duplicated", async () => {
    const p = { product_id: b.productId, kind: "stock" };
    const r1 = (await submit(p)).data as { id: string };
    const r2 = (await submit(p)).data as { id: string; duplicate: boolean };
    expect(r2.duplicate).toBe(false);
    expect(r2.id).not.toBe(r1.id);
  });

  it("anon / authenticated can neither read the table nor call the RPC", async () => {
    expect((await anon.from("data_reports").select("id")).error?.code).toBe("42501");
    expect((await member.client.from("data_reports").select("id")).error?.code).toBe("42501");
    expect((await member.client.from("data_reports").insert({ product_id: a.productId, kind: "stock" })).error?.code).toBe("42501");
    for (const c of [anon, member.client]) {
      const { error } = await c.rpc("submit_data_report", { p: { product_id: a.productId, kind: "stock" } });
      expect(error?.code).toBe("42501");
    }
  });

  it("deleting the user nulls user_id", async () => {
    const u = await createTestUser();
    const { data } = await submit({ product_id: a.productId, kind: "wrong_price", user_id: u.id });
    await deleteTestUser(u.id);
    const { data: row } = await admin.from("data_reports").select("user_id").eq("id", (data as { id: string }).id).single();
    expect(row!.user_id).toBeNull();
  });
});

describe("admin_data_reports / counts / resolve", () => {
  it("rejects bad filters", async () => {
    expect((await admin.rpc("admin_data_reports", { p_status: "pending" })).error?.message).toContain("admin_data_reports: bộ lọc không hợp lệ");
    expect((await admin.rpc("admin_data_reports", { p_kind: "spam" })).error?.message).toContain("bộ lọc không hợp lệ");
  });

  it("orders open reports by same_open_count then age; reporter is member/guest and no user_id leaves", async () => {
    const { data, error } = await admin.rpc("admin_data_reports", { p_product_id: b.productId });
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(["member", "guest"]).toContain(r.reporter);
      expect(r).not.toHaveProperty("user_id");
      expect(Number(r.total_count)).toBe(rows.length);
    }
    // wrong_match ×2 and stock ×2 for b: each row sees one other open row of its kind.
    expect(rows.every((r) => r.same_open_count === 1)).toBe(true);
    const created = rows.map((r) => r.created_at);
    expect([...created].sort()).toEqual(created);
    const withOffer = rows.find((r) => r.offer_id === b.offerId)!;
    expect(withOffer).toMatchObject({ listing_id: b.listingId, marketplace: "shopee", product_status: "verified" });
  });

  it("resolve 2 ids where one is already resolved → updated 1, skipped 1, one audit row; reopen clears reviewed_at", async () => {
    const { data: rows } = await admin.rpc("admin_data_reports", { p_product_id: a.productId });
    const [x, y] = rows!;
    await admin.rpc("admin_resolve_data_reports", { p_ids: [x.id], p_status: "resolved" });
    const before = await admin.from("admin_audit").select("id", { count: "exact", head: true }).eq("entity", "data_report").eq("entity_id", y.id);
    const { data: res, error } = await admin.rpc("admin_resolve_data_reports", { p_ids: [x.id, y.id, y.id], p_status: "resolved", p_note: " sửa giá " });
    expect(error).toBeNull();
    expect(res).toEqual({ updated: 1, skipped: 1, ids: [y.id] });
    const { data: audit } = await admin.from("admin_audit").select("action, before, after, note").eq("entity", "data_report").eq("entity_id", y.id);
    expect(audit!.length - (before.count ?? 0)).toBe(1);
    expect(audit!.at(-1)).toMatchObject({
      action: "data_report.resolve",
      note: "sửa giá",
      before: { status: "open", product_id: a.productId },
      after: { status: "resolved", review_note: "sửa giá", product_id: a.productId },
    });

    const { data: re } = await admin.rpc("admin_resolve_data_reports", { p_ids: [y.id], p_status: "open" });
    expect(re).toMatchObject({ updated: 1 });
    const { data: row } = await admin.from("data_reports").select("status, reviewed_at, review_note").eq("id", y.id).single();
    expect(row).toEqual({ status: "open", reviewed_at: null, review_note: "sửa giá" });
  });

  it("101 ids, an empty list or a bad status raise", async () => {
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    expect((await admin.rpc("admin_resolve_data_reports", { p_ids: ids, p_status: "resolved" })).error?.message).toContain("admin_resolve_data_reports:");
    expect((await admin.rpc("admin_resolve_data_reports", { p_ids: [], p_status: "resolved" })).error).not.toBeNull();
    expect((await admin.rpc("admin_resolve_data_reports", { p_ids: [ids[0]], p_status: "done" })).error).not.toBeNull();
  });

  it("unknown ids count as skipped", async () => {
    const { data } = await admin.rpc("admin_resolve_data_reports", { p_ids: [crypto.randomUUID()], p_status: "dismissed" });
    expect(data).toEqual({ updated: 0, skipped: 1, ids: [] });
  });

  it("counts", async () => {
    const { data, error } = await admin.rpc("admin_data_report_counts");
    expect(error).toBeNull();
    const c = data as { open: number; open_by_kind: Record<string, number>; resolved_7d: number; oldest_open_at: string | null };
    expect(c.open).toBeGreaterThanOrEqual(4);
    expect(Object.keys(c.open_by_kind).sort()).toEqual(["other", "stock", "wrong_match", "wrong_price"]);
    expect(c.resolved_7d).toBeGreaterThanOrEqual(1);
    expect(c.oldest_open_at).not.toBeNull();
  });

  it("anon / authenticated cannot execute the admin RPCs", async () => {
    for (const c of [anon, member.client]) {
      expect((await c.rpc("admin_data_reports", {})).error?.code).toBe("42501");
      expect((await c.rpc("admin_data_report_counts")).error?.code).toBe("42501");
      expect((await c.rpc("admin_resolve_data_reports", { p_ids: [crypto.randomUUID()], p_status: "resolved" })).error?.code).toBe("42501");
    }
  });
});

// 0045 (P2 review M8): seen_price / current_price use the same extension corroboration gate as
// refresh_variant_current_price — an uncorroborated extension price is never "the price the user saw".
describe("seen_price / current_price corroboration gate (0045)", () => {
  let g: SeededVariant;
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  beforeAll(async () => {
    g = await seedVariantWithHistory({ price: 1_500_000, days: 2, daily: () => 1_500_000 });
    await admin.from("price_observations").insert([
      { offer_id: g.offerId, price: 1_500_000, observed_at: hoursAgo(3), is_valid: true, source: "api" },
      // Newest, valid, but extension-only and far from any trusted price.
      { offer_id: g.offerId, price: 700_000, observed_at: hoursAgo(1), is_valid: true, source: "extension" },
    ]);
  });
  afterAll(async () => {
    await g.cleanup();
  });

  it("skips an uncorroborated extension observation for seen_price and current_price", async () => {
    const { data, error } = await submit({ product_id: g.productId, offer_id: g.offerId, kind: "wrong_price" });
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    const { data: row } = await admin.from("data_reports").select("seen_price").eq("id", id).single();
    expect(row!.seen_price).toBe(1_500_000);
    const { data: rows } = await admin.rpc("admin_data_reports", { p_product_id: g.productId });
    const r = rows!.find((x) => x.id === id)!;
    expect(r.current_price).toBe(1_500_000);
  });

  it("uses a corroborated extension observation (trusted price within 24h and 2%)", async () => {
    await admin.from("price_observations").insert([
      { offer_id: g.offerId, price: 1_490_000, observed_at: hoursAgo(0.5), is_valid: true, source: "extension" },
    ]);
    const { data } = await submit({ product_id: g.productId, offer_id: g.offerId, kind: "stock" });
    const id = (data as { id: string }).id;
    const { data: row } = await admin.from("data_reports").select("seen_price").eq("id", id).single();
    expect(row!.seen_price).toBe(1_490_000);
    const { data: rows } = await admin.rpc("admin_data_reports", { p_product_id: g.productId });
    expect(rows!.find((x) => x.id === id)!.current_price).toBe(1_490_000);
  });
});
