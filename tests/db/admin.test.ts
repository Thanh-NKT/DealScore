import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const tag = `adm${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const extIds: string[] = [];
let categoryId: string;
let verifiedVariantId: string;
let verifiedProductId: string;
let user: TestUser;

async function ingestDraft(ext: string, price: number, title = `Tai nghe ${tag}`) {
  extIds.push(ext);
  const { data, error } = await admin.rpc("ingest_listing", {
    p: {
      marketplace: "shopee", ext_item_id: ext, url: `https://shopee.vn/product/1/${ext}`, title,
      slug_base: `test-${tag}`, source: "seed", seller: { external_id: `seller-${tag}-${ext}`, name: "S" },
      models: [{ model_id: "default", name: "", price }], draft_key: null,
    },
  });
  if (error) throw error;
  return data as { variant_id: string };
}
async function offerOf(ext: string) {
  const { data } = await admin.from("offers").select("id, variant_id, match_status, listings!inner(external_item_id)")
    .eq("listings.external_item_id", ext).single();
  return data!;
}
async function productOfVariant(variantId: string) {
  const { data } = await admin.from("product_variants").select("product_id").eq("id", variantId).maybeSingle();
  return data?.product_id ?? null;
}

beforeAll(async () => {
  user = await createTestUser();
  const { data: c } = await admin.from("categories").select("id").limit(1).single();
  categoryId = c!.id;
  const { data: p } = await admin.from("products")
    .insert({ canonical_name: `Verified ${tag}`, brand: "Sony", model: "X", status: "verified", slug: `test-${tag}-verified`, category_id: categoryId })
    .select("id").single();
  verifiedProductId = p!.id;
  const { data: v } = await admin.from("product_variants").insert({ product_id: verifiedProductId, variant_key: "Đen" }).select("id").single();
  verifiedVariantId = v!.id;
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-${tag}%`);
  await admin.from("sellers").delete().like("external_seller_id", `seller-${tag}%`);
  await admin.from("admin_audit").delete().like("note", `${tag}%`);
  await deleteTestUser(user.id);
});

describe("admin_promote_draft", () => {
  it("promotes a draft, marks offers manual, logs it", async () => {
    const d = await ingestDraft(`1${tag}`, 900_000);
    const productId = await productOfVariant(d.variant_id);
    const { data, error } = await admin.rpc("admin_promote_draft", {
      p_product_id: productId!,
      p: { canonical_name: `Sony ${tag}`, brand: "Sony", model: "WH", category_id: categoryId,
           variants: [{ id: d.variant_id, variant_key: "Đen", capacity_gb: null }] },
    });
    expect(error).toBeNull();
    expect((data as { product_id: string }).product_id).toBe(productId);
    const { data: p } = await admin.from("products").select("status, brand, draft_key").eq("id", productId!).single();
    expect(p).toEqual({ status: "verified", brand: "Sony", draft_key: null });
    expect((await offerOf(`1${tag}`)).match_status).toBe("manual");
    const { data: log } = await admin.from("admin_audit").select("action, entity").eq("entity_id", productId!);
    expect(log).toEqual([{ action: "draft.promote", entity: "product" }]);
  });

  it("rejects a verified product or missing fields", async () => {
    const notDraft = await admin.rpc("admin_promote_draft", {
      p_product_id: verifiedProductId, p: { canonical_name: "x", brand: "x", category_id: categoryId, variants: [] },
    });
    expect(notDraft.error?.message).toContain("nháp");
    const d = await ingestDraft(`2${tag}`, 900_000);
    const missing = await admin.rpc("admin_promote_draft", {
      p_product_id: (await productOfVariant(d.variant_id))!, p: { canonical_name: "x", variants: [] },
    });
    expect(missing.error?.message).toContain("thiếu");
  });
});

describe("admin_move_offer", () => {
  it("moves to a verified variant and deletes the emptied draft", async () => {
    const d = await ingestDraft(`3${tag}`, 900_000);
    const draftProduct = await productOfVariant(d.variant_id);
    const offer = await offerOf(`3${tag}`);
    const { data, error } = await admin.rpc("admin_move_offer", { p_offer_id: offer.id, p_target_variant_id: verifiedVariantId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ to_variant_id: verifiedVariantId, deleted_product_id: draftProduct });
    expect(await offerOf(`3${tag}`)).toMatchObject({ variant_id: verifiedVariantId, match_status: "manual" });
    expect(await productOfVariant(d.variant_id)).toBeNull();
  });

  it("moves to a new draft without draft_key", async () => {
    await ingestDraft(`4${tag}a`, 900_000);
    const offer = await offerOf(`4${tag}a`);
    const { data, error } = await admin.rpc("admin_move_offer", { p_offer_id: offer.id });
    expect(error).toBeNull();
    const toProduct = (data as { to_product_id: string }).to_product_id;
    const { data: p } = await admin.from("products").select("status, draft_key").eq("id", toProduct).single();
    expect(p).toEqual({ status: "draft", draft_key: null });
  });
});

describe("admin_review_match", () => {
  async function candidateFor(ext: string) {
    const offer = await offerOf(ext);
    const { data } = await admin.from("match_candidates")
      .insert({ offer_id: offer.id, suggested_variant_id: verifiedVariantId, confidence: 0.8, reason: "t", decision: "pending" })
      .select("id").single();
    return data!.id;
  }
  it("accept attaches the offer to the suggestion", async () => {
    await ingestDraft(`5${tag}`, 900_000);
    const id = await candidateFor(`5${tag}`);
    const { error } = await admin.rpc("admin_review_match", { p_candidate_id: id, p_decision: "accept" });
    expect(error).toBeNull();
    expect(await offerOf(`5${tag}`)).toMatchObject({ variant_id: verifiedVariantId, match_status: "manual" });
    const { data: c } = await admin.from("match_candidates").select("decision").eq("id", id).single();
    expect(c!.decision).toBe("accepted");
  });
  it("reject leaves the offer and marks the candidate", async () => {
    const d = await ingestDraft(`6${tag}`, 900_000);
    const id = await candidateFor(`6${tag}`);
    await admin.rpc("admin_review_match", { p_candidate_id: id, p_decision: "reject" });
    expect((await offerOf(`6${tag}`)).variant_id).toBe(d.variant_id);
    const { data: c } = await admin.from("match_candidates").select("decision").eq("id", id).single();
    expect(c!.decision).toBe("rejected");
  });
  it("reassign requires a verified variant", async () => {
    const d = await ingestDraft(`7${tag}`, 900_000);
    const id = await candidateFor(`7${tag}`);
    const bad = await admin.rpc("admin_review_match", { p_candidate_id: id, p_decision: "reassign", p_variant_id: d.variant_id });
    expect(bad.error).not.toBeNull();
  });
});

describe("other admin RPCs", () => {
  it("set_listings_inactive, cron_status, overview_counts", async () => {
    await ingestDraft(`8${tag}`, 900_000);
    const { data: l } = await admin.from("listings").select("id").eq("external_item_id", `8${tag}`).single();
    const { data: n } = await admin.rpc("admin_set_listings_inactive", { p_listing_ids: [l!.id], p_note: `${tag} test` });
    expect(n).toBe(1);
    const { data: cron, error: cronErr } = await admin.rpc("admin_cron_status");
    expect(cronErr).toBeNull();
    for (const j of cron ?? []) expect(j.jobname.startsWith("kairo-")).toBe(true);
    const { data: counts, error: cErr } = await admin.rpc("admin_overview_counts");
    expect(cErr).toBeNull();
    expect(counts).toHaveProperty("drafts_multi_shop");
    const { data: drafts, error: dErr } = await admin.from("admin_drafts").select("id, listing_count").limit(5);
    expect(dErr).toBeNull();
    for (const d of drafts ?? []) expect(typeof d.listing_count).toBe("number");
  });

  it("anon/authenticated cannot call admin RPCs or read admin_audit", async () => {
    const { error } = await user.client.rpc("admin_overview_counts");
    expect(error).not.toBeNull();
    const { data } = await user.client.from("admin_audit").select("*");
    expect(data ?? []).toEqual([]);
  });
});
