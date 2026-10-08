import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAttributeTables } from "@/lib/matching/attribute-table";
import { admin } from "./helpers";

// POST /api/admin/matching/attributes data (roadmap P3 item 15): match_candidates → offer (A) vs suggestion (B).
const tag = `ma${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const productIds: string[] = [];
const listingIds: string[] = [];
let onDraft: string;
let onVerified: string;
let noSuggestion: string;

async function product(status: "draft" | "verified", brand: string | null, model: string | null, keys: string[]) {
  const { data: p, error } = await admin.from("products")
    .insert({ canonical_name: `${brand ?? ""} ${model ?? ""} ${tag}`, brand, model, status, slug: `test-${tag}-${productIds.length}` })
    .select("id").single();
  if (error) throw error;
  productIds.push(p.id);
  const ids: string[] = [];
  for (const k of keys) {
    const { data: v } = await admin.from("product_variants").insert({ product_id: p.id, variant_key: k }).select("id").single();
    ids.push(v!.id);
  }
  return ids;
}
async function offer(title: string, variantId: string) {
  const ext = `${tag}-${listingIds.length}`;
  const { data: l } = await admin.from("listings")
    .insert({ marketplace: "shopee", external_item_id: ext, url: `https://shopee.vn/${ext}`, title, status: "active" }).select("id").single();
  listingIds.push(l!.id);
  const { data: o } = await admin.from("offers").insert({ listing_id: l!.id, variant_id: variantId, match_status: "pending" }).select("id").single();
  return o!.id;
}
async function cand(offerId: string, suggested: string | null) {
  const { data } = await admin.from("match_candidates")
    .insert({ offer_id: offerId, suggested_variant_id: suggested, confidence: 0.7, decision: "pending" }).select("id").single();
  return data!.id;
}

beforeAll(async () => {
  const [v1tb, v2tb] = await product("verified", "Samsung", "990 Pro", ["1TB", "2TB"]);
  const [draftVariant] = await product("draft", null, null, ["2TB"]);
  const [otherVerified] = await product("verified", "Samsung", "980", ["Đen"]);
  onDraft = await cand(await offer("SSD Samsung 990 PRO NVMe", draftVariant), v2tb);
  // The offer sits on a verified product: its variant name is the catalog's, not the listing's model name.
  onVerified = await cand(await offer("Samsung 990 Pro NVMe", otherVerified), v1tb);
  noSuggestion = await cand(await offer("Samsung 990 Pro", draftVariant), null);
});

afterAll(async () => {
  await admin.from("listings").delete().in("id", listingIds);
  await admin.from("products").delete().in("id", productIds);
});

describe("loadAttributeTables", () => {
  it("compares the listing (title + draft model name) with the suggested variant", async () => {
    const items = await loadAttributeTables(admin, [onDraft]);
    expect(items).toHaveLength(1);
    expect(items[0].candidateId).toBe(onDraft);
    const rows = Object.fromEntries(items[0].rows.map((r) => [r.key, r]));
    expect(rows.brand).toMatchObject({ state: "match", catalog: "Samsung" });
    expect(rows.model).toMatchObject({ state: "match", catalog: "990 Pro" });
    expect(rows.capacityGb).toMatchObject({ state: "match", offer: "2TB", catalog: "2TB" });
  });

  it("an offer on a verified product uses an empty model name", async () => {
    const [item] = await loadAttributeTables(admin, [onVerified]);
    const cap = item.rows.find((r) => r.key === "capacityGb")!;
    // "Đen" (the verified variant) is not read as the listing's model name → no offer capacity → unknown.
    expect(cap).toMatchObject({ state: "unknown", offer: null, catalog: "1TB" });
    expect(item.rows.find((r) => r.key === "color")!.offer).toBeNull();
  });

  it("drops deleted candidates and candidates without a suggestion; keeps the request order", async () => {
    const items = await loadAttributeTables(admin, [randomUUID(), onVerified, noSuggestion, onDraft]);
    expect(items.map((i) => i.candidateId)).toEqual([onVerified, onDraft]);
  });
});
