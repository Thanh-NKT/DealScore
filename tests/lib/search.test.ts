import { describe, expect, it } from "vitest";
import { parseSearchParams, toSearchParams } from "@/lib/search";

const parse = (qs: string) => parseSearchParams(new URLSearchParams(qs));

describe("parseSearchParams", () => {
  it("mặc định sort là relevance khi có từ khóa", () => {
    expect(parse("q=ssd").sort).toBe("relevance");
  });

  it("mặc định sort là updated khi không có từ khóa", () => {
    expect(parse("").sort).toBe("updated");
  });

  it("nhận nhiều brand", () => {
    expect(parse("brand=samsung&brand=wd").brands).toEqual(["samsung", "wd"]);
  });

  it("hoán đổi khi min lớn hơn max", () => {
    const p = parse("min=500&max=100");
    expect(p.minPrice).toBe(100);
    expect(p.maxPrice).toBe(500);
  });

  it("ép page về 1 khi nhỏ hơn 1 hoặc không phải số", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-3").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });

  it("bỏ qua sort lạ và quay về mặc định", () => {
    expect(parse("q=ssd&sort=hacker").sort).toBe("relevance");
  });

  it("bỏ qua giá không phải số", () => {
    expect(parse("min=abc").minPrice).toBeUndefined();
  });

  it("đọc được cả searchParams dạng object của Next.js", () => {
    const p = parseSearchParams({ q: "ssd", brand: ["samsung", "wd"], page: "2" });
    expect(p.q).toBe("ssd");
    expect(p.brands).toEqual(["samsung", "wd"]);
    expect(p.page).toBe(2);
  });
});

describe("round-trip parse ↔ serialize", () => {
  it("giữ nguyên mọi tham số — điều kiện để filter chia sẻ được qua URL", () => {
    const original =
      "q=ssd+samsung&cat=o-cung-ssd&brand=samsung&brand=wd&min=100&max=500&sort=price_asc&page=3";
    const once = parseSearchParams(new URLSearchParams(original));
    const twice = parseSearchParams(toSearchParams(once));
    expect(twice).toEqual(once);
  });

  it("không ghi tham số mặc định vào URL", () => {
    // Ghi sort mặc định vào URL sinh ra hai đường dẫn khác nhau cho cùng
    // một trang — trùng lặp nội dung, có hại cho SEO ở mục 1.7.
    const qs = toSearchParams(parse("q=ssd")).toString();
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("sort=");
  });
});
