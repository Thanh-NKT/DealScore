import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { admin, createTestUser, deleteTestUser, SUPABASE_URL, type TestUser } from "./helpers";

// Migration 0050: product merge (roadmap P3 item 9) — admin_merge_preview, admin_merge_products,
// admin_repoint_variant_watches, product_slug_redirects + the slug guard trigger, admin_repoint_watches hike reset.
const tag = `pm${randomUUID().replace(/-/g, "").slice(0, 8)}`;
let categoryId: string;
let seq = 0;
const users: TestUser[] = [];
const extIds: string[] = [];

type Made = { id: string; slug: string; variants: string[] };

async function makeProduct(opts: {
  status: "draft" | "verified";
  variants: { key: string; capacity?: number }[];
  gtin?: string | null;
  draftKey?: string | null;
}): Promise<Made> {
  const slug = `test-${tag}-${++seq}`;
  const { data: p, error } = await admin
    .from("products")
    .insert({
      canonical_name: `Merge ${tag} ${seq}`, brand: "Samsung", status: opts.status, slug,
      category_id: categoryId, gtin: opts.gtin ?? null, draft_key: opts.draftKey ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const variants: string[] = [];
  for (const v of opts.variants) {
    const { data: row, error: vErr } = await admin
      .from("product_variants")
      .insert({ product_id: p.id, variant_key: v.key })
      .select("id")
      .single();
    if (vErr) throw vErr;
    if (v.capacity != null) await admin.from("product_variants").update({ capacity_gb: v.capacity }).eq("id", row.id);
    variants.push(row.id);
  }
  return { id: p.id, slug, variants };
}

const dayMs = 86_400_000;

/** A listing + offer on `variantId`, with one valid api observation per entry of `daysAgo`. */
async function addOffer(variantId: string, matchStatus: string, daysAgo: number[], price = 1_000_000) {
  const ext = `ext-${tag}-${++seq}`;
  extIds.push(ext);
  const { data: l, error } = await admin
    .from("listings")
    .insert({ marketplace: "shopee", external_item_id: ext, url: `https://shopee.vn/${ext}`, title: `Listing ${ext}`, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  const { data: o, error: oErr } = await admin
    .from("offers")
    .insert({ listing_id: l.id, variant_id: variantId, match_status: matchStatus })
    .select("id")
    .single();
  if (oErr) throw oErr;
  if (daysAgo.length) {
    const { error: pErr } = await admin.from("price_observations").insert(
      daysAgo.map((d) => ({
        offer_id: o.id, price, observed_at: new Date(Date.now() - d * dayMs).toISOString(), is_valid: true, source: "api",
      })),
    );
    if (pErr) throw pErr;
  }
  await admin.rpc("admin_rebuild_variant_rollup", { p_variant_ids: [variantId] });
  return { listingId: l.id, offerId: o.id, ext };
}

async function newUser() {
  const u = await createTestUser();
  users.push(u);
  return u;
}

async function addWatch(userId: string, variantId: string, status = "active") {
  const { data, error } = await admin
    .from("watches")
    .insert({ user_id: userId, variant_id: variantId, target_price: 500_000, status })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const merge = (src: string, tgt: string, map: { source_variant_id: string; target_variant_id: string | null }[], note?: string) =>
  admin.rpc("admin_merge_products", {
    p_source_id: src, p_target_id: tgt, p: { variant_map: map, ...(note !== undefined ? { note } : {}) } as never,
  });

async function countRows(productIds: string[]) {
  const { data: vids } = await admin.from("product_variants").select("id").in("product_id", productIds);
  const ids = (vids ?? []).map((v) => v.id);
  const [p, o, w, r, a] = await Promise.all([
    admin.from("products").select("id", { count: "exact", head: true }).in("id", productIds),
    admin.from("offers").select("id", { count: "exact", head: true }).in("variant_id", ids),
    admin.from("watches").select("id", { count: "exact", head: true }).in("product_id", productIds),
    admin.from("data_reports").select("id", { count: "exact", head: true }).in("product_id", productIds),
    admin.from("admin_audit").select("id", { count: "exact", head: true }).eq("action", "product.merge"),
  ]);
  return { products: p.count, variants: ids.length, offers: o.count, watches: w.count, reports: r.count, audit: a.count };
}

// Own category (P4 review I4): an arbitrary existing one changes which verified variants auto-match.
beforeAll(async () => {
  const { data: c, error } = await admin.from("categories").insert({ slug: `test-${tag}-cat`, name: `Test ${tag}` }).select("id").single();
  if (error) throw error;
  categoryId = c.id;
});

afterAll(async () => {
  for (const u of users) await deleteTestUser(u.id);
  if (extIds.length) await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("product_slug_redirects").delete().like("old_slug", `test-${tag}%`);
  await admin.from("products").delete().like("slug", `test-${tag}%`);
  await admin.from("sellers").delete().like("external_seller_id", `seller-${tag}%`);
  await admin.from("categories").delete().eq("id", categoryId);
});

describe("admin_merge_preview", () => {
  it("suggests by variant_key, then by a unique capacity, else null; counts offers / watches / open reports", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "Đen" }, { key: "256GB", capacity: 256 }, { key: "512GB", capacity: 512 }] });
    const src = await makeProduct({
      status: "draft",
      variants: [{ key: "  đen " }, { key: "Bản 256", capacity: 256 }, { key: "Xanh" }],
    });
    await addOffer(src.variants[0], "pending", [1]);
    await addOffer(src.variants[0], "pending", [2]);
    const u = await newUser();
    await addWatch(u.id, src.variants[0]);
    await addWatch(u.id, tgt.variants[0]);
    await admin.from("data_reports").insert({ product_id: src.id, variant_id: src.variants[0], kind: "stock" });
    await admin.from("data_reports").insert({ product_id: src.id, variant_id: src.variants[0], kind: "stock", status: "resolved" });

    const { data, error } = await admin.rpc("admin_merge_preview", { p_source_id: src.id, p_target_id: tgt.id });
    expect(error).toBeNull();
    const p = data as {
      source: Record<string, unknown>; target: Record<string, unknown>;
      source_variants: { id: string; offer_count: number; watch_count: number; open_report_count: number; suggested_target_variant_id: string | null }[];
      target_variants: { id: string; offer_count: number; watch_count: number }[];
      watch_conflicts: number; blockers: string[];
    };
    expect(p.blockers).toEqual([]);
    expect(p.source).toMatchObject({ id: src.id, status: "draft", slug: src.slug });
    expect(p.target).toMatchObject({ id: tgt.id, status: "verified" });
    const byId = new Map(p.source_variants.map((v) => [v.id, v]));
    expect(byId.get(src.variants[0])).toMatchObject({ offer_count: 2, watch_count: 1, open_report_count: 1, suggested_target_variant_id: tgt.variants[0] });
    expect(byId.get(src.variants[1])!.suggested_target_variant_id).toBe(tgt.variants[1]);
    expect(byId.get(src.variants[2])!.suggested_target_variant_id).toBeNull();
    expect(p.target_variants).toHaveLength(3);
    expect(p.target_variants.find((v) => v.id === tgt.variants[0])!.watch_count).toBe(1);
    expect(p.watch_conflicts).toBe(1);
  });

  it("one variant on each side → suggested one-to-one", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "Tiêu chuẩn" }] });
    const src = await makeProduct({ status: "draft", variants: [{ key: "Mặc định" }] });
    const { data } = await admin.rpc("admin_merge_preview", { p_source_id: src.id, p_target_id: tgt.id });
    expect((data as { source_variants: { suggested_target_variant_id: string }[] }).source_variants[0].suggested_target_variant_id).toBe(tgt.variants[0]);
  });

  it("blockers for a draft target and the same id; null when a product is missing", async () => {
    const d1 = await makeProduct({ status: "draft", variants: [{ key: "A" }] });
    const d2 = await makeProduct({ status: "draft", variants: [{ key: "A" }] });
    const r1 = (await admin.rpc("admin_merge_preview", { p_source_id: d1.id, p_target_id: d2.id })).data as { blockers: string[] };
    expect(r1.blockers).toEqual(["Chỉ gộp vào sản phẩm đã xác minh. Hãy duyệt sản phẩm đích trước."]);
    const r2 = (await admin.rpc("admin_merge_preview", { p_source_id: d1.id, p_target_id: d1.id })).data as { blockers: string[] };
    expect(r2.blockers).toContain("Không thể gộp một sản phẩm với chính nó.");
    const r3 = await admin.rpc("admin_merge_preview", { p_source_id: d1.id, p_target_id: randomUUID() });
    expect(r3.error).toBeNull();
    expect(r3.data).toBeNull();
  });
});

describe("admin_merge_products", () => {
  it("merges a draft into a verified product: offers, history, watches, reports, candidates, GTIN, redirect, audit", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "Đen" }, { key: "Trắng" }] });
    const src = await makeProduct({ status: "draft", variants: [{ key: "đen" }, { key: "Bạc" }], gtin: "8930000000017" });
    const [s1, s2] = src.variants;
    const [t1] = tgt.variants;
    const o1 = await addOffer(s1, "pending", [10, 5]);
    const o2 = await addOffer(s2, "pending", [3]);
    await addOffer(t1, "manual", [1]);

    // Another verified product's offer whose suggestion points at s1.
    const other = await makeProduct({ status: "verified", variants: [{ key: "X" }] });
    const o4 = await addOffer(other.variants[0], "manual", []);
    const { data: candRepoint } = await admin.from("match_candidates")
      .insert({ offer_id: o4.offerId, suggested_variant_id: s1, confidence: 0.7, decision: "pending" }).select("id").single();
    const { data: candOpen } = await admin.from("match_candidates")
      .insert({ offer_id: o1.offerId, suggested_variant_id: other.variants[0], confidence: 0.7, decision: "pending" }).select("id").single();

    const both = await newUser();
    const wBothSrc = await addWatch(both.id, s1);
    const wBothTgt = await addWatch(both.id, t1);
    const solo = await newUser();
    const wSolo = await addWatch(solo.id, s1);
    await admin.from("watches").update({ hike_active: true, last_hike_alerted_at: new Date().toISOString() }).eq("id", wSolo);
    const whole = await newUser();
    const wWhole = await addWatch(whole.id, s2);
    const { data: soloBefore } = await admin.from("watches").select("config_version").eq("id", wSolo).single();

    const { data: r1 } = await admin.from("data_reports").insert({ product_id: src.id, variant_id: s1, kind: "stock" }).select("id").single();
    const { data: r2 } = await admin.from("data_reports").insert({ product_id: src.id, variant_id: s2, kind: "other", message: "x", status: "dismissed" }).select("id").single();

    const obsBefore = await admin.from("price_observations").select("id", { count: "exact", head: true }).in("offer_id", [o1.offerId, o2.offerId]);
    const auditBefore = (await countRows([tgt.id])).audit ?? 0;

    const { data, error } = await merge(src.id, tgt.id, [
      { source_variant_id: s1, target_variant_id: t1 },
      { source_variant_id: s2, target_variant_id: null },
    ], "trùng hàng");
    expect(error).toBeNull();
    const res = data as Record<string, unknown>;
    expect(res).toMatchObject({
      target_id: tgt.id, target_slug: tgt.slug, deleted_product_id: src.id, redirect_from: src.slug,
      offers_moved: 2, watches_moved: 2, watches_dropped: 1, reports_moved: 2,
    });
    expect((res.touched_variant_ids as string[]).sort()).toEqual([t1, s2].sort());

    // Offers: on the target, pending → manual. History untouched.
    const { data: offers } = await admin.from("offers").select("id, variant_id, match_status").in("id", [o1.offerId, o2.offerId]);
    expect(offers!.find((o) => o.id === o1.offerId)).toMatchObject({ variant_id: t1, match_status: "manual" });
    expect(offers!.find((o) => o.id === o2.offerId)).toMatchObject({ variant_id: s2, match_status: "manual" });
    const obsAfter = await admin.from("price_observations").select("id", { count: "exact", head: true }).in("offer_id", [o1.offerId, o2.offerId]);
    expect(obsAfter.count).toBe(obsBefore.count);

    // The target's rollup includes the day only the source had.
    const { data: days } = await admin.from("variant_daily_prices").select("day").eq("variant_id", t1);
    expect(days!.length).toBe(3);
    const { data: vcp } = await admin.from("variant_current_price").select("offer_count").eq("variant_id", t1).single();
    expect(vcp!.offer_count).toBe(2);

    // Variants: s1 gone, s2 moved with its id; source product gone.
    expect((await admin.from("product_variants").select("id").eq("id", s1)).data).toEqual([]);
    expect((await admin.from("product_variants").select("product_id").eq("id", s2).single()).data!.product_id).toBe(tgt.id);
    expect((await admin.from("products").select("id").eq("id", src.id)).data).toEqual([]);

    // Watches: the target watch wins; the solo watch moved with fresh engine state; the whole-variant watch follows.
    const { data: ws } = await admin.from("watches").select("id, user_id, variant_id, product_id, config_version, hike_active, last_hike_alerted_at")
      .in("user_id", [both.id, solo.id, whole.id]);
    expect(ws!.filter((w) => w.user_id === both.id).map((w) => w.id)).toEqual([wBothTgt]);
    expect(ws!.some((w) => w.id === wBothSrc)).toBe(false);
    expect(ws!.find((w) => w.id === wSolo)).toMatchObject({
      variant_id: t1, product_id: tgt.id, config_version: soloBefore!.config_version + 1, hike_active: null, last_hike_alerted_at: null,
    });
    expect(ws!.find((w) => w.id === wWhole)).toMatchObject({ variant_id: s2, product_id: tgt.id });

    // Reports moved, statuses kept.
    const { data: reps } = await admin.from("data_reports").select("id, product_id, variant_id, status").in("id", [r1!.id, r2!.id]);
    expect(reps!.find((r) => r.id === r1!.id)).toMatchObject({ product_id: tgt.id, variant_id: t1, status: "open" });
    expect(reps!.find((r) => r.id === r2!.id)).toMatchObject({ product_id: tgt.id, variant_id: s2, status: "dismissed" });

    // Candidates: the source offer's open one rejected; another offer's suggestion re-pointed.
    const { data: cands } = await admin.from("match_candidates").select("id, decision, suggested_variant_id").in("id", [candRepoint!.id, candOpen!.id]);
    expect(cands!.find((c) => c.id === candOpen!.id)!.decision).toBe("rejected");
    expect(cands!.find((c) => c.id === candRepoint!.id)).toMatchObject({ decision: "pending", suggested_variant_id: t1 });

    // GTIN copied into the empty target.
    expect((await admin.from("products").select("gtin").eq("id", tgt.id).single()).data!.gtin).toBe("8930000000017");

    // Redirect row; the old slug can never be reused.
    const { data: red } = await admin.from("product_slug_redirects").select("product_id, variant_map").eq("old_slug", src.slug).single();
    expect(red).toEqual({ product_id: tgt.id, variant_map: { [s1]: t1 } });
    const reuse = await admin.from("products").insert({ canonical_name: "x", status: "draft", slug: src.slug });
    expect(reuse.error?.code).toBe("23505");

    // One audit row.
    const { data: audit } = await admin.from("admin_audit").select("action, entity, entity_id, before, after, note")
      .eq("action", "product.merge").eq("entity_id", tgt.id);
    expect(audit).toHaveLength(1);
    expect((await countRows([tgt.id])).audit).toBe(auditBefore + 1);
    expect(audit![0]).toMatchObject({
      entity: "product", note: "trùng hàng",
      after: {
        status: "verified", deleted_product_id: src.id, redirect_from: src.slug, moved_variant_ids: [s2], merged_variant_ids: [s1],
        offers_moved: 2, watches_dropped: 1, reports_moved: 2, candidates_rejected: 1, candidates_repointed: 1, gtin_copied: true,
      },
    });
    const before = audit![0].before as { source: { id: string; search_text?: unknown }; source_variants: unknown[]; target_variants: unknown[] };
    expect(before.source.id).toBe(src.id);
    expect(before.source).not.toHaveProperty("search_text");
    expect(before.source_variants).toHaveLength(2);
    expect(before.target_variants).toHaveLength(2);
  });

  it("a new product named like the old slug gets -2 through ingest_listing's slug loop", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "A" }] });
    const src = await makeProduct({ status: "verified", variants: [{ key: "A" }] });
    expect((await merge(src.id, tgt.id, [{ source_variant_id: src.variants[0], target_variant_id: tgt.variants[0] }])).error).toBeNull();
    const ext = `ing-${tag}-${++seq}`;
    extIds.push(ext);
    const { data, error } = await admin.rpc("ingest_listing", {
      p: {
        marketplace: "shopee", ext_item_id: ext, url: `https://shopee.vn/${ext}`, title: "T", slug_base: src.slug,
        source: "seed", seller: { external_id: `seller-${tag}-${ext}`, name: "S" }, models: [{ model_id: "m", name: "", price: 1000 }],
      },
    });
    expect(error).toBeNull();
    expect((data as { product_slug: string }).product_slug).toBe(`${src.slug}-2`);
  });

  it("chained merges A→B→C leave one redirect hop per old slug and compose the variant map", async () => {
    const a = await makeProduct({ status: "verified", variants: [{ key: "Đen" }, { key: "Xanh" }] });
    const b = await makeProduct({ status: "verified", variants: [{ key: "Đen" }] });
    const c = await makeProduct({ status: "verified", variants: [{ key: "Đen" }, { key: "Xanh lá" }] });
    expect((await merge(a.id, b.id, [
      { source_variant_id: a.variants[0], target_variant_id: b.variants[0] },
      { source_variant_id: a.variants[1], target_variant_id: null },
    ])).error).toBeNull();
    // B now has b0 and a1 (moved whole).
    expect((await merge(b.id, c.id, [
      { source_variant_id: b.variants[0], target_variant_id: c.variants[0] },
      { source_variant_id: a.variants[1], target_variant_id: c.variants[1] },
    ])).error).toBeNull();
    const { data: rows } = await admin.from("product_slug_redirects").select("old_slug, product_id, variant_map").in("old_slug", [a.slug, b.slug]);
    const ra = rows!.find((r) => r.old_slug === a.slug)!;
    const rb = rows!.find((r) => r.old_slug === b.slug)!;
    expect(ra.product_id).toBe(c.id);
    // A's map is composed through both merges (extra keys of B's own variants are harmless).
    expect(ra.variant_map).toMatchObject({ [a.variants[0]]: c.variants[0], [a.variants[1]]: c.variants[1] });
    expect(rb).toMatchObject({ product_id: c.id, variant_map: { [b.variants[0]]: c.variants[0], [a.variants[1]]: c.variants[1] } });
  });

  it("refuses bad input with one Vietnamese message and changes no row", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "Đen" }, { key: "Trắng" }] });
    const src = await makeProduct({ status: "draft", variants: [{ key: "Đen" }, { key: "Xanh" }] });
    const draftTgt = await makeProduct({ status: "draft", variants: [{ key: "Đen" }] });
    const elsewhere = await makeProduct({ status: "verified", variants: [{ key: "Q" }] });
    await addOffer(src.variants[0], "pending", [1]);
    const u = await newUser();
    await addWatch(u.id, src.variants[0]);
    await admin.from("data_reports").insert({ product_id: src.id, kind: "stock" });
    const before = await countRows([src.id, tgt.id]);
    const [s1, s2] = src.variants;
    const cases: [PromiseLike<{ error: { message: string } | null }>, string][] = [
      [merge(src.id, randomUUID(), [{ source_variant_id: s1, target_variant_id: null }]), "admin_merge_products: không tìm thấy sản phẩm"],
      [merge(tgt.id, tgt.id, [{ source_variant_id: tgt.variants[0], target_variant_id: null }]), "admin_merge_products: không thể gộp một sản phẩm với chính nó"],
      [merge(src.id, draftTgt.id, [{ source_variant_id: s1, target_variant_id: null }, { source_variant_id: s2, target_variant_id: null }]), "admin_merge_products: chỉ gộp vào sản phẩm đã xác minh"],
      [merge(src.id, tgt.id, [{ source_variant_id: s1, target_variant_id: tgt.variants[0] }]), "admin_merge_products: danh sách biến thể đã thay đổi, hãy tải lại"],
      [merge(src.id, tgt.id, [
        { source_variant_id: s1, target_variant_id: tgt.variants[0] },
        { source_variant_id: s1, target_variant_id: tgt.variants[1] },
      ]), "danh sách biến thể đã thay đổi"],
      [merge(src.id, tgt.id, [
        { source_variant_id: s1, target_variant_id: tgt.variants[0] },
        { source_variant_id: s2, target_variant_id: null },
        { source_variant_id: randomUUID(), target_variant_id: null },
      ]), "danh sách biến thể đã thay đổi"],
      [merge(src.id, tgt.id, [
        { source_variant_id: s1, target_variant_id: tgt.variants[0] },
        { source_variant_id: "not-a-uuid", target_variant_id: null },
      ]), "danh sách biến thể đã thay đổi"],
      [merge(src.id, tgt.id, [
        { source_variant_id: s1, target_variant_id: elsewhere.variants[0] },
        { source_variant_id: s2, target_variant_id: null },
      ]), "admin_merge_products: biến thể đích không thuộc sản phẩm đích"],
      [merge(src.id, tgt.id, [
        { source_variant_id: s1, target_variant_id: null },
        { source_variant_id: s2, target_variant_id: null },
      ]), 'admin_merge_products: biến thể "Đen" đã có ở sản phẩm đích, hãy ghép vào biến thể đó'],
      [merge(src.id, tgt.id, [
        { source_variant_id: s1, target_variant_id: tgt.variants[0] },
        { source_variant_id: s2, target_variant_id: null },
      ], "x".repeat(501)), "admin_merge_products: ghi chú quá dài"],
    ];
    for (const [call, msg] of cases) {
      const { error } = await call;
      expect(error?.message).toContain(msg);
    }
    expect(await countRows([src.id, tgt.id])).toEqual(before);
  });

  it("refuses a merge that would leave the target with more than 50 variants", async () => {
    const tgt = await makeProduct({ status: "verified", variants: Array.from({ length: 49 }, (_, i) => ({ key: `T${i}` })) });
    const src = await makeProduct({ status: "verified", variants: [{ key: "S1" }, { key: "S2" }] });
    const before = await countRows([src.id, tgt.id]);
    const { error } = await merge(src.id, tgt.id, src.variants.map((id) => ({ source_variant_id: id, target_variant_id: null })));
    expect(error?.message).toContain("admin_merge_products: sản phẩm đích sẽ vượt 50 biến thể");
    expect(await countRows([src.id, tgt.id])).toEqual(before);
  });

  it("anon / authenticated cannot call the merge RPCs nor write product_slug_redirects; anon can read it", async () => {
    const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const u = await newUser();
    const id = randomUUID();
    for (const c of [anon, u.client]) {
      expect((await c.rpc("admin_merge_preview", { p_source_id: id, p_target_id: id })).error?.code).toBe("42501");
      expect((await c.rpc("admin_merge_products", { p_source_id: id, p_target_id: id, p: {} })).error?.code).toBe("42501");
      expect((await c.rpc("admin_repoint_variant_watches", { p_from_variant_ids: [id], p_to_variant_id: id })).error?.code).toBe("42501");
      const ins = await c.from("product_slug_redirects").insert({ old_slug: `test-${tag}-hack`, product_id: id });
      expect(ins.error?.code).toBe("42501");
    }
    expect((await anon.from("product_slug_redirects").select("old_slug").limit(1)).error).toBeNull();
  });
});

describe("admin_repoint_watches (0050) resets the price-hike state", () => {
  it("moving a draft's last offer re-points its watch with hike_active / last_hike_alerted_at cleared", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "A" }] });
    const src = await makeProduct({ status: "draft", variants: [{ key: "A" }] });
    const o = await addOffer(src.variants[0], "pending", [1]);
    const u = await newUser();
    const w = await addWatch(u.id, src.variants[0]);
    await admin.from("watches").update({ hike_active: true, last_hike_alerted_at: new Date().toISOString() }).eq("id", w);
    const { error } = await admin.rpc("admin_move_offer", { p_offer_id: o.offerId, p_target_variant_id: tgt.variants[0] });
    expect(error).toBeNull();
    const { data } = await admin.from("watches").select("variant_id, hike_active, last_hike_alerted_at").eq("id", w).single();
    expect(data).toEqual({ variant_id: tgt.variants[0], hike_active: null, last_hike_alerted_at: null });
  });
});

// Lock order (spec Decision 5): ingest:<listing> advisory locks, then products in uuid order. A merge racing
// ingest_listing for the same listings and the same draft cluster must never deadlock nor lose an offer.
describe("admin_merge_products × ingest_listing", () => {
  const ROUNDS = 10;

  async function ingest(ext: string, key: string) {
    if (!extIds.includes(ext)) extIds.push(ext);
    return admin.rpc("ingest_listing", {
      p: {
        marketplace: "shopee", ext_item_id: ext, url: `https://shopee.vn/product/1/${ext}`,
        title: `Loa ${tag}`, slug_base: `test-${tag}-ing`, source: "seed",
        seller: { external_id: `seller-${tag}-${ext}`, name: "S" },
        models: [{ model_id: "default", name: "", price: 1_000_000 }], draft_key: key,
      },
    });
  }

  async function offerVariant(ext: string) {
    const { data } = await admin.from("offers").select("variant_id, listings!inner(external_item_id)").eq("listings.external_item_id", ext);
    return (data ?? []).map((o) => o.variant_id);
  }

  it("never deadlocks and never leaves an offer without a variant", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "Tiêu chuẩn" }] });
    let merged = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const key = `samsung|${tag}|merge${i}`;
      const a = `mg${i}a${tag}`;
      const b = `mg${i}b${tag}`;
      expect((await ingest(a, key)).error).toBeNull();
      const { data: draftRow } = await admin.from("products").select("id, product_variants(id)").eq("draft_key", key).single();
      const srcVariant = (draftRow!.product_variants as { id: string }[])[0].id;
      const [m, joinB, againA] = await Promise.all([
        merge(draftRow!.id, tgt.id, [{ source_variant_id: srcVariant, target_variant_id: tgt.variants[0] }]),
        ingest(b, key),
        ingest(a, key),
      ]);
      if (m.error) {
        // The only allowed failure: a listing joined the source between the read and the locks.
        expect(m.error.message).toContain("admin_merge_products: dữ liệu đang được cập nhật, hãy thử lại");
      } else {
        merged++;
        expect(await offerVariant(a)).toEqual([tgt.variants[0]]);
      }
      expect(joinB.error).toBeNull();
      expect(againA.error).toBeNull();
      for (const ext of [a, b]) {
        const vids = await offerVariant(ext);
        expect(vids.length).toBe(1);
        expect(vids[0]).not.toBeNull();
      }
      // No offer of these listings points at a deleted variant.
      const { data: orphan } = await admin.from("offers").select("id, product_variants(id), listings!inner(external_item_id)")
        .in("listings.external_item_id", [a, b]);
      expect(orphan!.every((o) => o.product_variants !== null)).toBe(true);
    }
    expect(merged).toBeGreaterThan(0);
  });

  it("an ingest auto-matching a verified source variant mid-merge either lands on a live variant or fails whole", async () => {
    const tgt = await makeProduct({ status: "verified", variants: [{ key: "Tiêu chuẩn" }] });
    let merged = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const src = await makeProduct({ status: "verified", variants: [{ key: "Tiêu chuẩn" }] });
      const auto = (ext: string) => {
        if (!extIds.includes(ext)) extIds.push(ext);
        return admin.rpc("ingest_listing", {
          p: {
            marketplace: "shopee", ext_item_id: ext, url: `https://shopee.vn/product/1/${ext}`, title: `Loa ${tag}`,
            slug_base: `test-${tag}-ing`, source: "seed", seller: { external_id: `seller-${tag}-${ext}`, name: "S" },
            models: [{ model_id: "default", name: "", price: 1_000_000, match: { variant_id: src.variants[0], confidence: 0.99 } }],
          },
        });
      };
      const a = `au${i}a${tag}`;
      const c = `au${i}c${tag}`;
      expect((await auto(a)).error).toBeNull();
      const [m, joinC, againA] = await Promise.all([
        merge(src.id, tgt.id, [{ source_variant_id: src.variants[0], target_variant_id: tgt.variants[0] }]),
        auto(c),
        auto(a),
      ]);
      if (m.error) expect(m.error.message).toContain("admin_merge_products: dữ liệu đang được cập nhật, hãy thử lại");
      else merged++;
      expect(againA.error).toBeNull();
      // The new listing's ingest may lose the race to the variant's deletion: a FK error, nothing written.
      if (joinC.error) expect(joinC.error.code).toBe("23503");
      const { data: rows } = await admin.from("offers").select("variant_id, product_variants(id), listings!inner(external_item_id)")
        .in("listings.external_item_id", [a, c]);
      expect(rows!.length).toBe(joinC.error ? 1 : 2);
      expect(rows!.every((o) => o.variant_id !== null && o.product_variants !== null)).toBe(true);
    }
    expect(merged).toBeGreaterThan(0);
  });
});
