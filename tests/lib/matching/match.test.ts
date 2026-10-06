import { describe, expect, it } from "vitest";
import {
  AUTO_MATCH_THRESHOLD,
  bestMatch,
  detectBrand,
  scoreCandidate,
  type MatchCandidate,
} from "@/lib/matching/match";

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    variantId: "v-2tb",
    productId: "p-990",
    brand: "Samsung",
    model: "990 Pro",
    canonicalName: "SSD Samsung 990 Pro",
    variantKey: "dung-luong=2TB",
    variantSpecs: {},
    siblingCount: 2,
    ...over,
  };
}

describe("detectBrand", () => {
  const brands = ["Samsung", "WD", "Western Digital", "LG"];

  it("finds a brand as a whole word, case- and diacritic-insensitive", () => {
    expect(detectBrand("Ổ cứng SAMSUNG 990 Pro", brands)).toBe("Samsung");
  });
  it("prefers the longest matching brand", () => {
    expect(detectBrand("Western Digital WD Black SN850X", brands)).toBe("Western Digital");
  });
  it("does not match a brand inside another word", () => {
    expect(detectBrand("Bàn phím Glorious", brands)).toBeNull();
  });
  it("returns null when no brand appears", () => {
    expect(detectBrand("SSD NVMe 2TB", brands)).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("scores a full match (brand + model + capacity) at or above the auto threshold", () => {
    const r = scoreCandidate({ title: "Ổ cứng SSD Samsung 990 PRO NVMe", modelName: "2TB" }, candidate());
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(r.reason).toContain("Samsung");
  });

  it("matches a model written without the space", () => {
    const r = scoreCandidate({ title: "Samsung 990PRO 2TB", modelName: "" }, candidate());
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("returns 0 for a different brand", () => {
    const r = scoreCandidate({ title: "WD Black 990 Pro 2TB", modelName: "2TB" }, candidate());
    expect(r.confidence).toBe(0);
  });

  it("returns 0 when the capacity conflicts", () => {
    const r = scoreCandidate({ title: "Samsung 990 Pro", modelName: "1TB" }, candidate());
    expect(r.confidence).toBe(0);
    expect(r.reason).toContain("dung lượng");
  });

  it("stays below the auto threshold when the offer is missing an attribute the variant has", () => {
    const r = scoreCandidate(
      { title: "Chuột Logitech G304", modelName: "" },
      candidate({ brand: "Logitech", model: "G304", variantKey: "mau=Đen" }),
    );
    expect(r.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("gives partial model credit when only some model tokens appear", () => {
    const r = scoreCandidate({ title: "Samsung 990 2TB", modelName: "" }, candidate());
    expect(r.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("gives full attribute credit to a single-variant product with no attributes", () => {
    const r = scoreCandidate(
      { title: "Tai nghe Sony WH-1000XM5", modelName: "Tiêu chuẩn" },
      candidate({ brand: "Sony", model: "WH-1000XM5", variantKey: "Tiêu chuẩn", siblingCount: 1 }),
    );
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("does not give that credit when the product has several variants", () => {
    const r = scoreCandidate(
      { title: "Tai nghe Sony WH-1000XM5", modelName: "Tiêu chuẩn" },
      candidate({ brand: "Sony", model: "WH-1000XM5", variantKey: "Tiêu chuẩn", siblingCount: 2 }),
    );
    expect(r.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it("returns a low score when the candidate has no model", () => {
    const r = scoreCandidate({ title: "Samsung SSD 2TB", modelName: "" }, candidate({ model: null }));
    expect(r.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });
});

describe("scoreCandidate — listing-level price range", () => {
  it("never auto-attaches a price range to one variant of a multi-variant product", () => {
    const offer = { title: "Ổ cứng SSD Samsung 990 PRO NVMe 2TB", modelName: "", priceRange: true };
    const r = scoreCandidate(offer, candidate());
    expect(r.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.reason).toContain("nhiều mức giá");
    expect(scoreCandidate({ ...offer, priceRange: false }, candidate()).confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("a single-variant product is not affected", () => {
    const r = scoreCandidate(
      { title: "Tai nghe Sony WH-1000XM5", modelName: "", priceRange: true },
      candidate({ brand: "Sony", model: "WH-1000XM5", variantKey: "Tiêu chuẩn", siblingCount: 1 }),
    );
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });
});

describe("scoreCandidate — superset models", () => {
  it("a longer model in the title gets no model credit", () => {
    const base = candidate({ brand: "Samsung", model: "980", variantKey: "dung-luong=1TB", siblingCount: 1 });
    expect(scoreCandidate({ title: "Samsung 980 PRO 1TB", modelName: "" }, base).confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(scoreCandidate({ title: "Samsung 980 1TB", modelName: "" }, base).confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("matches model tokens on boundaries, never as a substring", () => {
    const g304 = candidate({ brand: "Logitech", model: "G304", variantKey: "mau=Đen" });
    expect(scoreCandidate({ title: "Chuột Logitech G3040 Đen", modelName: "Đen" }, g304).confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });
});

describe("bestMatch", () => {
  const offer = { title: "Samsung 990 Pro", modelName: "2TB" };

  it("picks the right variant among siblings", () => {
    const r = bestMatch(offer, [
      candidate({ variantId: "v-1tb", variantKey: "dung-luong=1TB" }),
      candidate({ variantId: "v-2tb", variantKey: "dung-luong=2TB" }),
    ]);
    expect(r?.variantId).toBe("v-2tb");
    expect(r!.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("downgrades to 0.9 when two different variants both clear the auto threshold", () => {
    const r = bestMatch(offer, [
      candidate({ variantId: "a", productId: "p1" }),
      candidate({ variantId: "b", productId: "p2" }),
    ]);
    expect(r?.confidence).toBe(0.9);
    expect(r?.reason).toContain("nhiều ứng viên");
  });

  it("returns null below the suggest threshold", () => {
    expect(bestMatch({ title: "Chuột không tên", modelName: "" }, [candidate()])).toBeNull();
  });

  it("returns null with no candidates", () => {
    expect(bestMatch(offer, [])).toBeNull();
  });
});
