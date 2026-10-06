import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Admin RPCs × ingest_listing draft clustering (DB review I2). Each round races an admin action on a draft
// against an ingest that wants to join the same draft cluster, then checks the invariants the locks protect.
const tag = `acc${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const extIds: string[] = [];
const createdProductIds: string[] = [];
let categoryId: string;
let verifiedVariantId: string;

const ROUNDS = 12;

async function ingest(ext: string, key: string, price = 1_000_000) {
  extIds.push(ext);
  return admin.rpc("ingest_listing", {
    p: {
      marketplace: "shopee", ext_item_id: ext, url: `https://shopee.vn/product/1/${ext}`,
      title: `Loa ${tag}`, slug_base: `test-${tag}`, source: "seed",
      seller: { external_id: `seller-${tag}-${ext}`, name: "S" },
      models: [{ model_id: "default", name: "", price }], draft_key: key,
    },
  });
}

async function offerOf(ext: string) {
  const { data } = await admin
    .from("offers")
    .select("id, variant_id, match_status, product_variants(product_id, products(status)), listings!inner(external_item_id)")
    .eq("listings.external_item_id", ext)
    .single();
  return data as unknown as {
    id: string; variant_id: string | null; match_status: string;
    product_variants: { product_id: string; products: { status: string } } | null;
  };
}

beforeAll(async () => {
  const { data: c } = await admin.from("categories").select("id").limit(1).single();
  categoryId = c!.id;
  const { data: p } = await admin.from("products")
    .insert({ canonical_name: `Verified ${tag}`, brand: "Sony", status: "verified", slug: `test-${tag}-verified`, category_id: categoryId })
    .select("id").single();
  const { data: v } = await admin.from("product_variants").insert({ product_id: p!.id, variant_key: "Đen" }).select("id").single();
  verifiedVariantId = v!.id;
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-${tag}%`);
  if (createdProductIds.length) await admin.from("products").delete().in("id", createdProductIds);
  await admin.from("sellers").delete().like("external_seller_id", `seller-${tag}%`);
});

describe("admin RPCs serialize with draft clustering", () => {
  it("moving a draft's only offer while another shop joins the draft never orphans the newcomer", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const key = `sony|${tag}|move${i}`;
      const first = await ingest(`mv${i}a${tag}`, key);
      expect(first.error).toBeNull();
      const x = await offerOf(`mv${i}a${tag}`);
      const [move, join] = await Promise.all([
        admin.rpc("admin_move_offer", { p_offer_id: x.id, p_target_variant_id: verifiedVariantId }),
        ingest(`mv${i}b${tag}`, key),
      ]);
      expect(move.error).toBeNull();
      expect(join.error).toBeNull();
      const y = await offerOf(`mv${i}b${tag}`);
      expect(y.variant_id).not.toBeNull();
      expect(y.product_variants).not.toBeNull();
    }
  });

  it("promoting a draft while another shop joins it leaves no pending offer on the verified product", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const key = `sony|${tag}|promote${i}`;
      const first = await ingest(`pr${i}a${tag}`, key);
      expect(first.error).toBeNull();
      const x = await offerOf(`pr${i}a${tag}`);
      const productId = x.product_variants!.product_id;
      const [promote, join] = await Promise.all([
        admin.rpc("admin_promote_draft", {
          p_product_id: productId,
          p: { canonical_name: `Sony ${tag} ${i}`, brand: "Sony", category_id: categoryId, variants: [] },
        }),
        ingest(`pr${i}b${tag}`, key),
      ]);
      expect(promote.error).toBeNull();
      expect(join.error).toBeNull();
      const y = await offerOf(`pr${i}b${tag}`);
      if (y.product_variants?.products.status === "verified") {
        expect(y.match_status).not.toBe("pending");
      } else {
        createdProductIds.push(y.product_variants!.product_id);
      }
    }
  });
});
