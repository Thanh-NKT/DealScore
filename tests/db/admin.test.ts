import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const tag = `adm${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const extIds: string[] = [];
// Everything the tests create outside the `test-${tag}` slug space: new drafts from admin_move_offer (slug from
// the listing title) and the audit rows the RPCs write (entity ids of offers / candidates / products).
const createdProductIds: string[] = [];
const auditEntityIds: string[] = [];
// admin.rpc with bookkeeping for afterAll; keeps admin.rpc's typing.
const adminRpc = (async (fn: string, args?: Record<string, unknown>) => {
  const res = await admin.rpc(fn as never, args as never);
  for (const k of ["p_offer_id", "p_candidate_id", "p_product_id"]) {
    if (typeof args?.[k] === "string") auditEntityIds.push(args[k] as string);
  }
  const toProduct = (res.data as { to_product_id?: string | null } | null)?.to_product_id;
  if (toProduct) createdProductIds.push(toProduct);
  return res;
}) as unknown as typeof admin.rpc;
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
  if (createdProductIds.length) await admin.from("products").delete().in("id", createdProductIds);
  await admin.from("admin_audit").delete().like("note", `${tag}%`);
  if (auditEntityIds.length) {
    const { data: rows } = await admin.from("admin_audit").select("id").in("entity_id", auditEntityIds);
    const auditIds = (rows ?? []).map((r) => r.id);
    if (auditIds.length) await admin.from("admin_audit").delete().in("id", auditIds);
  }
  await deleteTestUser(user.id);
});

describe("admin_promote_draft", () => {
  it("promotes a draft, marks offers manual, logs it", async () => {
    const d = await ingestDraft(`1${tag}`, 900_000);
    const productId = await productOfVariant(d.variant_id);
    const { data, error } = await adminRpc("admin_promote_draft", {
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
    const notDraft = await adminRpc("admin_promote_draft", {
      p_product_id: verifiedProductId, p: { canonical_name: "x", brand: "x", category_id: categoryId, variants: [] },
    });
    expect(notDraft.error?.message).toContain("nháp");
    const d = await ingestDraft(`2${tag}`, 900_000);
    const missing = await adminRpc("admin_promote_draft", {
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
    const { data, error } = await adminRpc("admin_move_offer", { p_offer_id: offer.id, p_target_variant_id: verifiedVariantId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ to_variant_id: verifiedVariantId, deleted_product_id: draftProduct });
    expect(await offerOf(`3${tag}`)).toMatchObject({ variant_id: verifiedVariantId, match_status: "manual" });
    expect(await productOfVariant(d.variant_id)).toBeNull();
  });

  it("moves to a new draft without draft_key", async () => {
    await ingestDraft(`4${tag}a`, 900_000);
    const offer = await offerOf(`4${tag}a`);
    const { data, error } = await adminRpc("admin_move_offer", { p_offer_id: offer.id });
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
    const { error } = await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "accept" });
    expect(error).toBeNull();
    expect(await offerOf(`5${tag}`)).toMatchObject({ variant_id: verifiedVariantId, match_status: "manual" });
    const { data: c } = await admin.from("match_candidates").select("decision").eq("id", id).single();
    expect(c!.decision).toBe("accepted");
  });
  it("reject leaves the offer and marks the candidate", async () => {
    const d = await ingestDraft(`6${tag}`, 900_000);
    const id = await candidateFor(`6${tag}`);
    await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "reject" });
    expect((await offerOf(`6${tag}`)).variant_id).toBe(d.variant_id);
    const { data: c } = await admin.from("match_candidates").select("decision").eq("id", id).single();
    expect(c!.decision).toBe("rejected");
  });
  it("reassign requires a verified variant", async () => {
    const d = await ingestDraft(`7${tag}`, 900_000);
    const id = await candidateFor(`7${tag}`);
    const bad = await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "reassign", p_variant_id: d.variant_id });
    expect(bad.error).not.toBeNull();
  });
});

describe("review fixes", () => {
  async function pendingCandidate(ext: string) {
    const offer = await offerOf(ext);
    const { data } = await admin.from("match_candidates")
      .insert({ offer_id: offer.id, suggested_variant_id: verifiedVariantId, confidence: 0.8, reason: "t", decision: "pending" })
      .select("id").single();
    return data!.id;
  }
  async function decisionOf(id: string) {
    const { data } = await admin.from("match_candidates").select("decision").eq("id", id).single();
    return data!.decision;
  }
  async function watchesOf(userId: string) {
    const { data } = await admin.from("watches").select("id, variant_id, product_id").eq("user_id", userId);
    return data ?? [];
  }

  it("moving the only offer of a watched draft re-points the watch", async () => {
    const d = await ingestDraft(`w1${tag}`, 900_000);
    const draftProduct = await productOfVariant(d.variant_id);
    const { data: w, error: wErr } = await admin.from("watches")
      .insert({ user_id: user.id, variant_id: d.variant_id, target_price: 800_000 }).select("id").single();
    expect(wErr).toBeNull();
    const offer = await offerOf(`w1${tag}`);
    const { data, error } = await adminRpc("admin_move_offer", { p_offer_id: offer.id, p_target_variant_id: verifiedVariantId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ deleted_product_id: draftProduct });
    expect(await watchesOf(user.id)).toEqual([{ id: w!.id, variant_id: verifiedVariantId, product_id: verifiedProductId }]);
    const { data: log } = await admin.from("admin_audit").select("after").eq("entity_id", offer.id).single();
    expect(log!.after).toMatchObject({ moved_watches: 1, dropped_watches: 0 });
  });

  it("a draft watch duplicating the user's target watch is dropped, the target watch stays", async () => {
    const d = await ingestDraft(`w2${tag}`, 900_000);
    await admin.from("watches").insert({ user_id: user.id, variant_id: d.variant_id, target_price: 700_000 });
    expect(await watchesOf(user.id)).toHaveLength(2);
    const id = await pendingCandidate(`w2${tag}`);
    const { error } = await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "accept" });
    expect(error).toBeNull();
    const after = await watchesOf(user.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ variant_id: verifiedVariantId });
    const { data: log } = await admin.from("admin_audit").select("after").eq("entity_id", id).single();
    expect(log!.after).toMatchObject({ moved_watches: 0, dropped_watches: 1 });
  });

  it("promote rejects the draft's pending candidates", async () => {
    const d = await ingestDraft(`p1${tag}`, 900_000);
    const id = await pendingCandidate(`p1${tag}`);
    const { error } = await adminRpc("admin_promote_draft", {
      p_product_id: (await productOfVariant(d.variant_id))!,
      p: { canonical_name: `Sony P ${tag}`, brand: "Sony", category_id: categoryId, variants: [] },
    });
    expect(error).toBeNull();
    expect(await decisionOf(id)).toBe("rejected");
  });

  it("move closes the moved offer's pending candidates", async () => {
    await ingestDraft(`m1${tag}`, 900_000);
    const id = await pendingCandidate(`m1${tag}`);
    const offer = await offerOf(`m1${tag}`);
    const { error } = await adminRpc("admin_move_offer", { p_offer_id: offer.id });
    expect(error).toBeNull();
    expect(await decisionOf(id)).toBe("rejected");
  });

  it("moving one offer out of a draft that still has others keeps the draft", async () => {
    const a = await ingestDraft(`k1${tag}`, 900_000);
    await ingestDraft(`k2${tag}`, 900_000);
    const draftA = await productOfVariant(a.variant_id);
    // Put k2 into draft A, so A has two offers.
    const k2 = await offerOf(`k2${tag}`);
    expect((await adminRpc("admin_move_offer", { p_offer_id: k2.id, p_target_variant_id: a.variant_id })).error).toBeNull();
    const k1 = await offerOf(`k1${tag}`);
    const { data, error } = await adminRpc("admin_move_offer", { p_offer_id: k1.id, p_target_variant_id: verifiedVariantId });
    expect(error).toBeNull();
    expect((data as { deleted_product_id: string | null }).deleted_product_id).toBeNull();
    expect(await productOfVariant(a.variant_id)).toBe(draftA);
  });

  it("reviewing an already-decided candidate errors", async () => {
    await ingestDraft(`r1${tag}`, 900_000);
    const id = await pendingCandidate(`r1${tag}`);
    expect((await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "reject" })).error).toBeNull();
    const again = await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "accept" });
    expect(again.error?.message).toContain("đã được xử lý");
  });

  it("promote: capacity_gb is derived from variant_key when absent, an explicit value overrides it", async () => {
    const d1 = await ingestDraft(`c1${tag}`, 900_000);
    const r1 = await adminRpc("admin_promote_draft", {
      p_product_id: (await productOfVariant(d1.variant_id))!,
      p: { canonical_name: `Sony C1 ${tag}`, brand: "Sony", category_id: categoryId,
           variants: [{ id: d1.variant_id, variant_key: "256GB" }] },
    });
    expect(r1.error).toBeNull();
    const { data: v1 } = await admin.from("product_variants").select("capacity_gb").eq("id", d1.variant_id).single();
    expect(v1!.capacity_gb).toBe(256);

    const d2 = await ingestDraft(`c2${tag}`, 900_000);
    const r2 = await adminRpc("admin_promote_draft", {
      p_product_id: (await productOfVariant(d2.variant_id))!,
      p: { canonical_name: `Sony C2 ${tag}`, brand: "Sony", category_id: categoryId,
           variants: [{ id: d2.variant_id, variant_key: "Xanh", capacity_gb: 512 }] },
    });
    expect(r2.error).toBeNull();
    const { data: v2 } = await admin.from("product_variants").select("capacity_gb, variant_key").eq("id", d2.variant_id).single();
    expect(v2).toEqual({ capacity_gb: 512, variant_key: "Xanh" });
  });
});

describe("final review fixes", () => {
  async function pendingCandidate(ext: string) {
    const offer = await offerOf(ext);
    const { data } = await admin.from("match_candidates")
      .insert({ offer_id: offer.id, suggested_variant_id: verifiedVariantId, confidence: 0.8, reason: "t", decision: "pending" })
      .select("id").single();
    return data!.id;
  }
  async function decisionOf(id: string) {
    const { data } = await admin.from("match_candidates").select("decision").eq("id", id).single();
    return data!.decision;
  }

  it("move: the audit keeps a snapshot of the deleted draft", async () => {
    const d = await ingestDraft(`s1${tag}`, 900_000);
    const draftProduct = await productOfVariant(d.variant_id);
    const offer = await offerOf(`s1${tag}`);
    expect((await adminRpc("admin_move_offer", { p_offer_id: offer.id, p_target_variant_id: verifiedVariantId })).error).toBeNull();
    const { data: log } = await admin.from("admin_audit").select("before").eq("entity_id", offer.id).single();
    const before = log!.before as { deleted_product?: Record<string, unknown> };
    expect(before.deleted_product).toMatchObject({ id: draftProduct, status: "draft" });
    expect(before.deleted_product).not.toHaveProperty("search_text");
  });

  it("review: the audit keeps a snapshot of the deleted draft", async () => {
    const d = await ingestDraft(`s2${tag}`, 900_000);
    const draftProduct = await productOfVariant(d.variant_id);
    const id = await pendingCandidate(`s2${tag}`);
    expect((await adminRpc("admin_review_match", { p_candidate_id: id, p_decision: "accept" })).error).toBeNull();
    const { data: log } = await admin.from("admin_audit").select("before").eq("entity_id", id).single();
    const before = log!.before as { deleted_product?: Record<string, unknown> };
    expect(before.deleted_product).toMatchObject({ id: draftProduct, status: "draft" });
    expect(before.deleted_product).not.toHaveProperty("search_text");
  });

  it("no snapshot when the draft is kept", async () => {
    const a = await ingestDraft(`s3${tag}`, 900_000);
    await ingestDraft(`s4${tag}`, 900_000);
    const s4 = await offerOf(`s4${tag}`);
    expect((await adminRpc("admin_move_offer", { p_offer_id: s4.id, p_target_variant_id: a.variant_id })).error).toBeNull();
    const s3 = await offerOf(`s3${tag}`);
    expect((await adminRpc("admin_move_offer", { p_offer_id: s3.id, p_target_variant_id: verifiedVariantId })).error).toBeNull();
    const { data: log } = await admin.from("admin_audit").select("before").eq("entity_id", s3.id).single();
    expect(log!.before).not.toHaveProperty("deleted_product");
  });

  it.each(["accept", "reassign"] as const)("%s closes the offer's other pending candidates", async (decision) => {
    const ext = `sb${decision}${tag}`;
    await ingestDraft(ext, 900_000);
    const id = await pendingCandidate(ext);
    const sibling = await pendingCandidate(ext);
    const { error } = await adminRpc("admin_review_match", {
      p_candidate_id: id, p_decision: decision, ...(decision === "reassign" ? { p_variant_id: verifiedVariantId } : {}),
    });
    expect(error).toBeNull();
    expect(await decisionOf(id)).toBe("accepted");
    expect(await decisionOf(sibling)).toBe("rejected");
  });
});

describe("other admin RPCs", () => {
  it("set_listings_inactive, cron_status, overview_counts", async () => {
    await ingestDraft(`8${tag}`, 900_000);
    const { data: l } = await admin.from("listings").select("id").eq("external_item_id", `8${tag}`).single();
    const { data: n } = await adminRpc("admin_set_listings_inactive", { p_listing_ids: [l!.id], p_note: `${tag} test` });
    expect(n).toBe(1);
    const { data: cron, error: cronErr } = await admin.rpc("admin_cron_status");
    expect(cronErr).toBeNull();
    for (const j of cron ?? []) expect(j.jobname.startsWith("dealscore-")).toBe(true);
    const { data: counts, error: cErr } = await admin.rpc("admin_overview_counts");
    expect(cErr).toBeNull();
    expect(counts).toHaveProperty("drafts_multi_shop");
    expect(counts).toHaveProperty("stale_listings");
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
