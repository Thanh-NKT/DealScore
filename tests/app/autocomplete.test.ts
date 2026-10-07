import { beforeEach, describe, expect, it, vi } from "vitest";

const autocomplete = vi.fn();
vi.mock("@/lib/search/autocomplete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search/autocomplete")>()),
  autocomplete: (...a: unknown[]) => autocomplete(...a),
}));
vi.mock("@/lib/intent/vocab", () => ({ getIntentVocab: async () => ({ categories: [], brands: [] }) }));

const { GET } = await import("@/app/api/autocomplete/route");
const call = (q?: string) =>
  GET(new Request(`https://dealscore.vn/api/autocomplete${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`) as never);
const EMPTY = { products: [], brands: [], categories: [], intent: [] };

beforeEach(() => {
  autocomplete.mockReset();
  autocomplete.mockImplementation(async (q: string) => ({ ...EMPTY, q, products: [{ productId: "p1" }] }));
});

describe("GET /api/autocomplete", () => {
  it("answers with the object shape and a 60 s public cache", async () => {
    const res = await call("tai nghe sony");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({ ...EMPTY, q: "tai nghe sony", products: [{ productId: "p1" }] });
  });

  it("below 2 characters: the empty shape, no search", async () => {
    for (const q of [undefined, "", " s "]) {
      const res = await call(q);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...EMPTY, q: (q ?? "").trim() });
    }
    expect(autocomplete).not.toHaveBeenCalled();
  });

  it("caps the query at 100 characters before searching", async () => {
    await call("a".repeat(300));
    expect((autocomplete.mock.calls[0][0] as string).length).toBe(100);
  });

  it("a failed search answers 500 with the empty shape, never cached", async () => {
    autocomplete.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call("sony");
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ...EMPTY, q: "sony" });
    spy.mockRestore();
  });
});
