import { randomUUID } from "node:crypto";
import { admin } from "./helpers";

/**
 * Per-file catalog fixtures (P4 review I4): a test never picks or edits an arbitrary pre-existing catalog row
 * (the owner's local data or another file's fixture). Each file creates its own category + products and
 * removes them in afterAll via `cleanup()`.
 */
export interface FixtureProduct {
  productId: string;
  variantId: string;
  price: number;
}

export interface FixtureCatalog {
  tag: string;
  categoryId: string;
  categorySlug: string;
  /** A verified product with one variant and a current price (observed `observedHoursAgo` hours ago). */
  product(opts: { price: number; observedHoursAgo?: number; name?: string; inStock?: boolean }): Promise<FixtureProduct>;
  products: FixtureProduct[];
  cleanup(): Promise<void>;
}

export async function createFixtureCatalog(prefix: string): Promise<FixtureCatalog> {
  const tag = randomUUID().slice(0, 8);
  const categorySlug = `test-${prefix}-${tag}`;
  const { data: cat, error } = await admin
    .from("categories")
    .insert({ slug: categorySlug, name: `Test ${prefix} ${tag}` })
    .select("id")
    .single();
  if (error) throw error;
  const products: FixtureProduct[] = [];
  const catalog: FixtureCatalog = {
    tag,
    categoryId: cat.id,
    categorySlug,
    products,
    async product({ price, observedHoursAgo = 1, name, inStock = true }) {
      const n = products.length;
      const { data: p, error: pErr } = await admin
        .from("products")
        .insert({
          canonical_name: name ?? `Fixture ${prefix} ${tag} ${n}`,
          slug: `${categorySlug}-${n}`,
          status: "verified",
          category_id: cat.id,
        })
        .select("id")
        .single();
      if (pErr) throw pErr;
      const { data: v, error: vErr } = await admin
        .from("product_variants")
        .insert({ product_id: p.id, variant_key: "x" })
        .select("id")
        .single();
      if (vErr) throw vErr;
      const { error: cErr } = await admin.from("variant_current_price").insert({
        variant_id: v.id,
        price,
        in_stock: inStock,
        offer_count: 1,
        observed_at: new Date(Date.now() - observedHoursAgo * 3_600_000).toISOString(),
      });
      if (cErr) throw cErr;
      const fp = { productId: p.id, variantId: v.id, price };
      products.push(fp);
      return fp;
    },
    async cleanup() {
      const ids = products.map((p) => p.productId);
      for (let i = 0; i < ids.length; i += 100) await admin.from("products").delete().in("id", ids.slice(i, i + 100));
      await admin.from("categories").delete().eq("id", cat.id);
    },
  };
  return catalog;
}
