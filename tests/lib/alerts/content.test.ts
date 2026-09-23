import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
import { describeTriggers } from "@/lib/alerts/triggers-text";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { listUnsubscribeHeaders, renderAlertEmail, type AlertEmailItem } from "@/lib/email/templates/alert";

describe("describeTriggers", () => {
  const ctx = { price: 850_000, targetPrice: 900_000, baselinePrice: 1_000_000, lastAlertPrice: 880_000, dealScore: 82 };
  it("one sentence per type; % rounded down", () => {
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

describe("unsubscribe token", () => {
  const S = "secret";
  it("sign then verify round trip", () => {
    const scope = { kind: "watch" as const, userId: "u", watchId: "w" };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(scope, S), S)).toEqual(scope);
    const all = { kind: "email" as const, userId: "u" };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(all, S), S)).toEqual(all);
  });
  it("tampered payload / wrong secret / junk → null, never throws", () => {
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
  manageUrl: "https://kairo.vn/account/watch/w1",
  pauseUrl: "https://kairo.vn/unsubscribe?t=x",
  ...o,
});

describe("renderAlertEmail", () => {
  const input = (items: AlertEmailItem[]) => ({
    items,
    unsubscribeAllUrl: "https://kairo.vn/unsubscribe?t=all",
    siteUrl: "https://kairo.vn",
  });

  it("1 item → name + price subject; 3 items → count", () => {
    expect(renderAlertEmail(input([item()])).subject).toBe(`SSD Samsung 990 còn ${formatVnd(2_500_000)}`);
    expect(renderAlertEmail(input([item(), item(), item()])).subject).toBe("3 sản phẩm bạn theo dõi vừa có tin mới");
  });

  it("escapes the product name; buy link, disclosure and email opt-out link in both html and text", () => {
    const e = renderAlertEmail(input([item({ productName: "<script>x</script>" })]));
    expect(e.html).not.toContain("<script>x</script>");
    expect(e.html).toContain("&lt;script&gt;");
    for (const body of [e.html, e.text]) {
      expect(body).toContain("src=email&");
      expect(body).toContain("alert=a1");
      expect(body).toContain("https://kairo.vn/unsubscribe?t=all");
      expect(body).toContain("hoa hồng");
    }
  });
});

describe("listUnsubscribeHeaders", () => {
  it("RFC 8058 compliant", () => {
    expect(listUnsubscribeHeaders("https://kairo.vn/api/unsubscribe?t=a", "https://kairo.vn/unsubscribe?t=a")).toEqual({
      "List-Unsubscribe": "<https://kairo.vn/api/unsubscribe?t=a>, <https://kairo.vn/unsubscribe?t=a>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
