import { describe, expect, it } from "vitest";
import { renderAlertEmail, type AlertEmailItem } from "@/lib/email/templates/alert";
import { buildPushPayload } from "@/lib/push/payload";

// Roadmap P4 (E/F): discovery blocks were added to the alert email and push payload. A watch-only alert must
// stay BYTE-identical to what was sent before P4. The snapshots below were recorded from the pre-P4 renderer
// (commit 34f42e1) — never update them to make this test pass.
const item = (o: Partial<AlertEmailItem> = {}): AlertEmailItem => ({
  productName: "SSD Samsung 990 <Pro>",
  variantKey: "2TB",
  imageUrl: "https://img.example/a.jpg",
  price: 2_500_000,
  effectivePrice: 2_400_000,
  baselinePrice: 3_000_000,
  dealScore: 82,
  recommendation: "buy",
  triggerTexts: ["Giá đã xuống dưới mức bạn đặt"],
  scoreReasons: ["Thấp nhất 90 ngày", "Rẻ hơn 12% trung vị", "bỏ"],
  buyUrl: "https://dealscore.vn/go/shopee/o1?src=email&watch=w1&alert=e1",
  manageUrl: "https://dealscore.vn/account/watch#w1",
  pauseUrl: "https://dealscore.vn/unsubscribe?t=abc",
  ...o,
});

const base = { unsubscribeAllUrl: "https://dealscore.vn/unsubscribe?t=all", siteUrl: "https://dealscore.vn" };

describe("watch-only alert email is byte-identical to pre-P4", () => {
  it("one item", () => {
    expect(renderAlertEmail({ items: [item()], ...base })).toMatchSnapshot();
  });
  it("hike-only item", () => {
    expect(renderAlertEmail({ items: [item({ priceHikeOnly: true, effectivePrice: null })], ...base })).toMatchSnapshot();
  });
  it("two items", () => {
    expect(
      renderAlertEmail({ items: [item(), item({ productName: "RAM", baselinePrice: null, dealScore: null, recommendation: null })], ...base }),
    ).toMatchSnapshot();
  });
  it("push payloads", () => {
    const site = "https://dealscore.vn";
    expect(buildPushPayload([{ productName: "A", price: 100_000, url: `${site}/a` }], site)).toMatchSnapshot();
    expect(buildPushPayload([{ productName: "A", price: 100_000, url: `${site}/a`, priceHikeOnly: true }], site)).toMatchSnapshot();
    expect(
      buildPushPayload(
        [
          { productName: "A", price: 1, url: "u" },
          { productName: "B", price: 2, url: "v" },
          { productName: "C", price: 3, url: "w" },
        ],
        site,
      ),
    ).toMatchSnapshot();
  });
});
