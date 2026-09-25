import { describe, expect, it } from "vitest";
import { capacityEqual, extractAttributes, normalizeText } from "@/lib/matching/attributes";

describe("normalizeText", () => {
  it("strips diacritics, lowercases and turns odd characters into spaces", () => {
    expect(normalizeText("Ổ cứng SSD Samsung 990-PRO (2TB) Đen")).toBe("o cung ssd samsung 990 pro 2tb den");
  });
});

describe("extractAttributes", () => {
  it.each([
    ["SSD 2TB", 2048],
    ["SSD 512GB", 512],
    ["SSD 512 GB", 512],
    ["2,5TB", 2560],
    ["1.5 TB", 1536],
  ])("capacity of %s", (text, gb) => {
    expect(extractAttributes(text).capacityGb).toBe(gb);
  });

  it("returns null capacity when the text lists several different capacities", () => {
    expect(extractAttributes("SSD 1TB/2TB").capacityGb).toBeNull();
  });

  it("keeps one capacity when it is repeated", () => {
    expect(extractAttributes("SSD 2TB - bản 2TB").capacityGb).toBe(2048);
  });

  it.each([
    ["Chuột Đen", "black"],
    ["Mouse Black", "black"],
    ["Màu trắng", "white"],
    ["xám", "gray"],
    ["Grey", "gray"],
    ["Xanh dương", "blue"],
    ["xanh lá", "green"],
    ["Đỏ", "red"],
  ])("color of %s", (text, color) => {
    expect(extractAttributes(text).color).toBe(color);
  });

  it("does not read 'do' inside another word as red", () => {
    expect(extractAttributes("Dòng cao cấp").color).toBeNull();
    expect(extractAttributes("Đồng hồ").color).toBeNull();
  });

  it("on titles, only reads Vietnamese color words right after 'màu'", () => {
    const strict = { bareVietnameseColors: false };
    expect(extractAttributes("Bàn phím đèn LED cảm biến", strict).color).toBeNull();
    expect(extractAttributes("Bàn phím cơ màu đen", strict).color).toBe("black");
    expect(extractAttributes("Keyboard Black", strict).color).toBe("black");
  });

  it("returns null color when two different colors appear", () => {
    expect(extractAttributes("Đen / Trắng").color).toBeNull();
  });

  it.each([
    ['Màn hình 27"', 27],
    ["Màn hình 27 inch", 27],
    ["Monitor 23.8in", 23.8],
  ])("size of %s", (text, inch) => {
    expect(extractAttributes(text).sizeInch).toBe(inch);
  });

  it("returns all nulls for plain text", () => {
    expect(extractAttributes("Tiêu chuẩn")).toEqual({ capacityGb: null, color: null, sizeInch: null });
  });
});

describe("capacityEqual", () => {
  it("treats 2TB and 2000GB as equal (≤ 3% apart)", () => {
    expect(capacityEqual(2048, 2000)).toBe(true);
  });
  it("treats 1TB and 2TB as different", () => {
    expect(capacityEqual(1024, 2048)).toBe(false);
  });
});
