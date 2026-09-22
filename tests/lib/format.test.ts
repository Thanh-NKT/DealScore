import { describe, expect, it } from "vitest";
import { daysBetween, discountPercent, formatVnd, toVnDate } from "@/lib/format";

/** Intl chèn non-breaking space trước ký hiệu tiền tệ. */
const nbsp = (s: string) => s.replace(/ /g, " ");

describe("formatVnd", () => {
  it("định dạng theo kiểu Việt Nam", () => {
    expect(nbsp(formatVnd(1_234_000))).toBe("1.234.000 ₫");
  });

  it("làm tròn về số nguyên", () => {
    expect(nbsp(formatVnd(1000.6))).toBe("1.001 ₫");
  });

  it("trả dấu gạch khi không có giá trị — không bao giờ hiện 0 ₫", () => {
    expect(formatVnd(null)).toBe("—");
    expect(formatVnd(undefined)).toBe("—");
    expect(formatVnd(Number.NaN)).toBe("—");
  });
});

describe("discountPercent", () => {
  it("tính phần trăm giảm", () => {
    expect(discountPercent(80, 100)).toBe(20);
  });

  it("làm tròn XUỐNG, không làm tròn lên một con số khuyến mãi", () => {
    expect(discountPercent(99, 100)).toBe(1);
  });

  it("trả null khi làm tròn xuống ra 0 — '−0%' là vô nghĩa", () => {
    expect(discountPercent(999, 1000)).toBeNull();
  });

  it("trả null khi không giảm hoặc đắt hơn niêm yết", () => {
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(120, 100)).toBeNull();
  });

  it("trả null khi thiếu dữ liệu", () => {
    expect(discountPercent(null, 100)).toBeNull();
    expect(discountPercent(100, null)).toBeNull();
    expect(discountPercent(undefined, undefined)).toBeNull();
  });
});

describe("toVnDate", () => {
  it("dùng giờ Việt Nam chứ không phải UTC", () => {
    // 17:30Z ngày 10 = 00:30 ngày 11 giờ VN.
    expect(toVnDate("2026-03-10T17:30:00Z")).toBe("2026-03-11");
  });

  it("giữ nguyên ngày khi còn trong ngày theo giờ VN", () => {
    expect(toVnDate("2026-03-10T05:00:00Z")).toBe("2026-03-10");
  });
});

describe("daysBetween", () => {
  it("trả số ngày dương bất kể thứ tự", () => {
    expect(daysBetween("2026-03-10T00:00:00Z", "2026-03-12T00:00:00Z")).toBe(2);
    expect(daysBetween("2026-03-12T00:00:00Z", "2026-03-10T00:00:00Z")).toBe(2);
  });
});
