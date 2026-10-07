import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import type { IntentVocab } from "@/lib/intent/types";
import { expandQuery } from "@/lib/search/synonyms";
import { admin, SUPABASE_URL } from "./helpers";

// Spec 2026-10-07-search-quality-logic: synonym groups in search_products (0030) and intent-aware
// suggestions, on fixtures tagged with a random word so other catalog rows never interfere.
const tag = `zs${randomUUID().slice(0, 6)}`;
const slugBase = `test-syn-${tag}`;
const extIds: string[] = [];
let seq = 0;

// The suggestions pipeline runs for real against the local DB through an anon client (RLS as in
// production); only the cookie-bound server client and the cached vocab are swapped.
const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anon }));
const vocab: IntentVocab = { categories: [], brands: ["Samsung", "Sony", "Apple"] };
vi.mock("@/lib/intent/vocab", () => ({ getIntentVocab: async () => vocab }));
const { autocomplete } = await import("@/lib/search/autocomplete");

async function category(slug: string, name: string): Promise<string> {
  const { data, error } = await admin.from("categories").insert({ slug, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function product(
  name: string,
  opts: { brand?: string; categoryId?: string; status?: string; variants?: Array<{ key: string; price: number }>; listings?: number } = {},
): Promise<string> {
  const { data: p, error } = await admin
    .from("products")
    .insert({
      canonical_name: `${name} ${tag}`,
      slug: `${slugBase}-${++seq}`,
      brand: opts.brand ?? null,
      category_id: opts.categoryId ?? null,
      status: opts.status ?? "verified",
    })
    .select("id")
    .single();
  if (error) throw error;
  for (const v of opts.variants ?? [{ key: "default", price: 1_000_000 }]) {
    const { data: variant, error: vErr } = await admin
      .from("product_variants")
      .insert({ product_id: p.id, variant_key: v.key, specs: {} })
      .select("id")
      .single();
    if (vErr) throw vErr;
    let firstOffer: string | null = null;
    for (let i = 0; i < (opts.listings ?? 1); i++) {
      const ext = `test_${randomUUID()}`;
      extIds.push(ext);
      const { data: l, error: lErr } = await admin
        .from("listings")
        .insert({ marketplace: "shopee", external_item_id: ext, title: name })
        .select("id")
        .single();
      if (lErr) throw lErr;
      const { data: o, error: oErr } = await admin
        .from("offers")
        .insert({ listing_id: l.id, variant_id: variant.id, match_status: "manual" })
        .select("id")
        .single();
      if (oErr) throw oErr;
      firstOffer ??= o.id;
    }
    const { error: cErr } = await admin.from("variant_current_price").insert({
      variant_id: variant.id,
      best_offer_id: firstOffer,
      price: v.price,
      observed_at: new Date().toISOString(),
      in_stock: true,
    });
    if (cErr) throw cErr;
  }
  return p.id;
}

const strip = (name: string) => name.replace(` ${tag}`, "");

/**
 * Full-text matches only. The trigram fallback (%>) also returns sibling fixtures that merely share the
 * tag; its relevance is word_similarity (≤ 1) + 0.25 for verified, a full-text match starts above 1.25.
 */
async function search(q: string, groups: string[][] | null | undefined = expandQuery(q)) {
  const { data, error } = await admin.rpc("search_products", { p_q: q, p_term_groups: groups ?? undefined, p_limit: 60 });
  if (error) throw error;
  return (data ?? []).filter((r) => r.relevance > 1.25).map((r) => ({ name: strip(r.canonical_name), rel: r.relevance }));
}

let tnCategory = "";
let ssdCategory = "";

beforeAll(async () => {
  tnCategory = await category(`tn-${tag}`, "Tai nghe");
  ssdCategory = await category(`ssd-${tag}`, "Ổ cứng SSD");
  vocab.categories = [
    { slug: `tn-${tag}`, name: "Tai nghe" },
    { slug: `ssd-${tag}`, name: "Ổ cứng SSD" },
  ];

  await product("Tai nghe Sony WH-1000XM5", { brand: "Sony", categoryId: tnCategory });
  await product("Headphone Sony ULT Wear", { brand: "Sony", categoryId: tnCategory });
  await product("Tai nghe lẻ một shop", { status: "draft", listings: 1 });
  await product("Điện thoại Samsung Galaxy S24", { brand: "Samsung" });
  await product("Loa Samsung Sound Tower", { brand: "Samsung" });
  await product("Apple iPhone 15 128GB", { brand: "Apple" });
  await product("Apple iPhone 14 Pro Max", { brand: "Apple" });
  await product("SSD Samsung 990 Pro 2 TB", {
    brand: "Samsung",
    categoryId: ssdCategory,
    variants: [{ key: "capacity=2TB", price: 2_900_000 }],
  });
  await product("SSD Samsung 870 EVO 2TB", {
    brand: "Samsung",
    categoryId: ssdCategory,
    variants: [{ key: "capacity=2TB", price: 4_500_000 }],
  });
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `${slugBase}-%`);
  await admin.from("categories").delete().in("slug", [`tn-${tag}`, `ssd-${tag}`]);
});

describe("search_products — synonym groups", () => {
  it("'headphone' finds products named 'Tai nghe …', the exact word ranking first", async () => {
    const rows = await search(`headphone ${tag}`);
    expect(rows.map((r) => r.name)).toEqual(["Headphone Sony ULT Wear", "Tai nghe Sony WH-1000XM5"]);
    expect(rows[0].rel).toBeGreaterThan(rows[1].rel);
  });

  it("and vice versa: 'tai nghe' finds 'Headphone …'", async () => {
    const rows = await search(`tai nghe ${tag}`);
    expect(rows.map((r) => r.name)).toEqual(["Tai nghe Sony WH-1000XM5", "Headphone Sony ULT Wear"]);
  });

  it("without the groups the synonym-only product is not found (plain v11 query)", async () => {
    const rows = await search(`headphone ${tag}`, null);
    expect(rows.map((r) => r.name)).toEqual(["Headphone Sony ULT Wear"]);
  });

  it("the draft rule still applies: a one-shop draft stays hidden", async () => {
    expect((await search(`headphone ${tag}`)).map((r) => r.name)).not.toContain("Tai nghe lẻ một shop");
  });

  it("'dt samsung' finds Samsung phones, not other Samsung products", async () => {
    expect((await search(`dt samsung ${tag}`)).map((r) => r.name)).toEqual(["Điện thoại Samsung Galaxy S24"]);
  });

  it("'ip 15' and 'ip14pm' expand to the iPhone model, phrase words adjacent", async () => {
    expect((await search(`ip 15 ${tag}`)).map((r) => r.name)).toEqual(["Apple iPhone 15 128GB"]);
    expect((await search(`ip14pm ${tag}`)).map((r) => r.name)).toEqual(["Apple iPhone 14 Pro Max"]);
  });

  it("'2tb' ≡ '2 tb'", async () => {
    const glued = (await search(`ssd 2tb ${tag}`)).map((r) => r.name).sort();
    const spaced = (await search(`ssd 2 tb ${tag}`)).map((r) => r.name).sort();
    expect(glued).toEqual(["SSD Samsung 870 EVO 2TB", "SSD Samsung 990 Pro 2 TB"]);
    expect(spaced).toEqual(glued);
  });

  async function ids(pQ: string, groups?: unknown) {
    const { data, error } = await admin.rpc("search_products", {
      p_q: pQ,
      p_term_groups: groups as Database["public"]["Functions"]["search_products"]["Args"]["p_term_groups"],
      p_limit: 60,
    });
    if (error) throw error;
    return (data ?? []).map((r) => r.product_id).sort();
  }

  it("hostile group values are only words: no error, and the rows are exactly the plain query's", async () => {
    const plain = await ids(tag);
    expect(plain.length).toBeGreaterThan(0);
    expect(await ids(tag, [["a)|(b:*", "!!", "c & d <-> e"], ["'; drop table products; --"], [], "x", 5, null, { k: 1 }])).toEqual(plain);
    expect(await ids(tag, { a: 1 })).toEqual(plain);
  });

  // A keyword that matches nothing by itself, so only the groups decide the rows.
  const none = "qqzzqqzzqq";

  it("caps: only the first 10 groups are read (an 11th, impossible group is ignored)", async () => {
    const tagged = await ids(tag);
    const ten = Array.from({ length: 10 }, () => [tag]);
    expect(await ids(none, ten)).toEqual(tagged);
    expect(await ids(none, [...ten, ["nomatchzzqq"]])).toEqual(tagged);
    expect(await ids(none, [...ten.slice(1), ["nomatchzzqq"]])).toEqual([]);
  });

  it("caps: only the first 6 alternatives of a group are read", async () => {
    const decoys = ["n1zzqq", "n2zzqq", "n3zzqq", "n4zzqq", "n5zzqq"];
    expect(await ids(none, [[...decoys, tag]])).toEqual(await ids(tag));
    expect(await ids(none, [[...decoys, "n6zzqq", tag]])).toEqual([]);
  });

  it("an oversized p_term_groups costs no more than the caps (read by index, not enumerated)", async () => {
    const tagged = await ids(tag);
    const huge = [[tag, ...Array.from({ length: 20_000 }, (_, i) => `a${i}`)], ...Array.from({ length: 20_000 }, () => [tag])];
    const t0 = performance.now();
    expect(await ids(none, huge)).toEqual(tagged);
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
});

describe("autocomplete — against the local DB", () => {
  it("'ssd … 2tb dưới 3 triệu' returns the 2 TB SSD under 3 million, with the chips", async () => {
    const res = await autocomplete(`ssd ${tag} 2tb dưới 3 triệu`);
    expect(res.products.map((p) => strip(p.name))).toEqual(["SSD Samsung 990 Pro 2 TB"]);
    expect(res.products[0].bestPrice).toBe(2_900_000);
    // "ssd {tag}" is the test category's slug, so it becomes the category chip.
    expect(res.intent.map((c) => c.label)).toEqual(["Ổ cứng SSD", "2TB", "≤ 3.000.000đ"]);
  });

  it("'tai nghe sony …' → headphones of the category, category and brand suggested", async () => {
    const res = await autocomplete(`tai nghe sony ${tag}`);
    expect(res.products.map((p) => strip(p.name)).sort()).toEqual(["Headphone Sony ULT Wear", "Tai nghe Sony WH-1000XM5"]);
    expect(res.categories[0]).toEqual({ name: "Tai nghe", slug: `tn-${tag}`, href: `/tn-${tag}` });
    expect(res.brands[0]).toEqual({ name: "Sony", href: "/brand/sony" });
  });

  it("'ip 15 …' → the iPhone 15", async () => {
    const res = await autocomplete(`ip 15 ${tag}`);
    // Best first; tag-only trigram matches may follow.
    expect(strip(res.products[0].name)).toBe("Apple iPhone 15 128GB");
  });

  it("'sam' → Samsung as a brand suggestion", async () => {
    const res = await autocomplete("sam");
    expect(res.brands[0]).toEqual({ name: "Samsung", href: "/brand/samsung" });
  });
});
