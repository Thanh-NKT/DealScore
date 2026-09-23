import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
import { describeTriggers } from "@/lib/alerts/triggers-text";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { listUnsubscribeHeaders, renderAlertEmail, type AlertEmailItem } from "@/lib/email/templates/alert";

describe("describeTriggers", () => {
  const ctx = { price: 850_000, targetPrice: 900_000, baselinePrice: 1_000_000, lastAlertPrice: 880_000, dealScore: 82 };
  it("mỗi loại một câu; % làm tròn xuống", () => {
    expect(describeTriggers(["target_price", "drop_pct", "low", "deal_score", "back_in_stock", "deeper_drop"], ctx)).toEqual([
      `Giá đã xuống dưới mức bạn đặt (${formatVnd(900_000)})`,
      "Giảm 15% so với lúc bạn bắt đầu theo dõi",
      "Đang ở mức đáy 90 ngày",
      "Deal Score đạt 82/100",
      "Đã có hàng trở lại",
      "Giảm thêm 3% so với lần báo trước",
    ]);
  });
});

describe("token hủy đăng ký", () => {
  const S = "secret";
  it("ký rồi xác minh khứ hồi", () => {
    const scope = { kind: "watch" as const, userId: "u", watchId: "w" };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(scope, S), S)).toEqual(scope);
    const all = { kind: "email" as const, userId: "u" };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(all, S), S)).toEqual(all);
  });
  it("sửa payload / sai secret / rác → null, không ném", () => {
    const t = signUnsubscribeToken({ kind: "email", userId: "u" }, S);
    const [v, payload, sig] = t.split(".");
    const tampered = `${v}.${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${sig}`;
    expect(verifyUnsubscribeToken(tampered, S)).toBeNull();
    expect(verifyUnsubscribeToken(t, "khac")).toBeNull();
    expect(verifyUnsubscribeToken("rac", S)).toBeNull();
    expect(verifyUnsubscribeToken("", S)).toBeNull();
  });
});

const item = (o: Partial<AlertEmailItem> = {}): AlertEmailItem => ({
  productName: "SSD Samsung 990",
  variantKey: "2TB",
  imageUrl: null,
  price: 2_500_000,
  baselinePrice: 3_000_000,
  dealScore: 82,
  recommendation: "buy",
  triggerTexts: ["Giá đã xuống dưới mức bạn đặt (2.600.000 ₫)"],
  scoreReasons: ["✓ Thấp hơn 12% so với giá trung vị 90 ngày"],
  buyUrl: "https://kairo.vn/go/shopee/o1?src=email&watch=w1&alert=a1",
  manageUrl: "https://kairo.vn/tai-khoan/watch/w1",
  pauseUrl: "https://kairo.vn/huy-dang-ky?t=x",
  ...o,
});

describe("renderAlertEmail", () => {
  const input = (items: AlertEmailItem[]) => ({
    items,
    unsubscribeAllUrl: "https://kairo.vn/huy-dang-ky?t=all",
    siteUrl: "https://kairo.vn",
  });

  it("1 item → tiêu đề tên + giá; 3 item → số lượng", () => {
    expect(renderAlertEmail(input([item()])).subject).toBe(`SSD Samsung 990 còn ${formatVnd(2_500_000)}`);
    expect(renderAlertEmail(input([item(), item(), item()])).subject).toBe("3 sản phẩm bạn theo dõi vừa có tin mới");
  });

  it("escape tên sản phẩm; có link mua, disclosure, link tắt email ở cả html và text", () => {
    const e = renderAlertEmail(input([item({ productName: "<script>x</script>" })]));
    expect(e.html).not.toContain("<script>x</script>");
    expect(e.html).toContain("&lt;script&gt;");
    for (const body of [e.html, e.text]) {
      expect(body).toContain("src=email&");
      expect(body).toContain("alert=a1");
      expect(body).toContain("https://kairo.vn/huy-dang-ky?t=all");
      expect(body).toContain("hoa hồng");
    }
  });
});

describe("listUnsubscribeHeaders", () => {
  it("đúng RFC 8058", () => {
    expect(listUnsubscribeHeaders("https://kairo.vn/api/unsubscribe?t=a", "https://kairo.vn/huy-dang-ky?t=a")).toEqual({
      "List-Unsubscribe": "<https://kairo.vn/api/unsubscribe?t=a>, <https://kairo.vn/huy-dang-ky?t=a>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
