import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";
import { saveListingExtras } from "@/lib/listing-extras";
import { parseSellerVoucherHistory } from "@/lib/vouchers/patterns";

// Roadmap P4 K (0063): voucher_sightings / voucher_seller_checks, upsert_vouchers, record_voucher_check,
// seller_voucher_history. Uses its own seller + listing (removed after).
let sellerId = "";
let listingId = "";
beforeAll(async () => {
  const { data: s, error } = await admin
    .from("sellers")
    .insert({ marketplace: "shopee", external_seller_id: `p4-vh-${randomUUID()}`, name: "Shop P4 test" })
    .select("id")
    .single();
  if (error) throw error;
  sellerId = s.id;
  const { data: l, error: lErr } = await admin
    .from("listings")
    .insert({ marketplace: "shopee", external_item_id: `p4-vh-${randomUUID()}`, seller_id: sellerId, title: "x" })
    .select("id")
    .single();
  if (lErr) throw lErr;
  listingId = l.id;
});
afterAll(async () => {
  await admin.from("listings").delete().eq("id", listingId);
  await admin.from("sellers").delete().eq("id", sellerId);
});

const shopVoucher = (value: number) => ({ kind: "shop", discountType: "amount", discountValue: value, minSpend: 500_000, code: "SHOP50K" });
async function sightingsOf(value: number) {
  const { data } = await admin.from("vouchers").select("id, voucher_sightings(day)").eq("seller_id", sellerId).eq("discount_value", value);
  return (data ?? []).flatMap((v) => (v.voucher_sightings as Array<{ day: string }>) ?? []);
}
async function checks() {
  const { data } = await admin.from("voucher_seller_checks").select("day, vouchers_seen").eq("seller_id", sellerId);
  return data ?? [];
}

describe("voucher history", () => {
  it("an extension voucher with one reporter leaves no sighting; a second reporter adds one; no check row", async () => {
    await saveListingExtras(admin, listingId, { source: "extension", reporter: "r1", vouchers: [shopVoucher(11_000)] }, { refreshEffective: false });
    expect(await sightingsOf(11_000)).toEqual([]);
    await saveListingExtras(admin, listingId, { source: "extension", reporter: "r2", vouchers: [shopVoucher(11_000)] }, { refreshEffective: false });
    expect(await sightingsOf(11_000)).toHaveLength(1);
    expect(await checks()).toEqual([]);
  });

  it("an API voucher seen twice the same day → one sighting row; an API answer with [] records a check", async () => {
    await saveListingExtras(admin, listingId, { source: "api", vouchers: [shopVoucher(50_000)] }, { refreshEffective: false });
    await saveListingExtras(admin, listingId, { source: "api", vouchers: [shopVoucher(50_000)] }, { refreshEffective: false });
    expect(await sightingsOf(50_000)).toHaveLength(1);
    expect((await checks())[0].vouchers_seen).toBe(1);
    await saveListingExtras(admin, listingId, { source: "api", vouchers: [] }, { refreshEffective: false });
    const c = await checks();
    expect(c).toHaveLength(1);
    expect(c[0].vouchers_seen).toBe(1); // greatest(existing, 0)
  });

  it("a source with no voucher list records no check", async () => {
    await admin.from("voucher_seller_checks").delete().eq("seller_id", sellerId);
    await saveListingExtras(admin, listingId, { source: "api", images: [] }, { refreshEffective: false });
    expect(await checks()).toEqual([]);
  });

  it("seller_voucher_history groups by shape, counts check days / months, clamps p_days", async () => {
    await admin.rpc("record_voucher_check", { p_seller_id: sellerId, p_vouchers_seen: 1 });
    const { data, error } = await admin.rpc("seller_voucher_history", { p_seller_id: sellerId, p_days: 5 });
    expect(error).toBeNull();
    const h = parseSellerVoucherHistory(data);
    expect(h.checkDays).toBe(1);
    expect(h.checkMonths).toHaveLength(1);
    const s50 = h.shapes.find((s) => s.discountValue === 50_000)!;
    expect(s50).toMatchObject({ discountType: "amount", minSpend: 500_000, hasCode: true });
    expect(s50.days).toHaveLength(1);
  });

  it("anon can read the history (public catalog) but cannot record a check", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await anon.rpc("seller_voucher_history", { p_seller_id: sellerId })).error).toBeNull();
    expect((await anon.rpc("record_voucher_check", { p_seller_id: sellerId, p_vouchers_seen: 1 })).error?.code).toBe("42501");
    expect((await anon.from("voucher_sightings").insert({ voucher_id: randomUUID(), day: "2026-10-01" })).error).not.toBeNull();
  });
});
