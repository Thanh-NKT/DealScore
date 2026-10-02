import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

const tag = `zq${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const extIds: string[] = [];

async function ingest(opts: {
  ext: string;
  price: number;
  key: string | null;
  models?: number;
  match?: { variant_id: string; confidence: number; reason: string };
}) {
  extIds.push(opts.ext);
  const models = Array.from({ length: opts.models ?? 1 }, (_, i) => ({
    model_id: `m${i}`,
    name: i ? `v${i}` : "",
    price: opts.price,
    ...(i === 0 && opts.match ? { match: opts.match } : {}),
  }));
  const { data, error } = await admin.rpc("ingest_listing", {
    p: {
      marketplace: "shopee",
      ext_item_id: opts.ext,
      url: `https://shopee.vn/product/1/${opts.ext}`,
      title: `Tai nghe ${tag} chính hãng`,
      slug_base: `test-${tag}`,
      source: "seed",
      seller: { external_id: `seller-${tag}-${opts.ext}`, name: "Test" },
      models,
      draft_key: opts.key,
    },
  });
  if (error) throw error;
  return data as { product_slug: string; variant_id: string };
}

async function productIdOf(ext: string) {
  const { data } = await admin
    .from("offers")
    .select("product_variants!inner(product_id), listings!inner(external_item_id)")
    .eq("listings.external_item_id", ext)
    .limit(1)
    .single();
  return (data as unknown as { product_variants: { product_id: string } }).product_variants.product_id;
}

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-${tag}%`);
  await admin.from("sellers").delete().like("external_seller_id", `seller-${tag}%`);
});

describe("ingest_listing draft clustering", () => {
  it("same key + price within ×2 → one draft, one variant, two offers; key stored", async () => {
    const k = `sony|${tag}`;
    const a = await ingest({ ext: `1${tag}a`, price: 1_000_000, key: k });
    const b = await ingest({ ext: `1${tag}b`, price: 1_500_000, key: k });
    expect(b.variant_id).toBe(a.variant_id);
    const { data: p } = await admin.from("products").select("draft_key, status").eq("id", await productIdOf(`1${tag}a`)).single();
    expect(p).toEqual({ draft_key: k, status: "draft" });
  });

  it("price outside ×2 → separate draft", async () => {
    const k = `sony|${tag}x`;
    await ingest({ ext: `2${tag}a`, price: 1_000_000, key: k });
    await ingest({ ext: `2${tag}b`, price: 2_500_000, key: k });
    expect(await productIdOf(`2${tag}a`)).not.toBe(await productIdOf(`2${tag}b`));
  });

  it("multi-model payload or null key → never clusters", async () => {
    const k = `sony|${tag}y`;
    await ingest({ ext: `3${tag}a`, price: 1_000_000, key: k });
    await ingest({ ext: `3${tag}b`, price: 1_000_000, key: k, models: 2 });
    await ingest({ ext: `3${tag}c`, price: 1_000_000, key: null });
    const ids = new Set([await productIdOf(`3${tag}a`), await productIdOf(`3${tag}b`), await productIdOf(`3${tag}c`)]);
    expect(ids.size).toBe(3);
  });
});

describe("ingest_listing draft clustering guards (0020)", () => {
  it("price band is anchored on the whole cluster (min and max), not on its drifting minimum", async () => {
    const k = `sony|${tag}band`;
    await ingest({ ext: `5${tag}a`, price: 1_000_000, key: k });
    await ingest({ ext: `5${tag}b`, price: 1_900_000, key: k });
    const cluster = await productIdOf(`5${tag}a`);
    expect(await productIdOf(`5${tag}b`)).toBe(cluster);
    // 0.6M is within ×2 of the minimum 1.0M but not of the maximum 1.9M (1.9M × 0.5 = 0.95M).
    await ingest({ ext: `5${tag}c`, price: 600_000, key: k });
    expect(await productIdOf(`5${tag}c`)).not.toBe(cluster);
    await ingest({ ext: `5${tag}d`, price: 1_200_000, key: k });
    expect(await productIdOf(`5${tag}d`)).toBe(cluster);
  });

  it("a verified auto-match beats an existing draft with the same key", async () => {
    const k = `sony|${tag}ver`;
    await ingest({ ext: `6${tag}a`, price: 1_000_000, key: k });
    const draft = await productIdOf(`6${tag}a`);

    const { data: product, error: pe } = await admin
      .from("products")
      .insert({ canonical_name: `Verified ${tag}`, status: "verified", slug: `test-${tag}-verified`, specs: {} })
      .select("id")
      .single();
    if (pe) throw pe;
    const { data: variant, error: ve } = await admin
      .from("product_variants")
      .insert({ product_id: product.id, variant_key: "Tiêu chuẩn", specs: {} })
      .select("id")
      .single();
    if (ve) throw ve;

    await ingest({ ext: `6${tag}b`, price: 1_000_000, key: k, match: { variant_id: variant.id, confidence: 0.97, reason: "t" } });

    const { data: offer } = await admin
      .from("offers")
      .select("variant_id, match_status, listings!inner(external_item_id)")
      .eq("listings.external_item_id", `6${tag}b`)
      .single();
    expect(offer).toMatchObject({ variant_id: variant.id, match_status: "auto" });

    const { data: draftOffers } = await admin
      .from("offers")
      .select("listing_id, product_variants!inner(product_id)")
      .eq("product_variants.product_id", draft);
    expect(new Set((draftOffers ?? []).map((o) => o.listing_id)).size).toBe(1);
  });
});

describe("search_products v8", () => {
  it("hides single-listing drafts, shows drafts with ≥ 2 listings", async () => {
    const k = `sony|${tag}z`;
    await ingest({ ext: `4${tag}a`, price: 900_000, key: k });
    let { data } = await admin.rpc("search_products", { p_q: tag });
    const before = (data ?? []).map((r) => r.product_id);
    const lone = await productIdOf(`4${tag}a`);
    expect(before).not.toContain(lone);
    await ingest({ ext: `4${tag}b`, price: 950_000, key: k });
    ({ data } = await admin.rpc("search_products", { p_q: tag }));
    expect((data ?? []).map((r) => r.product_id)).toContain(lone);
    for (const r of data ?? []) expect(Number(r.total_count)).toBe((data ?? []).length);
  });
});
