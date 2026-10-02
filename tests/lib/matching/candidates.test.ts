import { describe, expect, it, vi } from "vitest";
import { loadBrandVocabulary, loadMatchCandidates } from "@/lib/matching/candidates";

function fakeClient(brands: string[]) {
  const rpc = vi.fn(async () => ({ data: brands.map((brand) => ({ brand })), error: null }));
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "ilike"]) chain[k] = () => chain;
  chain.limit = async () => ({ data: [], error: null });
  return { rpc, from: vi.fn(() => chain) };
}

describe("candidates", () => {
  it("loadBrandVocabulary returns non-empty brand names", async () => {
    const c = fakeClient(["Sony", "", "Samsung"]);
    expect(await loadBrandVocabulary(c as never)).toEqual(["Sony", "Samsung"]);
  });

  it("loadMatchCandidates reuses given brands without calling product_brands", async () => {
    const c = fakeClient(["Sony"]);
    await loadMatchCandidates(c as never, "Tai nghe Sony WH1000XM5", ["Sony"]);
    expect(c.rpc).not.toHaveBeenCalled();
    expect(c.from).toHaveBeenCalledWith("products");
  });
});
