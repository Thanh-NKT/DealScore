import { describe, expect, it, vi } from "vitest";
import { loadSlugRedirect, slugRedirectPath } from "@/lib/product/slug-redirect";

const row = { productSlug: "galaxy-s24", categorySlug: "dien-thoai", variantMap: { old1: "new1" } };

describe("slugRedirectPath", () => {
  it("maps ?variant= through the variant map and keeps range / ref", () => {
    expect(slugRedirectPath(row, { variant: "old1", range: "90", ref: "share" })).toBe(
      "/dien-thoai/galaxy-s24?variant=new1&range=90&ref=share",
    );
  });
  it("keeps a variant id that is not in the map (it moved with its id)", () => {
    expect(slugRedirectPath(row, { variant: "kept" })).toBe("/dien-thoai/galaxy-s24?variant=kept");
  });
  it("drops unknown parameters and empty values; no query → bare path", () => {
    expect(slugRedirectPath(row, { range: "7", utm: "x" } as never)).toBe("/dien-thoai/galaxy-s24?range=7");
    expect(slugRedirectPath(row, {})).toBe("/dien-thoai/galaxy-s24");
    expect(slugRedirectPath(row, { variant: "" })).toBe("/dien-thoai/galaxy-s24");
  });
  it("takes the first value of a repeated parameter", () => {
    expect(slugRedirectPath(row, { variant: ["old1", "x"] } as never)).toBe("/dien-thoai/galaxy-s24?variant=new1");
  });
});

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const builder = {
    select: vi.fn((...a: unknown[]) => (calls.push(["select", ...a]), builder)),
    eq: vi.fn((...a: unknown[]) => (calls.push(["eq", ...a]), builder)),
    maybeSingle: vi.fn(async () => result),
  };
  const client = { from: vi.fn((t: string) => (calls.push(["from", t]), builder)) };
  return { client: client as never, calls };
}

describe("loadSlugRedirect", () => {
  it("reads the redirect row with the target product's slug and category", async () => {
    const { client, calls } = fakeClient({
      data: { variant_map: { a: "b" }, products: { slug: "x", categories: { slug: "loa" } } },
      error: null,
    });
    expect(await loadSlugRedirect(client, "old")).toEqual({ productSlug: "x", categorySlug: "loa", variantMap: { a: "b" } });
    expect(calls).toContainEqual(["from", "product_slug_redirects"]);
    expect(calls).toContainEqual(["eq", "old_slug", "old"]);
  });
  it("falls back to san-pham without a category and ignores a malformed map", async () => {
    const { client } = fakeClient({ data: { variant_map: ["bad"], products: { slug: "x", categories: null } }, error: null });
    expect(await loadSlugRedirect(client, "old")).toEqual({ productSlug: "x", categorySlug: "san-pham", variantMap: {} });
  });
  it("no row or a target without a slug → null", async () => {
    expect(await loadSlugRedirect(fakeClient({ data: null, error: null }).client, "old")).toBeNull();
    expect(await loadSlugRedirect(fakeClient({ data: { variant_map: {}, products: { slug: null, categories: null } }, error: null }).client, "o")).toBeNull();
  });
  it("a DB error throws (never a 404)", async () => {
    await expect(loadSlugRedirect(fakeClient({ data: null, error: { message: "boom" } }).client, "old")).rejects.toThrow(/boom/);
  });
});
