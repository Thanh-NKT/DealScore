import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/actions/report", () => ({ submitDataReport: vi.fn() }));
const { DataReportDialog, reportErrorText } = await import("@/components/product/data-report-dialog");

describe("DataReportDialog", () => {
  it("renders the trigger, the four kinds and the offer options of the variant", () => {
    const html = renderToStaticMarkup(
      createElement(DataReportDialog, {
        productId: "p",
        productName: "Tai nghe A",
        variantId: "v",
        offers: [{ offerId: "o1", marketplace: "shopee", sellerName: "Shop X", price: 990_000 }],
      }),
    );
    expect(html).toContain("Góp ý dữ liệu");
    expect(html).toContain("Bạn thấy điều gì chưa đúng về Tai nghe A?");
    for (const label of ["Giá sai", "Ghép nhầm sản phẩm khác", "Hết hàng nhưng vẫn hiện / còn hàng nhưng báo hết", "Khác"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Không rõ / cả sản phẩm");
    expect(html).toContain('value="o1"');
    expect(html).toContain("Shop X");
    expect(html).toContain("0/500");
    expect(html).toContain("Đừng ghi email, số điện thoại hay thông tin cá nhân.");
  });
});

describe("reportErrorText", () => {
  it("one message per failure", () => {
    expect(reportErrorText({ ok: true, duplicate: false })).toBeNull();
    expect(reportErrorText({ ok: false, error: "rate_limited" })).toBe("Bạn đã gửi nhiều góp ý trong giờ qua. Thử lại sau nhé.");
    expect(reportErrorText({ ok: false, error: "unavailable" })).toBe("Chưa gửi được. Thử lại sau ít phút.");
    expect(reportErrorText("network")).toBe("Chưa gửi được. Thử lại sau ít phút.");
    expect(reportErrorText({ ok: false, error: "invalid" })).toContain("chưa hợp lệ");
  });
});
