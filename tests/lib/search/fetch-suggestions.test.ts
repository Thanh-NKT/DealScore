import { describe, expect, it, vi } from "vitest";
import { fetchSuggestions, parseAnswer } from "@/lib/search/fetch-suggestions";

const EMPTY = { products: [], brands: [], categories: [], intent: [] };
const ok = (body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("fetchSuggestions", () => {
  it("parses a good answer for the query and caps the sent text at 100 characters", async () => {
    const fetchImpl = ok({ ...EMPTY, products: [{ productId: "p1" }, { productId: "p2" }] });
    const q = "a".repeat(150);
    const res = await fetchSuggestions(q, { limit: 1, signal: new AbortController().signal, fetchImpl });
    expect(res).toEqual({ ...EMPTY, q, products: [{ productId: "p1" }] });
    expect(fetchImpl.mock.calls[0][0]).toBe(`/api/autocomplete?q=${"a".repeat(100)}`);
  });

  it("a server error resolves to the empty answer (the list leaves its loading state)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await fetchSuggestions("sony", { limit: 8, signal: new AbortController().signal, fetchImpl })).toEqual({ ...EMPTY, q: "sony" });
  });

  it("offline / network failure resolves to the empty answer, not a stuck spinner", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchSuggestions("sony", { limit: 8, signal: new AbortController().signal, fetchImpl })).toEqual({ ...EMPTY, q: "sony" });
  });

  it("a malformed body resolves to the empty answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await fetchSuggestions("sony", { limit: 8, signal: new AbortController().signal, fetchImpl })).toEqual({ ...EMPTY, q: "sony" });
  });

  it("an abort (a newer query superseded it) resolves to null: keep what is shown", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    expect(await fetchSuggestions("sony", { limit: 8, signal: controller.signal, fetchImpl })).toBeNull();
  });

  it("an answer that arrives after the abort is dropped too", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify({ ...EMPTY, products: [] }), { status: 200 });
    });
    expect(await fetchSuggestions("sony", { limit: 8, signal: controller.signal, fetchImpl })).toBeNull();
  });
});

describe("parseAnswer", () => {
  it("rejects shapes without a products array and drops blank chips", () => {
    expect(parseAnswer("q", null, 8)).toBeNull();
    expect(parseAnswer("q", { products: "x" }, 8)).toBeNull();
    expect(parseAnswer("q", { products: [], intent: [{ label: " " }, { label: "2TB" }, null] }, 8)).toEqual({
      ...EMPTY,
      q: "q",
      intent: [{ label: "2TB" }],
    });
  });
});
