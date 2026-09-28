import { describe, expect, it } from "vitest";
import { variantLabel } from "@/components/product/variant-label";

describe("variantLabel", () => {
  it("shows only attribute values", () => {
    expect(variantLabel("capacity=2TB, color=black")).toBe("2TB · black");
    expect(variantLabel("dung-luong=512GB")).toBe("512GB");
  });

  it("keeps marketplace model names readable", () => {
    expect(variantLabel("Đen,XL")).toBe("Đen · XL");
    expect(variantLabel("Bản điện tử 5,2L")).toBe("Bản điện tử 5,2L");
    expect(variantLabel("dung-tich=5,2L, mau=Đen")).toBe("5,2L · Đen");
  });

  it("falls back for empty keys", () => {
    expect(variantLabel("")).toBe("Tiêu chuẩn");
    expect(variantLabel(null)).toBe("Tiêu chuẩn");
  });
});
