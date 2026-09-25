import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMatchCandidates } from "@/lib/matching/candidates";
import { bestMatch } from "@/lib/matching/match";
import type { Json } from "@/lib/database.types";
import { admin } from "./helpers";

const tag = randomUUID().slice(0, 8);
const brand = `Brandx${tag}`;
const productIds: string[] = [];
const extIds: string[] = [];
let v1tb: string;
let v2tb: string;

async function ingest(models: Json[], title = `${brand} Nova 9 SSD`) {
  const ext = `test_${randomUUID()}`;
  extIds.push(ext);
  const { data, error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: ext,
      url: `https://shopee.vn/product/1/${ext}`,
      title,
      slug_base: `test-matching-${tag}`,
      source: "seed",
      seller: { external_id: `seller-${tag}`, name: "Test", rating: 4.9, rating_count: 1, is_official: false },
      models,
    },
  });
  if (error) throw error;
  const { data: listing } = await admin.from("listings").select("id").eq("external_item_id", ext).single();
  const { data: offers } = await admin
    .from("offers")
    .select("id, variant_id, match_status, match_confidence, external_model_id")
    .eq("listing_id", listing!.id)
    .order("external_model_id");
  return { result: data as { variant_id: string; product_slug: string }, offers: offers ?? [] };
}

beforeAll(async () => {
  const { data: p, error } = await admin
    .from("products")
    .insert({ canonical_name: `${brand} Nova 9`, brand, model: "Nova 9", status: "verified", slug: `test-verified-${tag}` })
    .select("id")
    .single();
  if (error) throw error;
  productIds.push(p.id);
  const { data: vs } = await admin
    .from("product_variants")
    .insert([
      { product_id: p.id, variant_key: "dung-luong=1TB" },
      { product_id: p.id, variant_key: "dung-luong=2TB" },
    ])
    .select("id, variant_key");
  v1tb = vs!.find((v) => v.variant_key.endsWith("1TB"))!.id;
  v2tb = vs!.find((v) => v.variant_key.endsWith("2TB"))!.id;
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  const { data: drafts } = await admin.from("products").select("id").like("slug", `test-matching-${tag}%`);
  await admin.from("products").delete().in("id", [...productIds, ...(drafts ?? []).map((d) => d.id)]);
  await admin.from("sellers").delete().eq("external_seller_id", `seller-${tag}`);
});

describe("matcher end to end", () => {
  it("loads verified candidates by the brand in the title and picks the right variant", async () => {
    const candidates = await loadMatchCandidates(admin, `Ổ cứng ${brand} Nova 9 NVMe`);
    expect(candidates.map((c) => c.variantId).sort()).toEqual([v1tb, v2tb].sort());
    const m = bestMatch({ title: `Ổ cứng ${brand} Nova 9 NVMe`, modelName: "2TB" }, candidates);
    expect(m?.variantId).toBe(v2tb);
    expect(m!.confidence).toBeGreaterThanOrEqual(0.95);
  });
});

describe("ingest_shopee_item with matches", () => {
  it("confidence ≥ 0.95 → offer attached to the verified variant, no draft product", async () => {
    const { result, offers } = await ingest([
      { model_id: "m1", name: "2TB", price: 2_000_000, stock: 5, match: { variant_id: v2tb, confidence: 0.97, reason: "t" } },
    ]);
    expect(offers[0]).toMatchObject({ variant_id: v2tb, match_status: "auto" });
    expect(Number(offers[0].match_confidence)).toBeCloseTo(0.97);
    expect(result.variant_id).toBe(v2tb);
    expect(result.product_slug).toBe(`test-verified-${tag}`);
    const { count } = await admin.from("products").select("id", { count: "exact", head: true }).like("slug", `test-matching-${tag}%`);
    expect(count).toBe(0);
  });

  it("confidence < 0.95 → draft variant + a pending match_candidates suggestion", async () => {
    const { offers } = await ingest([
      { model_id: "m1", name: "2TB", price: 2_100_000, stock: 5, match: { variant_id: v2tb, confidence: 0.8, reason: "gợi ý" } },
    ]);
    expect(offers[0].match_status).toBe("pending");
    expect(offers[0].variant_id).not.toBe(v2tb);
    const { data: mc } = await admin.from("match_candidates").select("*").eq("offer_id", offers[0].id);
    expect(mc).toHaveLength(1);
    expect(mc![0]).toMatchObject({ suggested_variant_id: v2tb, decision: "pending", reason: "gợi ý" });
  });

  it("never attaches to a draft variant even with confidence 1", async () => {
    const { offers: first } = await ingest([{ model_id: "m1", name: "x", price: 100_000, stock: 1 }]);
    const draftVariant = first[0].variant_id!;
    const { offers } = await ingest([
      { model_id: "m1", name: "x", price: 100_000, stock: 1, match: { variant_id: draftVariant, confidence: 1, reason: "t" } },
    ]);
    expect(offers[0].match_status).toBe("pending");
    expect(offers[0].variant_id).not.toBe(draftVariant);
  });

  it("variant_current_price = cheapest in-stock offer across listings", async () => {
    // Variant 1TB: one cheap but out of stock, one in stock.
    await ingest([{ model_id: "a", name: "1TB", price: 900_000, stock: 0, match: { variant_id: v1tb, confidence: 0.99, reason: "t" } }]);
    await ingest([{ model_id: "b", name: "1TB", price: 1_200_000, stock: 3, match: { variant_id: v1tb, confidence: 0.99, reason: "t" } }]);
    const { data } = await admin.from("variant_current_price").select("*").eq("variant_id", v1tb).single();
    expect(Number(data!.price)).toBe(1_200_000);
    expect(data!.in_stock).toBe(true);
    expect(data!.offer_count).toBe(2);
  });
});
