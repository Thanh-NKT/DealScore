import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSlugRedirectCache,
  loadAllSlugRedirects,
  productSlugCandidate,
  RESERVED_FIRST_SEGMENTS,
  SLUG_REDIRECT_RETRY_MS,
  SLUG_REDIRECT_TTL_MS,
} from "@/lib/product/slug-redirect-proxy";
import type { SlugRedirectRow } from "@/lib/product/slug-redirect";

describe("productSlugCandidate", () => {
  it("returns the second segment of a two-segment path", () => {
    expect(productSlugCandidate("/dien-thoai/galaxy-s24")).toBe("galaxy-s24");
    expect(productSlugCandidate("/old-cat/x%2Dy")).toBe("x-y");
  });
  it("ignores other shapes, reserved first segments, dotted segments and bad encodings", () => {
    for (const p of ["/", "/dien-thoai", "/a/b/c", "/a/b/", "//b", "/account/searches", "/api/health", "/seller/abc",
      "/shared/tok", "/_next/data", "/a/b.png", "/a/%E0%A4%A", "/brand/apple"]) {
      expect(productSlugCandidate(p)).toBeNull();
    }
  });
  it("reserves every static top-level route of src/app", () => {
    const dirs = readdirSync(join(process.cwd(), "src/app"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("(") && !d.name.startsWith("_"))
      .map((d) => d.name);
    expect(dirs.length).toBeGreaterThan(5);
    for (const d of dirs) expect(RESERVED_FIRST_SEGMENTS.has(d), d).toBe(true);
  });
});

const row = (slug: string): SlugRedirectRow => ({ productSlug: slug, categorySlug: "loa", variantMap: {} });

function harness(loadImpl: () => Promise<Map<string, SlugRedirectRow>>) {
  let t = 1_000_000;
  const load = vi.fn(loadImpl);
  const onError = vi.fn();
  const cache = createSlugRedirectCache({ load, now: () => t, onError });
  return { cache, load, onError, advance: (ms: number) => (t += ms) };
}

describe("createSlugRedirectCache", () => {
  it("loads once on the first lookup, then serves from memory until the TTL", async () => {
    const h = harness(async () => new Map([["old", row("new")]]));
    const [a, b] = await Promise.all([h.cache.lookup("old"), h.cache.lookup("nope")]);
    expect(a).toEqual(row("new"));
    expect(b).toBeNull();
    h.advance(SLUG_REDIRECT_TTL_MS - 1);
    expect(await h.cache.lookup("old")).toEqual(row("new"));
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it("after the TTL it answers from the stale map and refreshes in the background (single flight)", async () => {
    let gen = 0;
    const h = harness(async () => new Map([["old", row(`v${++gen}`)]]));
    await h.cache.lookup("old");
    h.advance(SLUG_REDIRECT_TTL_MS);
    const [x, y] = await Promise.all([h.cache.lookup("old"), h.cache.lookup("old")]);
    expect([x, y]).toEqual([row("v1"), row("v1")]);
    expect(h.load).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () => expect(await h.cache.lookup("old")).toEqual(row("v2")));
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it("a failed load answers null (the page fallback still redirects), reports, and retries after the short delay", async () => {
    let fail = true;
    const h = harness(async () => {
      if (fail) throw new Error("db down");
      return new Map([["old", row("new")]]);
    });
    expect(await h.cache.lookup("old")).toBeNull();
    expect(h.onError).toHaveBeenCalledTimes(1);
    fail = false;
    h.advance(SLUG_REDIRECT_RETRY_MS - 1);
    expect(await h.cache.lookup("old")).toBeNull();
    expect(h.load).toHaveBeenCalledTimes(1);
    h.advance(1);
    await h.cache.lookup("old");
    await vi.waitFor(async () => expect(await h.cache.lookup("old")).toEqual(row("new")));
  });

  it("a failed refresh keeps the last good map", async () => {
    let fail = false;
    const h = harness(async () => {
      if (fail) throw new Error("db down");
      return new Map([["old", row("new")]]);
    });
    await h.cache.lookup("old");
    fail = true;
    h.advance(SLUG_REDIRECT_TTL_MS);
    await h.cache.lookup("old");
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1));
    expect(await h.cache.lookup("old")).toEqual(row("new"));
  });
});

function pagedClient(total: number) {
  const ranges: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    old_slug: `s${String(i).padStart(5, "0")}`,
    variant_map: { a: "b" },
    products: i === 1 ? { slug: null, categories: null } : { slug: `t${i}`, categories: i === 2 ? null : { slug: "loa" } },
  }));
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      ranges.push([from, to]);
      const page = rows.slice(from, to + 1);
      return { abortSignal: () => Promise.resolve({ data: page, error: null }) };
    }),
  };
  return { client: { from: vi.fn(() => builder) } as never, ranges, builder };
}

describe("loadAllSlugRedirects", () => {
  it("pages by 1,000 ordered by old_slug and maps rows like loadSlugRedirect", async () => {
    const { client, ranges, builder } = pagedClient(2_001);
    const map = await loadAllSlugRedirects(client);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(builder.order).toHaveBeenCalledWith("old_slug");
    expect(map.size).toBe(2_000); // the row whose target has no slug is skipped
    expect(map.get("s00000")).toEqual({ productSlug: "t0", categorySlug: "loa", variantMap: { a: "b" } });
    expect(map.get("s00002")!.categorySlug).toBe("san-pham");
    expect(map.has("s00001")).toBe(false);
  });
  it("stops after a short page", async () => {
    const { client, ranges } = pagedClient(3);
    expect((await loadAllSlugRedirects(client)).size).toBe(2);
    expect(ranges).toEqual([[0, 999]]);
  });
  it("throws on a DB error", async () => {
    const builder = {
      select: () => builder, order: () => builder,
      range: () => ({ abortSignal: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
    };
    await expect(loadAllSlugRedirects({ from: () => builder } as never)).rejects.toThrow(/boom/);
  });
});
