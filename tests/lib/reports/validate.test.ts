import { describe, expect, it } from "vitest";
import { validateReport } from "@/lib/reports/validate";

const P = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";

describe("validateReport", () => {
  it("accepts a minimal report and trims an empty message to null", () => {
    expect(validateReport({ productId: P, kind: "wrong_price", message: "   " })).toEqual({
      ok: true,
      value: { productId: P, variantId: null, offerId: null, kind: "wrong_price", message: null },
    });
  });
  it("keeps a trimmed message and optional ids", () => {
    const r = validateReport({ productId: P, variantId: V, offerId: "", kind: "other", message: "  giá sai  " });
    expect(r).toEqual({ ok: true, value: { productId: P, variantId: V, offerId: null, kind: "other", message: "giá sai" } });
  });
  it("rejects bad uuids, unknown kinds, 501 chars and 'other' without a message", () => {
    expect(validateReport({ productId: "x", kind: "stock" }).ok).toBe(false);
    expect(validateReport({ productId: P, variantId: "nope", kind: "stock" }).ok).toBe(false);
    expect(validateReport({ productId: P, kind: "spam" }).ok).toBe(false);
    expect(validateReport({ productId: P, kind: "stock", message: "a".repeat(501) }).ok).toBe(false);
    expect(validateReport({ productId: P, kind: "stock", message: ` ${"a".repeat(500)} ` }).ok).toBe(true);
    expect(validateReport({ productId: P, kind: "other" }).ok).toBe(false);
    expect(validateReport(null).ok).toBe(false);
  });
  it("ignores a form-supplied userId", () => {
    const r = validateReport({ productId: P, kind: "stock", userId: V });
    expect(r.ok && "userId" in r.value).toBe(false);
  });
});
