import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("bỏ dấu tiếng Việt", () => {
    expect(slugify("Ổ cứng SSD Samsung 990 PRO 2TB")).toBe(
      "o-cung-ssd-samsung-990-pro-2tb",
    );
  });

  it("xử lý chữ Đ/đ — NFD KHÔNG phân rã được chữ này", () => {
    expect(slugify("Đĩa cứng")).toBe("dia-cung");
    expect(slugify("đèn")).toBe("den");
  });

  it("gộp ký tự lạ và dấu gạch liền nhau", () => {
    expect(slugify("A  --  B")).toBe("a-b");
    expect(slugify("Bàn phím (cơ) 100%!")).toBe("ban-phim-co-100");
  });

  it("cắt theo maxLength và không để lại gạch ở cuối", () => {
    expect(slugify("aaaa bbbb cccc", 10)).toBe("aaaa-bbbb");
  });

  it("không bao giờ trả chuỗi rỗng — slug rỗng sẽ làm hỏng URL", () => {
    expect(slugify("!!!")).not.toBe("");
    expect(slugify("")).not.toBe("");
  });
});

describe("uniqueSlug", () => {
  it("trả nguyên slug khi chưa tồn tại", async () => {
    const taken = new Set<string>();
    expect(await uniqueSlug("a", async (s) => taken.has(s))).toBe("a");
  });

  it("thêm hậu tố cho tới khi trống", async () => {
    const taken = new Set(["a", "a-2"]);
    expect(await uniqueSlug("a", async (s) => taken.has(s))).toBe("a-3");
  });

  it("chuẩn hóa base trước khi kiểm tra trùng", async () => {
    const taken = new Set<string>();
    expect(await uniqueSlug("Ổ Cứng", async (s) => taken.has(s))).toBe("o-cung");
  });
});
