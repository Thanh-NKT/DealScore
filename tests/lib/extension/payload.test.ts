import { describe, expect, it } from "vitest";
import { isAllowedExtensionOrigin, validateObservationPayload } from "@/lib/extension/payload";

const NOW = new Date("2026-09-25T12:00:00Z");
const ok = { marketplace: "shopee", item: "123_456", models: [{ name: " 2TB ", price: 2_390_000, originalPrice: 2_990_000, stock: 12 }] };

describe("validateObservationPayload", () => {
  it("accepts a well-formed payload and trims the model name", () => {
    const r = validateObservationPayload({ ...ok, freeShipping: true }, NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        marketplace: "shopee",
        item: "123_456",
        observedAt: NOW.toISOString(),
        models: [{ modelId: null, name: "2TB", price: 2_390_000, originalPrice: 2_990_000, stock: 12 }],
        freeShipping: true,
        hasVoucher: null,
      },
    });
  });

  it.each([
    ["not an object", "x"],
    ["other marketplace", { ...ok, marketplace: "lazada" }],
    ["bad item id", { ...ok, item: "../../x" }],
    ["no models", { ...ok, models: [] }],
    ["zero price", { ...ok, models: [{ price: 0 }] }],
    ["string price", { ...ok, models: [{ price: "1000" }] }],
    ["absurd price", { ...ok, models: [{ price: 1e12 }] }],
  ])("rejects %s", (_label, body) => {
    expect(validateObservationPayload(body, NOW).ok).toBe(false);
  });

  it("drops a list price that is not above the price, and bad stock", () => {
    const r = validateObservationPayload({ ...ok, models: [{ price: 100, originalPrice: 90, stock: -3 }] }, NOW);
    expect(r.ok && r.value.models[0]).toMatchObject({ originalPrice: null, stock: null });
  });

  it("uses the server clock when the client timestamp is more than 10 minutes off", () => {
    const skewed = validateObservationPayload({ ...ok, observedAt: "2020-01-01T00:00:00Z" }, NOW);
    expect(skewed.ok && skewed.value.observedAt).toBe(NOW.toISOString());
    const fine = validateObservationPayload({ ...ok, observedAt: "2026-09-25T11:55:00Z" }, NOW);
    expect(fine.ok && fine.value.observedAt).toBe("2026-09-25T11:55:00.000Z");
  });
});

describe("isAllowedExtensionOrigin", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";
  it("allows listed extension ids only", () => {
    expect(isAllowedExtensionOrigin(`chrome-extension://${id}`, { ids: id, production: true })).toBe(true);
    expect(isAllowedExtensionOrigin(`chrome-extension://${"b".repeat(32)}`, { ids: id, production: true })).toBe(false);
  });
  it("rejects web origins and missing origins", () => {
    expect(isAllowedExtensionOrigin("https://evil.com", { ids: id, production: false })).toBe(false);
    expect(isAllowedExtensionOrigin(null, { ids: id, production: false })).toBe(false);
  });
  it("without a list: any unpacked extension in dev, none in production", () => {
    expect(isAllowedExtensionOrigin(`chrome-extension://${id}`, { production: false })).toBe(true);
    expect(isAllowedExtensionOrigin(`chrome-extension://${id}`, { production: true })).toBe(false);
  });
});
