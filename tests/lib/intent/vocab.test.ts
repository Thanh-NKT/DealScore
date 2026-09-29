import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const reportError = vi.fn();

// unstable_cache needs a Next request/incremental-cache context: make it a pass-through.
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("@/lib/observability", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { getIntentVocab, mapVocabRows } from "@/lib/intent/vocab";

describe("mapVocabRows", () => {
  it("maps categories to {slug, name} and brands to their value", () => {
    expect(
      mapVocabRows([
        { kind: "category", value: "o-cung-ssd", label: "Ổ cứng SSD" },
        { kind: "brand", value: "Samsung", label: "Samsung" },
        { kind: "category", value: "man-hinh", label: "Màn hình" },
      ]),
    ).toEqual({
      categories: [
        { slug: "o-cung-ssd", name: "Ổ cứng SSD" },
        { slug: "man-hinh", name: "Màn hình" },
      ],
      brands: ["Samsung"],
    });
  });

  it("dedupes brands case-insensitively, keeping the first spelling", () => {
    expect(
      mapVocabRows([
        { kind: "brand", value: "WD", label: "WD" },
        { kind: "brand", value: "wd", label: "wd" },
        { kind: "brand", value: "Kingston", label: "Kingston" },
      ]).brands,
    ).toEqual(["WD", "Kingston"]);
  });

  it("skips blank values and unknown kinds", () => {
    expect(
      mapVocabRows([
        { kind: "brand", value: "  ", label: "" },
        { kind: "category", value: "", label: "x" },
        { kind: "other", value: "x", label: "x" },
      ]),
    ).toEqual({ categories: [], brands: [] });
  });
});

describe("getIntentVocab", () => {
  beforeEach(() => {
    rpc.mockReset();
    reportError.mockReset();
  });

  it("reads the intent_vocab RPC", async () => {
    rpc.mockResolvedValue({ data: [{ kind: "brand", value: "Samsung", label: "Samsung" }], error: null });
    await expect(getIntentVocab()).resolves.toEqual({ categories: [], brands: ["Samsung"] });
    expect(rpc).toHaveBeenCalledWith("intent_vocab");
  });

  it("returns an empty vocab and reports when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getIntentVocab()).resolves.toEqual({ categories: [], brands: [] });
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("returns an empty vocab when the client throws", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    await expect(getIntentVocab()).resolves.toEqual({ categories: [], brands: [] });
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
