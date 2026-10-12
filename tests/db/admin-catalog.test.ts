import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// admin_list_products / admin_create_product / admin_update_product (0032).
const tag = `cat${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
// Unique per run: GTIN must be unique across the catalog.
const gtinBase = String(Date.now()).slice(-10);
const gtin = (d: number) => `${gtinBase}${d}00`;

type Res = { data: any; error: { message: string } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => admin.rpc(fn as never, args as never) as unknown as Promise<Res>;

let categoryA: string;
let categoryB: string;
let user: TestUser;
const ids: Record<string, string> = {};
const variantIds: Record<string, string> = {};
const extIds: string[] = [];

async function product(key: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from("products")
    .insert({ slug: `test-${tag}-${key}`, category_id: categoryA, ...row } as never).select("id").single();
  if (error) throw error;
  ids[key] = data!.id;
  const { data: v, error: vErr } = await admin.from("product_variants")
    .insert({ product_id: data!.id, variant_key: "Đen" }).select("id").single();
  if (vErr) throw vErr;
  variantIds[key] = v!.id;
  return data!.id;
}
async function listing(key: string, marketplace: string, row: Record<string, unknown>) {
  const ext = `${tag}-${key}-${extIds.length}`;
  extIds.push(ext);
  const { data: l, error } = await admin.from("listings")
    .insert({ marketplace, external_item_id: ext, title: ext, url: `https://shopee.vn/${ext}`, ...row } as never)
    .select("id").single();
  if (error) throw error;
  const { error: oErr } = await admin.from("offers")
    .insert({ listing_id: l!.id, variant_id: variantIds[key], match_status: "manual", external_model_id: "default" });
  if (oErr) throw oErr;
}
async function auditCount(entityId: string) {
  const { count } = await admin.from("admin_audit").select("id", { count: "exact", head: true }).eq("entity_id", entityId);
  return count ?? 0;
}

beforeAll(async () => {
  user = await createTestUser();
  const { data: cats } = await admin.from("categories").select("id").order("slug").limit(2);
  [categoryA, categoryB] = [cats![0].id, cats![1].id];
  // fresh: verified, 2 active listings observed now (one shopee, one on "othermart" — a made-up code no other
  // row uses, so the marketplace filter below is isolated) + an inactive one.
  await product("fresh", {
    canonical_name: `Nồi chiên không dầu ${tag} 100xxok`, brand: "Philips", model: `HD9252${tag}`, status: "verified",
    gtin: gtin(1), created_at: iso(3 * HOUR),
  });
  await listing("fresh", "shopee", { last_observed_at: iso(HOUR), last_attempt_at: iso(HOUR) });
  await listing("fresh", "othermart", { last_observed_at: iso(2 * HOUR) });
  await listing("fresh", "shopee", { status: "inactive", last_observed_at: iso(300 * HOUR) });
  await admin.from("variant_current_price").insert({ variant_id: variantIds.fresh, price: 1_990_000, observed_at: iso(HOUR) });
  // stale: verified, one tiktok listing last observed 72 h ago.
  await product("stale", { canonical_name: `Máy xay ${tag}`, brand: "Sunhouse", status: "verified", created_at: iso(2 * HOUR) });
  await listing("stale", "tiktok", { last_observed_at: iso(72 * HOUR) });
  // failing: draft, listing attempted after its last success.
  await product("failing", { canonical_name: `Ấm siêu tốc ${tag}`, brand: "Kangaroo", status: "draft", created_at: iso(1 * HOUR) });
  await listing("failing", "shopee", { last_observed_at: iso(5 * HOUR), last_attempt_at: iso(HOUR) });
  // bare: verified, no listing, other category, a name with LIKE wildcards.
  await product("bare", {
    canonical_name: `Bình giữ nhiệt ${tag} 100%_ok`, brand: "Lock&Lock", status: "verified", category_id: categoryB,
    created_at: iso(4 * HOUR),
  });
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  const { data: rows } = await admin.from("products").select("id").like("search_text", `%${tag}%`);
  const pids = (rows ?? []).map((r) => r.id);
  if (pids.length) {
    await admin.from("admin_audit").delete().in("entity_id", pids);
    await admin.from("products").delete().in("id", pids);
  }
  await deleteTestUser(user.id);
});

describe("admin_list_products", () => {
  const list = (args: Record<string, unknown>) => rpc("admin_list_products", { p_q: tag, ...args });
  const itemIds = (r: Res) => (r.data.items as { id: string }[]).map((i) => i.id);

  it("counts every tab on the base filter and returns the row shape", async () => {
    const r = await list({});
    expect(r.error).toBeNull();
    expect(r.data.counts).toEqual({ all: 4, verified: 3, draft: 1, stale: 1, error: 1 });
    expect(r.data.total).toBe(4);
    const fresh = (r.data.items as Record<string, unknown>[]).find((i) => i.id === ids.fresh)!;
    expect(fresh).toMatchObject({
      status: "verified", brand: "Philips", gtin: gtin(1), slug: `test-${tag}-fresh`, category_id: categoryA,
      variant_count: 1, listing_count: 2, marketplaces: ["othermart", "shopee"], min_price: 1_990_000,
      is_stale: false, failing_count: 0,
    });
    expect(typeof fresh.category_slug).toBe("string");
    expect(typeof fresh.category_name).toBe("string");
    expect(Object.keys(fresh).sort()).toEqual([
      "brand", "canonical_name", "category_id", "category_name", "category_slug", "created_at", "failing_count", "gtin",
      "id", "is_stale", "last_observed_at", "listing_count", "marketplaces", "min_price", "model", "slug", "status",
      "variant_count",
    ]);
    const bare = (r.data.items as Record<string, unknown>[]).find((i) => i.id === ids.bare)!;
    expect(bare).toMatchObject({ listing_count: 0, marketplaces: [], min_price: null, last_observed_at: null, is_stale: false });
  });

  it("filters by tab; total follows the tab, counts do not", async () => {
    for (const [tab, expected] of [["verified", ["fresh", "stale", "bare"]], ["draft", ["failing"]],
      ["stale", ["stale"]], ["error", ["failing"]]] as const) {
      const r = await list({ p_tab: tab });
      expect(r.error).toBeNull();
      expect(itemIds(r).sort()).toEqual(expected.map((k) => ids[k]).sort());
      expect(r.data.total).toBe(expected.length);
      expect(r.data.counts.all).toBe(4);
    }
  });

  it("p_stale_hours moves the stale cut-off", async () => {
    const r = await list({ p_tab: "stale", p_stale_hours: 3 });
    expect(itemIds(r).sort()).toEqual([ids.stale, ids.failing].sort());
  });

  it("searches name without accents, model, GTIN, case-insensitively", async () => {
    const byName = await rpc("admin_list_products", { p_q: `NOI CHIEN khong dau ${tag}` });
    expect(itemIds(byName)).toEqual([ids.fresh]);
    const byModel = await rpc("admin_list_products", { p_q: `philips hd9252${tag}` });
    expect(itemIds(byModel)).toEqual([ids.fresh]);
    const byGtin = await rpc("admin_list_products", { p_q: gtin(1) });
    expect(itemIds(byGtin)).toEqual([ids.fresh]);
  });

  it("escapes % and _ in the query", async () => {
    const r = await rpc("admin_list_products", { p_q: `${tag} 100%_ok` });
    expect(itemIds(r)).toEqual([ids.bare]);
    const none = await rpc("admin_list_products", { p_q: `${tag}%` });
    expect(itemIds(none)).toEqual([]);
  });

  it("filters by category and marketplace (active listings only)", async () => {
    expect(itemIds(await list({ p_category_id: categoryB }))).toEqual([ids.bare]);
    expect(itemIds(await list({ p_marketplace: "tiktok" }))).toEqual([ids.stale]);
    const other = await list({ p_marketplace: "othermart" });
    expect(itemIds(other)).toEqual([ids.fresh]);
    expect(other.data.counts).toEqual({ all: 1, verified: 1, draft: 0, stale: 0, error: 0 });
  });

  it("sorts by listings, newest, name and pages in SQL", async () => {
    const byListings = await list({ p_sort: "listings" });
    // fresh (2), then 1 listing each by created_at desc (failing, stale), then bare (0).
    expect(itemIds(byListings)).toEqual([ids.fresh, ids.failing, ids.stale, ids.bare]);
    const newest = await list({ p_sort: "newest" });
    expect(itemIds(newest)).toEqual([ids.failing, ids.stale, ids.fresh, ids.bare]);
    const byName = await list({ p_sort: "name" });
    // lower(canonical_name) under the DB collation (en_US): "ấm…", "bình…", "máy…", "nồi…"
    expect(itemIds(byName)).toEqual([ids.failing, ids.bare, ids.stale, ids.fresh]);
    const page2 = await list({ p_sort: "newest", p_limit: 2, p_offset: 2 });
    expect(itemIds(page2)).toEqual([ids.fresh, ids.bare]);
    expect(page2.data.total).toBe(4);
    const beyond = await list({ p_offset: 10 });
    expect(beyond.data.items).toEqual([]);
    expect(beyond.data.total).toBe(4);
    const clamped = await list({ p_limit: 0 });
    expect(clamped.data.items).toHaveLength(1);
  });

  it("rejects unknown tab / sort", async () => {
    expect((await list({ p_tab: "x" })).error?.message).toContain("admin_list_products: tham số không hợp lệ");
    expect((await list({ p_sort: "price" })).error?.message).toContain("tham số không hợp lệ");
  });
});

describe("admin_create_product", () => {
  const base = () => ({
    canonical_name: `Máy lọc không khí ${tag}`, brand: " Xiaomi ", model: "4 Lite", category_id: categoryA,
    note: `${tag} create`, variants: [{ variant_key: "Trắng 256GB" }, { variant_key: "Đen", capacity_gb: 5 }],
  });

  it("creates a verified product, derives capacity, logs one row; same name gets -2", async () => {
    const r = await rpc("admin_create_product", { p: base() });
    expect(r.error).toBeNull();
    const out = r.data as { product_id: string; slug: string; category_slug: string; variant_ids: string[] };
    expect(out.slug).toBe(`may-loc-khong-khi-${tag}`);
    expect(typeof out.category_slug).toBe("string");
    expect(out.variant_ids).toHaveLength(2);
    const { data: p } = await admin.from("products").select("status, brand, draft_key, specs").eq("id", out.product_id).single();
    expect(p).toEqual({ status: "verified", brand: "Xiaomi", draft_key: null, specs: {} });
    const { data: vs } = await admin.from("product_variants").select("variant_key, capacity_gb").eq("product_id", out.product_id);
    expect(vs).toHaveLength(2);
    expect(vs).toEqual(expect.arrayContaining([
      { variant_key: "Trắng 256GB", capacity_gb: 256 }, { variant_key: "Đen", capacity_gb: 5 },
    ]));
    const { data: log } = await admin.from("admin_audit").select("action, entity, before, after, note").eq("entity_id", out.product_id);
    expect(log).toHaveLength(1);
    expect(log![0]).toMatchObject({ action: "product.create", entity: "product", before: null, note: `${tag} create` });
    const after = log![0].after as { product: Record<string, unknown>; variants: unknown[] };
    expect(after.product.status).toBe("verified");
    expect(after.product).not.toHaveProperty("search_text");
    expect(after.variants).toHaveLength(2);

    const again = await rpc("admin_create_product", { p: base() });
    expect(again.error).toBeNull();
    expect(again.data.slug).toBe(`may-loc-khong-khi-${tag}-2`);
  });

  it("validates in order and writes nothing on error", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ brand: "" }, "admin_create_product: thiếu tên chuẩn, hãng hoặc danh mục"],
      [{ category_id: randomUUID() }, "danh mục không tồn tại"],
      [{ category_id: "not-a-uuid" }, "danh mục không tồn tại"],
      [{ variants: [] }, "cần 1–50 biến thể"],
      [{ variants: Array.from({ length: 51 }, (_, i) => ({ variant_key: `V${i}` })) }, "cần 1–50 biến thể"],
      [{ variants: [{ variant_key: "Đen" }, { variant_key: " đen " }] }, "tên biến thể trống hoặc bị trùng"],
      [{ variants: [{ variant_key: "  " }] }, "tên biến thể trống hoặc bị trùng"],
      [{ gtin: "123" }, "GTIN phải gồm 8–14 chữ số"],
      [{ gtin: gtin(1) }, "GTIN đã dùng cho sản phẩm khác"],
      [{ image: "http://x.vn/a.jpg" }, "ảnh phải là đường dẫn https"],
    ];
    for (const [patch, message] of cases) {
      const name = `Lỗi ${tag} ${message.slice(0, 10)}`;
      const r = await rpc("admin_create_product", { p: { ...base(), canonical_name: name, ...patch } });
      expect(r.error?.message, JSON.stringify(patch).slice(0, 80)).toContain(message);
      const { count } = await admin.from("products").select("id", { count: "exact", head: true }).eq("canonical_name", name);
      expect(count).toBe(0);
    }
  });

  it("is searchable as a verified variant right away", async () => {
    const r = await rpc("admin_create_product", {
      p: { ...base(), canonical_name: `Quạt ${tag}`, gtin: gtin(7), image: "https://cf.shopee.vn/a.jpg" },
    });
    expect(r.error).toBeNull();
    const listed = await rpc("admin_list_products", { p_q: gtin(7) });
    expect(listed.data.items[0]).toMatchObject({ id: r.data.product_id, status: "verified", variant_count: 2, listing_count: 0 });
  });
});

describe("admin_update_product", () => {
  let pid: string;
  let v1: string;
  beforeAll(async () => {
    const r = await rpc("admin_create_product", {
      p: { canonical_name: `Tủ lạnh ${tag}`, brand: "LG", model: "GN-1", category_id: categoryA, gtin: gtin(3),
           image: "https://cf.shopee.vn/t.jpg", variants: [{ variant_key: "300L" }] },
    });
    if (r.error) throw new Error(r.error.message);
    pid = r.data.product_id;
    v1 = r.data.variant_ids[0];
  });
  const update = (p: Record<string, unknown>, id = pid) => rpc("admin_update_product", { p_product_id: id, p });

  it("changes only present keys, never the slug", async () => {
    const before = await admin.from("products").select("*").eq("id", pid).single();
    const r = await update({ brand: " LG Electronics ", category_id: categoryB, note: `${tag} upd` });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ product_id: pid, slug: before.data!.slug, variant_ids: [v1], created_variant_ids: [] });
    const { data: p } = await admin.from("products").select("*").eq("id", pid).single();
    expect(p).toMatchObject({
      brand: "LG Electronics", category_id: categoryB, canonical_name: before.data!.canonical_name, model: "GN-1",
      gtin: gtin(3), image: "https://cf.shopee.vn/t.jpg", slug: before.data!.slug, status: "verified",
    });
    const { data: log } = await admin.from("admin_audit").select("action, before, after, note").eq("entity_id", pid)
      .eq("action", "product.update");
    expect(log).toHaveLength(1);
    const b = log![0].before as { product: Record<string, unknown>; variants: unknown[] };
    const a = log![0].after as { product: Record<string, unknown>; variants: unknown[] };
    expect(b.product.brand).toBe("LG");
    expect(a.product.brand).toBe("LG Electronics");
    expect(a.product).not.toHaveProperty("search_text");
    expect(a.variants).toEqual([{ id: v1, variant_key: "300L", capacity_gb: null, specs: {} }]);
  });

  it("clears GTIN with null or empty string; keeps its own GTIN without a duplicate error", async () => {
    expect((await update({ gtin: gtin(3) })).error).toBeNull();
    expect((await update({ gtin: null })).error).toBeNull();
    expect((await admin.from("products").select("gtin").eq("id", pid).single()).data!.gtin).toBeNull();
    expect((await update({ gtin: gtin(3) })).error).toBeNull();
    expect((await update({ gtin: "", model: null, image: "" })).error).toBeNull();
    const { data: p } = await admin.from("products").select("gtin, model, image").eq("id", pid).single();
    expect(p).toEqual({ gtin: null, model: null, image: null });
  });

  it("edits and adds variants", async () => {
    const r = await update({ variants: [{ id: v1, variant_key: "300 lít" }, { variant_key: "Mới 512GB" }] });
    expect(r.error).toBeNull();
    expect(r.data.created_variant_ids).toHaveLength(1);
    expect(r.data.variant_ids).toHaveLength(2);
    const { data: vs } = await admin.from("product_variants").select("id, variant_key, capacity_gb").eq("product_id", pid);
    expect(vs).toContainEqual({ id: v1, variant_key: "300 lít", capacity_gb: null });
    expect(vs).toContainEqual({ id: r.data.created_variant_ids[0], variant_key: "Mới 512GB", capacity_gb: 512 });
    const cap = await update({ variants: [{ id: v1, variant_key: "300 lít", capacity_gb: 7 }] });
    expect(cap.error).toBeNull();
    expect((await admin.from("product_variants").select("capacity_gb").eq("id", v1).single()).data!.capacity_gb).toBe(7);
  });

  it("no change writes no log", async () => {
    const n = await auditCount(pid);
    const { data: p } = await admin.from("products").select("canonical_name, brand").eq("id", pid).single();
    const r = await update({ canonical_name: p!.canonical_name, brand: p!.brand, variants: [{ id: v1, variant_key: "300 lít" }] });
    expect(r.error).toBeNull();
    expect(await auditCount(pid)).toBe(n);
    // the manual capacity from the previous test survives an unchanged variant_key
    expect((await admin.from("product_variants").select("capacity_gb").eq("id", v1).single()).data!.capacity_gb).toBe(7);
  });

  it("rejects errors without writing anything", async () => {
    const n = await auditCount(pid);
    const { count: vBefore } = await admin.from("product_variants").select("id", { count: "exact", head: true }).eq("product_id", pid);
    const cases: [Record<string, unknown>, string, string?][] = [
      [{ gtin: gtin(1) }, "admin_update_product: GTIN đã dùng cho sản phẩm khác"],
      [{ gtin: "12ab5678" }, "GTIN phải gồm 8–14 chữ số"],
      [{ brand: " " }, "thiếu tên chuẩn, hãng hoặc danh mục"],
      [{ category_id: null }, "thiếu tên chuẩn, hãng hoặc danh mục"],
      [{ category_id: randomUUID() }, "danh mục không tồn tại"],
      [{ image: "javascript:alert(1)" }, "ảnh phải là đường dẫn https"],
      [{ brand: "Changed", variants: [{ variant_key: "MỚI 512gb" }] }, "tên biến thể trống hoặc bị trùng"],
      [{ variants: [{ id: variantIds.fresh, variant_key: "x" }] }, "variant không thuộc sản phẩm này"],
      [{ gtin: "1" }, "không tìm thấy sản phẩm", randomUUID()],
      [{ brand: "x" }, "sản phẩm nháp, hãy duyệt ở trang Bản nháp", ids.failing],
    ];
    for (const [patch, message, id] of cases) {
      const r = await update(patch, id ?? pid);
      expect(r.error?.message, JSON.stringify(patch)).toContain(message);
    }
    expect(await auditCount(pid)).toBe(n);
    const { count: vAfter } = await admin.from("product_variants").select("id", { count: "exact", head: true }).eq("product_id", pid);
    expect(vAfter).toBe(vBefore);
    expect((await admin.from("products").select("brand").eq("id", pid).single()).data!.brand).toBe("LG Electronics");
  });
});

// 0036: an unchanged stored image / GTIN is not re-validated, so legacy data never blocks an unrelated edit.
describe("admin_update_product with legacy values", () => {
  const legacyGtin = `${gtinBase}900`;
  beforeAll(async () => {
    // Inserted directly: older data predates the https / format / uniqueness rules.
    await product("legacyImg", { canonical_name: `Quạt ${tag} legacy`, brand: "Asia", status: "verified", image: "http://old.vn/q.jpg" });
    await product("dupA", { canonical_name: `Đèn ${tag} dupA`, brand: "Rạng Đông", status: "verified", gtin: legacyGtin });
    await product("dupB", { canonical_name: `Đèn ${tag} dupB`, brand: "Rạng Đông", status: "verified", gtin: legacyGtin });
    await product("badGtin", { canonical_name: `Bàn ủi ${tag} bad`, brand: "Philips", status: "verified", gtin: "893-1234 5" });
  });
  const update = (key: string, p: Record<string, unknown>) => rpc("admin_update_product", { p_product_id: ids[key], p });
  const full = (key: string, row: { image?: string | null; gtin?: string | null }, name: string) =>
    update(key, { canonical_name: name, brand: "X", category_id: categoryA, model: null, image: row.image ?? null,
                  gtin: row.gtin ?? null, variants: [{ id: variantIds[key], variant_key: "Đen" }] });

  it("saves a name change on a product whose stored image is http://", async () => {
    const r = await full("legacyImg", { image: " http://old.vn/q.jpg " }, `Quạt ${tag} legacy mới`);
    expect(r.error).toBeNull();
    const { data } = await admin.from("products").select("canonical_name, image").eq("id", ids.legacyImg).single();
    expect(data).toEqual({ canonical_name: `Quạt ${tag} legacy mới`, image: "http://old.vn/q.jpg" });
  });

  it("still rejects a new non-https image on that product", async () => {
    const r = await update("legacyImg", { image: "http://old.vn/other.jpg" });
    expect(r.error?.message).toContain("admin_update_product: ảnh phải là đường dẫn https");
  });

  it("renames each of two products sharing a legacy GTIN", async () => {
    expect((await full("dupA", { gtin: legacyGtin }, `Đèn ${tag} dupA mới`)).error).toBeNull();
    expect((await full("dupB", { gtin: legacyGtin }, `Đèn ${tag} dupB mới`)).error).toBeNull();
    const { data } = await admin.from("products").select("gtin").in("id", [ids.dupA, ids.dupB]);
    expect(data!.map((r) => r.gtin)).toEqual([legacyGtin, legacyGtin]);
  });

  it("still rejects setting a new duplicate GTIN", async () => {
    const r = await update("badGtin", { gtin: legacyGtin });
    expect(r.error?.message).toContain("admin_update_product: GTIN đã dùng cho sản phẩm khác");
    const bare = await update("bare", { gtin: legacyGtin });
    expect(bare.error?.message).toContain("GTIN đã dùng cho sản phẩm khác");
  });

  it("keeps a malformed legacy GTIN but rejects a new malformed one", async () => {
    expect((await full("badGtin", { gtin: "893-1234 5" }, `Bàn ủi ${tag} bad mới`)).error).toBeNull();
    const r = await update("badGtin", { gtin: "893-1234" });
    expect(r.error?.message).toContain("GTIN phải gồm 8–14 chữ số");
    expect((await admin.from("products").select("gtin").eq("id", ids.badGtin).single()).data!.gtin).toBe("893-1234 5");
  });

  it("create still validates every value", async () => {
    const r = await rpc("admin_create_product", {
      p: { canonical_name: `Dup ${tag}`, brand: "X", category_id: categoryA, gtin: legacyGtin, variants: [{ variant_key: "a" }] },
    });
    expect(r.error?.message).toContain("admin_create_product: GTIN đã dùng cho sản phẩm khác");
  });
});

describe("admin catalog privileges", () => {
  it("anon / authenticated cannot call the catalog RPCs", async () => {
    for (const [fn, args] of [
      ["admin_list_products", {}],
      ["admin_create_product", { p: {} }],
      ["admin_update_product", { p_product_id: randomUUID(), p: {} }],
    ] as const) {
      const { error } = await user.client.rpc(fn as never, args as never);
      expect(error, fn).not.toBeNull();
    }
  });
});
