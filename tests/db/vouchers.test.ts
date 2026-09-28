import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, admin } from "./helpers";

// upsert_vouchers + vouchers table (spec 2026-09-26 §1): natural-key dedupe, reporter merge, API outranks
// extension, check constraints, and anon can read but never write.
const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ext = `test_${randomUUID()}`;
let listingId = "";
let sellerId = "";

const base = () => ({
  marketplace: "shopee",
  kind: "shop",
  sellerId,
  listingId: "",
  code: "",
  discountType: "amount",
  discountValue: 50_000,
  minSpend: 500_000,
});

const rows = async () => {
  const { data, error } = await admin.from("vouchers").select("*").eq("seller_id", sellerId);
  if (error) throw error;
  return data ?? [];
};

beforeAll(async () => {
  const { error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: ext,
      url: "https://shopee.vn/product/1/2",
      title: `voucher test ${ext}`,
      slug_base: `test-vouchers-${ext.slice(5, 11)}`,
      source: "seed",
      seller: { external_id: `seller-${ext}`, name: "Shop test", rating: 4.7 },
      models: [{ model_id: "m", name: "x", price: 100_000, stock: 3 }],
    },
  });
  if (error) throw error;
  const { data: l } = await admin.from("listings").select("id, seller_id").eq("external_item_id", ext).single();
  listingId = l!.id;
  sellerId = l!.seller_id!;
});

afterAll(async () => {
  await admin.from("vouchers").delete().eq("seller_id", sellerId);
  await admin.from("listings").delete().eq("external_item_id", ext);
  await admin.from("products").delete().like("slug", `test-vouchers-${ext.slice(5, 11)}%`);
  await admin.from("sellers").delete().eq("id", sellerId);
});

describe("upsert_vouchers", () => {
  it("dedupes on the natural key and merges distinct reporters", async () => {
    for (const reporter of ["r1", "r1", "r2"]) {
      const { error } = await admin.rpc("upsert_vouchers", { p_items: [base()], p_source: "extension", p_reporter: reporter });
      expect(error).toBeNull();
    }
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0].reporters.sort()).toEqual(["r1", "r2"]);
    expect(list[0].source).toBe("extension");
  });

  it("an API sighting upgrades the source and is never downgraded", async () => {
    await admin.rpc("upsert_vouchers", { p_items: [base()], p_source: "api" });
    await admin.rpc("upsert_vouchers", { p_items: [base()], p_source: "extension", p_reporter: "r3" });
    const [v] = await rows();
    expect(v.source).toBe("api");
  });

  it("a different listing scope is a different voucher", async () => {
    await admin.rpc("upsert_vouchers", { p_items: [{ ...base(), listingId }], p_source: "api" });
    expect(await rows()).toHaveLength(2);
  });

  it("rejects invalid rows via check constraints", async () => {
    const bad = [
      { ...base(), discountType: "percent", discountValue: 150 }, // > 100%
      { ...base(), sellerId: "" }, // shop voucher without seller
      { ...base(), code: "bad code!" }, // code format
    ];
    for (const item of bad) {
      const { error } = await admin.rpc("upsert_vouchers", { p_items: [item], p_source: "api" });
      expect(error).not.toBeNull();
    }
    const { error } = await admin.rpc("upsert_vouchers", { p_items: [base()], p_source: "user" });
    expect(error).not.toBeNull();
  });

  it("anon can read vouchers but cannot call upsert_vouchers or write the table", async () => {
    const { data, error } = await anon.from("vouchers").select("id").eq("seller_id", sellerId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    const { error: rpcErr } = await anon.rpc("upsert_vouchers", { p_items: [base()], p_source: "api" });
    expect(rpcErr).not.toBeNull();
    const { error: insErr } = await anon.from("vouchers").insert({
      marketplace: "shopee",
      kind: "platform",
      discount_type: "amount",
      discount_value: 1,
      source: "api",
    });
    expect(insErr).not.toBeNull();
  });
});
