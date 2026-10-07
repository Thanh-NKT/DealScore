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

describe("describeTriggers — price_hike", () => {
  it("floors the % above the prior 60-day median", () => {
    expect(
      describeTriggers(["price_hike"], {
        price: 1_239_000,
        targetPrice: null,
        baselinePrice: null,
        lastAlertPrice: null,
        dealScore: null,
        referencePrice: 1_000_000,
      }),
    ).toEqual(["Giá đang cao hơn 23% so với 60 ngày trước — chưa nên mua lúc này"]);
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
  triggerTexts: ["Giá đã xuống dưới mức bạn đặt (2.600.000đ)"],
  scoreReasons: ["✓ Thấp hơn 12% so với giá trung vị 90 ngày"],
  buyUrl: "https://dealscore.vn/go/shopee/o1?src=email&watch=w1&alert=a1",
  manageUrl: "https://dealscore.vn/account/watch/w1",
  pauseUrl: "https://dealscore.vn/unsubscribe?t=x",
  ...o,
});

describe("renderAlertEmail", () => {
  const input = (items: AlertEmailItem[]) => ({
    items,
    unsubscribeAllUrl: "https://dealscore.vn/unsubscribe?t=all",
    siteUrl: "https://dealscore.vn",
  });

  it("a price-hike-only item: its own subject, no baseline line, CTA to DealScore", () => {
    const e = renderAlertEmail(
      input([item({ priceHikeOnly: true, baselinePrice: 2_000_000, buyUrl: "https://dealscore.vn/o-cung/ssd?variant=v" })]),
    );
    expect(e.subject).toBe("SSD Samsung 990 đang cao hơn mức thường thấy");
    expect(e.html).toContain("Xem giá trên DealScore");
    expect(e.html).not.toContain("Mua trên Shopee");
    expect(e.html).not.toContain("lúc bắt đầu theo dõi");
    expect(e.text).toContain("Xem giá trên DealScore: https://dealscore.vn/o-cung/ssd?variant=v");
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
      expect(body).toContain("https://dealscore.vn/unsubscribe?t=all");
      expect(body).toContain("hoa hồng");
    }
  });

  it("adds “≈ X sau voucher” only when the effective price is lower than the alert price", () => {
    const line = `≈ ${formatVnd(2_400_000)} sau voucher`;
    const withIt = renderAlertEmail(input([item({ effectivePrice: 2_400_000 })]));
    expect(withIt.html).toContain(line);
    expect(withIt.text).toContain(line);
    for (const effectivePrice of [null, undefined, 2_500_000, 2_600_000]) {
      const e = renderAlertEmail(input([item({ effectivePrice })]));
      expect(e.html).not.toContain("sau voucher");
      expect(e.text).not.toContain("sau voucher");
    }
  });
});

describe("listUnsubscribeHeaders", () => {
  it("RFC 8058 compliant", () => {
    expect(listUnsubscribeHeaders("https://dealscore.vn/api/unsubscribe?t=a", "https://dealscore.vn/unsubscribe?t=a")).toEqual({
      "List-Unsubscribe": "<https://dealscore.vn/api/unsubscribe?t=a>, <https://dealscore.vn/unsubscribe?t=a>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
