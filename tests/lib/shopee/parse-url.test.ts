import { describe, expect, it } from "vitest";
import {
  extractFirstUrl,
  externalItemId,
  normalizeLookupInput,
  parseShopeeUrl,
} from "@/lib/shopee/parse-url";

describe("parseShopeeUrl — dạng hợp lệ", () => {
  it("đọc được dạng canonical", () => {
    expect(parseShopeeUrl("https://shopee.vn/product/123456/789012")).toEqual({
      ok: true,
      shopId: "123456",
      itemId: "789012",
    });
  });

  it("đọc được dạng slug -i.shopid.itemid", () => {
    expect(
      parseShopeeUrl("https://shopee.vn/O-cung-SSD-Samsung-i.123456.789012"),
    ).toEqual({ ok: true, shopId: "123456", itemId: "789012" });
  });

  it("bỏ qua query rác", () => {
    expect(
      parseShopeeUrl("https://shopee.vn/product/123456/789012?sp_atk=x&xptdk=y"),
    ).toEqual({ ok: true, shopId: "123456", itemId: "789012" });
  });

  it("chấp nhận www và khoảng trắng thừa", () => {
    expect(parseShopeeUrl("  https://www.shopee.vn/product/1/2  ")).toEqual({
      ok: true,
      shopId: "1",
      itemId: "2",
    });
  });

  it("báo cần theo redirect với link rút gọn", () => {
    expect(parseShopeeUrl("https://shope.ee/abcXYZ")).toEqual({
      ok: false,
      reason: "needs_redirect",
    });
    expect(parseShopeeUrl("https://s.shopee.vn/abcXYZ")).toEqual({
      ok: false,
      reason: "needs_redirect",
    });
  });
});

describe("parseShopeeUrl — host giả mạo", () => {
  // Đây là bề mặt tấn công thật: URL do người dùng cung cấp, server sẽ đi gọi
  // và ghi vào catalog. So khớp lỏng (vd host.includes("shopee.")) cho lọt
  // hết các trường hợp dưới đây.
  it("chặn tên miền lồng shopee.vn vào subdomain của kẻ tấn công", () => {
    expect(parseShopeeUrl("https://shopee.vn.evil.com/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });

  it("chặn tên miền có shopee. ở giữa", () => {
    expect(parseShopeeUrl("https://evil-shopee.com.attacker.net/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });

  it("chặn sàn khác", () => {
    expect(parseShopeeUrl("https://lazada.vn/product/1/2")).toEqual({
      ok: false,
      reason: "not_shopee",
    });
  });
});

describe("parseShopeeUrl — đầu vào không hợp lệ", () => {
  it("phân biệt chuỗi tìm kiếm với URL sàn khác", () => {
    // Người dùng gõ từ khóa vào ô dán URL phải nhận thông báo
    // "hãy dán một đường dẫn", không phải "chỉ hỗ trợ Shopee".
    expect(parseShopeeUrl("ssd samsung 2tb")).toEqual({
      ok: false,
      reason: "not_a_url",
    });
    expect(parseShopeeUrl("samsung")).toEqual({
      ok: false,
      reason: "not_a_url",
    });
  });

  it("báo không đọc được với đường dẫn Shopee lạ", () => {
    expect(parseShopeeUrl("https://shopee.vn/mall")).toEqual({
      ok: false,
      reason: "unrecognized_format",
    });
  });

  it("xử lý chuỗi rỗng", () => {
    expect(parseShopeeUrl("")).toEqual({ ok: false, reason: "not_a_url" });
  });
});

describe("externalItemId", () => {
  it("dùng chung quy ước với collector", () => {
    expect(externalItemId("123", "456")).toBe("123_456");
  });
});

describe("extractFirstUrl", () => {
  it("rút URL ra khỏi văn bản chia sẻ", () => {
    expect(extractFirstUrl("Xem sản phẩm này nè https://shope.ee/abc hay lắm")).toBe(
      "https://shope.ee/abc",
    );
  });

  it("trả null khi không có URL", () => {
    expect(extractFirstUrl("không có link")).toBeNull();
  });
});

describe("extractFirstUrl — dấu câu cuối", () => {
  it("bỏ ngoặc và dấu chấm dính sau link trong văn bản chia sẻ", () => {
    expect(extractFirstUrl("Xem nè (https://shope.ee/abc).")).toBe("https://shope.ee/abc");
  });
});

describe("normalizeLookupInput", () => {
  it("thêm https:// cho link rút gọn không có scheme — để theo redirect được", () => {
    expect(normalizeLookupInput("shope.ee/abc")).toBe("https://shope.ee/abc");
  });

  it("lấy URL đầu tiên từ đoạn văn bản chia sẻ của app Shopee", () => {
    expect(normalizeLookupInput("Mua ngay SSD giá tốt https://shope.ee/xyz nhé")).toBe(
      "https://shope.ee/xyz",
    );
  });

  it("giữ nguyên từ khóa không phải URL", () => {
    expect(normalizeLookupInput("  ssd samsung ")).toBe("ssd samsung");
    expect(parseShopeeUrl(normalizeLookupInput("samsung"))).toEqual({
      ok: false,
      reason: "not_a_url",
    });
  });
});
