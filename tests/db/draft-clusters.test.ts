import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

const tag = `zq${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const extIds: string[] = [];

async function ingest(opts: { ext: string; price: number; key: string | null; models?: number }) {
  extIds.push(opts.ext);
  const models = Array.from({ length: opts.models ?? 1 }, (_, i) => ({ model_id: `m${i}`, name: i ? `v${i}` : "", price: opts.price }));
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
