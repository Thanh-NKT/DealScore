import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Migration 0015 — spec 2026-09-28-giai-doan-3-nhom-a §2. Fixtures are inserted directly (products →
// variants → listing/offer → variant_current_price) so capacity, prices and effective prices are exact.
const tag = `zi${randomUUID().slice(0, 6)}`;
const slugBase = `test-intent-${tag}`;
const extIds: string[] = [];
let categoryId = "";
let seq = 0;

interface VariantFixture {
  key: string;
  specs?: Record<string, string>;
  price?: number;
  effective?: number;
  effectiveAgeDays?: number;
  /** offers.effective_price_until (ISO); omitted = null (no voucher in the combination expires). */
  effectiveUntil?: string;
  /** The current observation is newer than the stored effective price (computed before it). */
  observedAfterEffective?: boolean;
}

async function product(
  name: string,
  variants: VariantFixture[],
  extra: { brand?: string; status?: string } = {},
): Promise<{ id: string; variantIds: string[] }> {
  const { data: p, error } = await admin
    .from("products")
    .insert({
      canonical_name: `${tag} ${name}`,
      slug: `${slugBase}-${++seq}`,
      category_id: categoryId,
      brand: extra.brand ?? null,
      status: extra.status ?? "verified",
    })
    .select("id")
    .single();
  if (error) throw error;

  const variantIds: string[] = [];
  for (const v of variants) {
    const { data: row, error: vErr } = await admin
      .from("product_variants")
      .insert({ product_id: p.id, variant_key: v.key, specs: v.specs ?? {} })
      .select("id")
      .single();
    if (vErr) throw vErr;
    variantIds.push(row.id);
    if (v.price === undefined) continue;

    const ext = `test_${randomUUID()}`;
    extIds.push(ext);
    const { data: l, error: lErr } = await admin
      .from("listings")
      .insert({ marketplace: "shopee", external_item_id: ext, title: name })
      .select("id")
      .single();
    if (lErr) throw lErr;
    const effectiveAt =
      v.effective === undefined ? null : new Date(Date.now() - (v.effectiveAgeDays ?? 0) * 86_400_000).toISOString();
    const { data: o, error: oErr } = await admin
      .from("offers")
      .insert({
        listing_id: l.id,
        variant_id: row.id,
        match_status: "manual",
        effective_price: v.effective ?? null,
        effective_price_at: effectiveAt,
        effective_price_until: v.effectiveUntil ?? null,
      })
      .select("id")
      .single();
    if (oErr) throw oErr;
    const { error: cErr } = await admin.from("variant_current_price").insert({
      variant_id: row.id,
      best_offer_id: o.id,
      price: v.price,
      // A stored effective price is computed after the observation it used (1 h here), unless the
      // test wants a newer observation than the computation.
      observed_at:
        effectiveAt === null
          ? new Date().toISOString()
          : new Date(Date.parse(effectiveAt) + (v.observedAfterEffective ? 60_000 : -3_600_000)).toISOString(),
      in_stock: true,
    });
    if (cErr) throw cErr;
  }
  return { id: p.id, variantIds };
}

const search = async (args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc("search_products", { p_q: tag, p_limit: 100, ...args });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, name: r.canonical_name.replace(`${tag} `, "") }));
};

// The trigram fallback also matches sibling fixtures (shared tag), so keep only the "effx" rows — the
// relative order of the rows returned is what the sort tests check.
const effx = <T extends { name: string }>(rows: T[]) => rows.filter((r) => r.name.startsWith("effx "));

const capacityOf = async (variantId: string) => {
  const { data, error } = await admin.from("product_variants").select("capacity_gb").eq("id", variantId).single();
  if (error) throw error;
  return data.capacity_gb;
};

let capacityVariants: string[] = [];
let alphaVariants: string[] = [];

beforeAll(async () => {
  const { data: c, error } = await admin
    .from("categories")
    .insert({ slug: slugBase, name: `Danh mục ${tag}` })
    .select("id")
    .single();
  if (error) throw error;
  categoryId = c.id;

  capacityVariants = (
    await product("capcheck", [
      { key: "capacity=2TB" },
      { key: "dung_luong=512GB" },
      { key: "2TB / 1TB" },
      { key: "default", specs: { dung_luong: "1TB" } },
    ])
  ).variantIds;

  alphaVariants = (
    await product("ssd alpha", [
      { key: "capacity=1TB", price: 1_000_000 },
      { key: "capacity=2TB", price: 2_000_000 },
    ])
  ).variantIds;
  await product("ssd beta", [{ key: "capacity=1TB", price: 900_000 }]);

  await product("chuot Gaming", [{ key: "default", price: 300_000 }]);
  await product("chuot Office", [{ key: "default", price: 300_000 }]);

  await product("effx one", [{ key: "default", price: 500_000, effective: 300_000, effectiveAgeDays: 1 }]);
  await product("effx two", [{ key: "default", price: 400_000 }]);
  await product("effx three", [{ key: "default", price: 350_000, effective: 100_000, effectiveAgeDays: 8 }]);
  await product("effx four", [{ key: "default", price: 450_000, effective: 460_000, effectiveAgeDays: 1 }]);

  // Guards added in 0016: a newer observation or an expired voucher hides the stored value.
  const hour = 3_600_000;
  await product("effg newer", [
    { key: "default", price: 600_000, effective: 200_000, effectiveAgeDays: 1, observedAfterEffective: true },
  ]);
  await product("effg expired", [
    { key: "default", price: 700_000, effective: 250_000, effectiveAgeDays: 1, effectiveUntil: new Date(Date.now() - hour).toISOString() },
  ]);
  await product("effg valid", [
    { key: "default", price: 800_000, effective: 260_000, effectiveAgeDays: 1, effectiveUntil: new Date(Date.now() + 48 * hour).toISOString() },
  ]);

  await product("vocab verified", [], { brand: `Vb${tag}`, status: "verified" });
  await product("vocab draft", [], { brand: `Db${tag}`, status: "draft" });
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `${slugBase}-%`);
  await admin.from("categories").delete().eq("slug", slugBase);
});

describe("product_variants.capacity_gb", () => {
  it("is parsed from variant_key and specs on insert", async () => {
    const [twoTb, gb512, mixed, fromSpecs] = capacityVariants;
    expect(await capacityOf(twoTb)).toBe(2048);
    expect(await capacityOf(gb512)).toBe(512);
    expect(await capacityOf(mixed)).toBeNull();
    expect(await capacityOf(fromSpecs)).toBe(1024);
  });

  it("is recomputed when variant_key changes", async () => {
    const id = capacityVariants[1];
    const { error } = await admin.from("product_variants").update({ variant_key: "capacity=1.5TB" }).eq("id", id);
    if (error) throw error;
    expect(await capacityOf(id)).toBe(1536);
  });
});

describe("search_products v6", () => {
  it("p_capacity_gb picks the matching variant's price and drops products without one", async () => {
    const all = await search({ p_q: `${tag} ssd` });
    expect(all.map((r) => [r.name, r.best_price])).toEqual(
      expect.arrayContaining([
        ["ssd alpha", 1_000_000],
        ["ssd beta", 900_000],
      ]),
    );

    const twoTb = await search({ p_q: `${tag} ssd`, p_capacity_gb: 2048 });
    expect(twoTb.map((r) => [r.name, r.best_price])).toEqual([["ssd alpha", 2_000_000]]);

    // Within 3%: 2000 GB still means the 2 TB variant.
    const approx = await search({ p_q: `${tag} ssd`, p_capacity_gb: 2000 });
    expect(approx.map((r) => r.name)).toEqual(["ssd alpha"]);
  });

  it("returns the representative variant_id (the capacity match when p_capacity_gb is set)", async () => {
    const twoTb = await search({ p_q: `${tag} ssd`, p_capacity_gb: 2048 });
    expect(twoTb.map((r) => r.variant_id)).toEqual([alphaVariants[1]]);
    const all = await search({ p_q: `${tag} ssd` });
    expect(all.find((r) => r.name === "ssd alpha")!.variant_id).toBe(alphaVariants[0]);
  });

  it("p_boost_terms adds 0.5 × matched share to relevance", async () => {
    const plain = await search({ p_q: `${tag} chuot`, p_sort: "relevance" });
    const boosted = await search({ p_q: `${tag} chuot`, p_sort: "relevance", p_boost_terms: ["Gaming"] });
    const rel = (rows: typeof plain, name: string) => rows.find((r) => r.name === name)!.relevance;

    expect(boosted[0].name).toBe("chuot Gaming");
    expect(rel(boosted, "chuot Gaming")).toBeCloseTo(rel(plain, "chuot Gaming") + 0.5, 5);
    expect(rel(boosted, "chuot Office")).toBeCloseTo(rel(plain, "chuot Office"), 5);

    const half = await search({ p_q: `${tag} chuot`, p_boost_terms: ["gaming", "khong-co"] });
    expect(rel(half, "chuot Gaming")).toBeCloseTo(rel(plain, "chuot Gaming") + 0.25, 5);
  });

  it("boost terms match literally (no LIKE wildcards) and empty terms are ignored", async () => {
    const plain = await search({ p_q: `${tag} chuot`, p_sort: "relevance" });
    const rel = (rows: typeof plain, name: string) => rows.find((r) => r.name === name)!.relevance;

    const wild = await search({ p_q: `${tag} chuot`, p_boost_terms: ["g_ming", "%"] });
    expect(rel(wild, "chuot Gaming")).toBeCloseTo(rel(plain, "chuot Gaming"), 5);
    expect(rel(wild, "chuot Office")).toBeCloseTo(rel(plain, "chuot Office"), 5);

    const withEmpty = await search({ p_q: `${tag} chuot`, p_boost_terms: ["gaming", "", "  "] });
    expect(rel(withEmpty, "chuot Gaming")).toBeCloseTo(rel(plain, "chuot Gaming") + 0.5, 5);

    const onlyEmpty = await search({ p_q: `${tag} chuot`, p_boost_terms: [""] });
    expect(rel(onlyEmpty, "chuot Gaming")).toBeCloseTo(rel(plain, "chuot Gaming"), 5);
  });

  it("effective_price is hidden after a newer observation or once a voucher of the combination expired", async () => {
    const rows = (await search({ p_q: `${tag} effg` })).filter((r) => r.name.startsWith("effg "));
    const eff = Object.fromEntries(rows.map((r) => [r.name, r.effective_price]));
    expect(eff).toEqual({ "effg newer": null, "effg expired": null, "effg valid": 260_000 });
  });

  it("effective_price is exposed only when lower than price and fresh (≤ 7 days)", async () => {
    const rows = effx(await search({ p_q: `${tag} effx` }));
    const eff = Object.fromEntries(rows.map((r) => [r.name, r.effective_price]));
    expect(eff).toEqual({ "effx one": 300_000, "effx two": null, "effx three": null, "effx four": null });
  });

  it("sort effective_asc orders by coalesce(effective_price, price)", async () => {
    const rows = effx(await search({ p_q: `${tag} effx`, p_sort: "effective_asc" }));
    expect(rows.map((r) => r.name)).toEqual(["effx one", "effx three", "effx two", "effx four"]);
    const byPrice = effx(await search({ p_q: `${tag} effx`, p_sort: "price_asc" }));
    expect(byPrice.map((r) => r.name)).toEqual(["effx three", "effx two", "effx four", "effx one"]);
  });
});

describe("intent_vocab()", () => {
  it("returns categories and brands of verified products only", async () => {
    const { data, error } = await admin.rpc("intent_vocab");
    if (error) throw error;
    expect(data).toEqual(
      expect.arrayContaining([
        { kind: "category", value: slugBase, label: `Danh mục ${tag}` },
        { kind: "brand", value: `Vb${tag}`, label: `Vb${tag}` },
      ]),
    );
    expect(data!.some((r) => r.value === `Db${tag}`)).toBe(false);
  });

  it("is callable by anon", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { error } = await anon.rpc("intent_vocab");
    expect(error).toBeNull();
  });
});
