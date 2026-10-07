import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentVocab } from "@/lib/intent/types";

// Suggestions run the /search intent + synonym pipeline against a mocked search_products RPC.
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: (_col: string, slug: string) => ({
          maybeSingle: async () => ({ data: slug === "nope" ? null : { id: `cat-${slug}` }, error: null }),
        }),
      }),
    }),
  }),
}));

const vocab: IntentVocab = {
  categories: [
    { slug: "ssd", name: "Ổ cứng SSD" },
    { slug: "tai-nghe", name: "Tai nghe" },
    { slug: "chuot", name: "Chuột" },
  ],
  brands: ["Samsung", "Sony", "WD"],
};
vi.mock("@/lib/intent/vocab", () => ({ getIntentVocab: async () => vocab }));

const { autocomplete, AUTOCOMPLETE_LIMIT } = await import("@/lib/search/autocomplete");

const row = (name: string) => ({
  product_id: `id-${name}`,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  canonical_name: name,
  brand: null,
  image: null,
  category_slug: "ssd",
  best_price: "2500000",
  total_count: 1,
});

const calls = () => rpc.mock.calls.map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [row("SSD Samsung 990 Pro 2TB")], error: null });
});

describe("autocomplete — intent", () => {
  it("'ssd 2tb dưới 3 triệu' sends only filters (no leftover words) and reports the chips", async () => {
    const res = await autocomplete("ssd 2tb dưới 3 triệu");
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = calls()[0];
    expect(args).toMatchObject({
      p_category_id: "cat-ssd",
      p_capacity_gb: 2048,
      p_max_price: 3_000_000,
      p_limit: AUTOCOMPLETE_LIMIT,
      p_offset: 0,
      // Keyword consumed by intent → the /search default for no keyword.
      p_sort: "updated",
    });
    expect(args.p_q).toBeUndefined();
    expect(args.p_term_groups).toBeUndefined();
    expect(res.intent.map((c) => c.label)).toEqual(["Ổ cứng SSD", "2TB", "≤ 3.000.000đ"]);
    expect(res.products).toEqual([
      {
        productId: "id-SSD Samsung 990 Pro 2TB",
        slug: "ssd-samsung-990-pro-2tb",
        categorySlug: "ssd",
        name: "SSD Samsung 990 Pro 2TB",
        brand: null,
        image: null,
        bestPrice: 2_500_000,
      },
    ]);
    expect(res.q).toBe("ssd 2tb dưới 3 triệu");
  });

  it("'tai nghe sony' → category + brand filters, and both as vocab suggestions", async () => {
    const res = await autocomplete("tai nghe sony");
    expect(calls()[0]).toMatchObject({ p_category_id: "cat-tai-nghe", p_brands: ["Sony"] });
    expect(res.categories).toEqual([{ name: "Tai nghe", slug: "tai-nghe", href: "/tai-nghe" }]);
    expect(res.brands).toEqual([{ name: "Sony", href: "/brand/sony" }]);
  });

  it("'dưới 3 triệu' alone → top products for that price, relevance not used", async () => {
    await autocomplete("dưới 3 triệu");
    expect(calls()[0]).toMatchObject({ p_max_price: 3_000_000, p_sort: "updated" });
    expect(calls()[0].p_q).toBeUndefined();
  });

  it("intent search with no rows falls back to the plain text, without chips", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const res = await autocomplete("ssd dưới 3 triệu");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(calls()[1]).toMatchObject({ p_q: "ssd dưới 3 triệu", p_sort: "relevance" });
    expect(calls()[1].p_max_price).toBeUndefined();
    expect(calls()[1].p_category_id).toBeUndefined();
    expect(res.intent).toEqual([]);
    expect(res.products).toHaveLength(1);
  });
});

describe("autocomplete — keywords and synonyms", () => {
  it("'ip 15' sends the text plus its synonym group", async () => {
    await autocomplete("ip 15");
    expect(calls()[0]).toMatchObject({ p_q: "ip 15", p_sort: "relevance", p_term_groups: [["ip 15", "iphone 15"]] });
  });

  it("'sam' → Samsung brand suggestion, plain text search", async () => {
    const res = await autocomplete("sam");
    expect(res.brands[0]).toEqual({ name: "Samsung", href: "/brand/samsung" });
    expect(calls()[0]).toMatchObject({ p_q: "sam" });
    expect(res.intent).toEqual([]);
  });

  it("no marketplace / rating / voucher filter unless the text asked for it", async () => {
    await autocomplete("chuột");
    const args = calls()[0];
    expect(args.p_marketplaces).toBeUndefined();
    expect(args.p_min_rating).toBeUndefined();
    expect(args.p_has_voucher).toBeUndefined();
  });

  it("caps the query at 100 characters and collapses spaces", async () => {
    const res = await autocomplete(`  sony   ${"x".repeat(200)}`);
    expect(res.q.length).toBe(100);
    expect(res.q.startsWith("sony x")).toBe(true);
    expect((calls()[0].p_q as string).length).toBeLessThanOrEqual(100);
  });

  it("throws on an RPC error (the route answers with the empty shape)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(autocomplete("sony")).rejects.toThrow(/boom/);
  });
});
