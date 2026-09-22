import { describe, expect, it } from "vitest";
import { computeDealScore } from "@/lib/deal-score";
import { expandRollup, type DailyPriceRow } from "@/lib/price-history";
import {
  buildVariantPricing,
  isOfferVisible,
  type OfferRow,
} from "@/lib/variant-pricing";

/** computeDealScore() dùng new Date() bên trong — dữ liệu phải tương đối với thời gian thật. */
const REAL_NOW = new Date();

function offer(over: Partial<OfferRow> = {}): OfferRow {
  return {
    offerId: "o1",
    marketplace: "shopee",
    listingUrl: "https://shopee.vn/product/1/2",
    listingStatus: "active",
    matchStatus: "auto",
    sellerName: "Shop A",
    sellerRating: 4.8,
    sellerRatingCount: 120,
    sellerIsOfficial: false,
    affiliateEligible: true,
    price: 1000,
    originalPrice: null,
    stock: 5,
    isFlashSale: false,
    observedAt: REAL_NOW.toISOString(),
    ...over,
  };
}

function history(days: number, price: (i: number) => number): DailyPriceRow[] {
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i;
    const p = price(i);
    return {
      day: new Date(REAL_NOW.getTime() - daysAgo * 86_400_000)
        .toISOString()
        .slice(0, 10),
      min_price: p,
      median_price: p,
      max_price: p,
      obs_count: 1,
      offer_count: 1,
      has_flash_sale: false,
      flash_min_price: null,
    };
  });
}

const HIST = history(60, (i) => 1000 + (i % 10) * 20);

describe("isOfferVisible", () => {
  it("hiện offer đã ghép tự động hoặc thủ công", () => {
    expect(isOfferVisible(offer({ matchStatus: "auto" }), false)).toBe(true);
    expect(isOfferVisible(offer({ matchStatus: "manual" }), false)).toBe(true);
  });

  it("ẩn offer pending trên sản phẩm đã verify — chưa chắc thì không khẳng định", () => {
    expect(isOfferVisible(offer({ matchStatus: "pending" }), false)).toBe(false);
  });

  it("hiện offer pending trên sản phẩm draft do ingest sinh ra", () => {
    expect(isOfferVisible(offer({ matchStatus: "pending" }), true)).toBe(true);
  });

  it("ẩn offer đã bị từ chối, kể cả trên sản phẩm draft", () => {
    expect(isOfferVisible(offer({ matchStatus: "rejected" }), true)).toBe(false);
  });

  it("ẩn offer thuộc listing không còn hoạt động", () => {
    expect(isOfferVisible(offer({ listingStatus: "inactive" }), true)).toBe(false);
  });
});

describe("buildVariantPricing — sắp xếp", () => {
  const base = {
    history: HIST,
    trackingSince: null,
    isDraftProduct: false,
    now: REAL_NOW,
  };

  it("còn hàng lên trước, trong nhóm thì giá tăng dần", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({ offerId: "b", price: 900, stock: 0 }),
        offer({ offerId: "c", price: 1200 }),
        offer({ offerId: "a", price: 1000 }),
      ],
    });
    expect(out.offers.map((o) => o.offerId)).toEqual(["a", "c", "b"]);
  });

  it("offer không có giá xuống cuối cùng", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ offerId: "x", price: null }), offer({ offerId: "y", price: 1000 })],
    });
    expect(out.offers.map((o) => o.offerId)).toEqual(["y", "x"]);
  });

  it("bỏ qua offer hết hàng khi chọn offer rẻ nhất", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({ offerId: "a", price: 800, stock: 0 }),
        offer({ offerId: "b", price: 900 }),
      ],
    });
    expect(out.cheapest?.offerId).toBe("b");
  });

  it("không chấm điểm khi mọi offer đều hết hàng", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 900, stock: 0 })],
    });
    expect(out.cheapest).toBeNull();
    expect(out.headline).toBeNull();
  });
});

describe("buildVariantPricing — điểm đầu trang (quyết định Đ7)", () => {
  const base = {
    history: HIST,
    trackingSince: null,
    isDraftProduct: false,
    now: REAL_NOW,
  };

  it("KHÔNG truyền bestOffer, nên điểm thấp hơn khi truyền bestOffer = chính nó", () => {
    // Giá phải nằm GIỮA dải lịch sử (1000–1180). Giá dưới đáy sẽ làm cả hai
    // cách tính chạm trần 100 điểm và test không phân biệt được gì.
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1100 })] });

    const inflated = computeDealScore({
      price: 1100,
      history: expandRollup(HIST),
      bestOffer: 1100, // cBetween luôn = 100 → cộng khống +20
    });

    expect(out.headline).not.toBeNull();
    expect(out.headline!.score).toBeLessThan(inflated.score!);
  });

  it("dòng offer rẻ nhất KHÔNG được hiện điểm khác với điểm đầu trang", () => {
    // Nếu vòng lặp per-offer truyền bestOffer = chính offer rẻ nhất, thành phần
    // thứ 3 luôn bằng 100 và dòng đó sẽ hiện cao hơn đầu trang tới 20 điểm.
    // Người dùng nhìn thấy hai con số mâu thuẫn trên cùng một màn hình.
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ offerId: "a", price: 1100 }), offer({ offerId: "b", price: 1400 })],
    });
    expect(out.cheapest?.dealScore?.score).toBe(out.headline?.score);
  });

  it("offer đắt hơn có điểm thấp hơn offer rẻ nhất", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ offerId: "a", price: 900 }), offer({ offerId: "b", price: 1500 })],
    });
    const a = out.offers.find((o) => o.offerId === "a")!;
    const b = out.offers.find((o) => o.offerId === "b")!;
    expect(a.dealScore!.score).toBeGreaterThan(b.dealScore!.score!);
  });
});

describe("buildVariantPricing — Fake Sale chỉ chạy khi đủ dữ liệu", () => {
  const base = { trackingSince: null, isDraftProduct: false, now: REAL_NOW };

  it("không ra nhãn khi lịch sử quá ngắn", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 900, originalPrice: 2000 })],
      history: history(5, () => 1000),
    });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("không ra nhãn khi thiếu giá niêm yết", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 1000, originalPrice: null })],
      history: history(40, () => 1000),
    });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("ra nhãn khi giảm niêm yết lớn mà giá vẫn quanh mức thường ngày", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 1000, originalPrice: 2000 })], // giảm 50% so với niêm yết
      history: history(40, () => 1000), // nhưng vẫn đúng bằng trung vị
    });
    expect(out.fakeSaleMessage).not.toBeNull();
  });
});

describe("buildVariantPricing — độ tươi dữ liệu", () => {
  const base = {
    history: HIST,
    trackingSince: null,
    isDraftProduct: false,
    now: REAL_NOW,
  };

  it("đánh dấu cũ khi quan sát mới nhất quá 48 giờ", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          observedAt: new Date(REAL_NOW.getTime() - 3 * 86_400_000).toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(true);
  });

  it("không đánh dấu cũ khi dữ liệu trong 48 giờ", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          observedAt: new Date(REAL_NOW.getTime() - 3_600_000).toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(false);
  });

  it("chỉ tính độ tươi trên offer hiển thị được", () => {
    // Offer bị ẩn không được làm dữ liệu trông tươi hơn thực tế.
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          offerId: "hien",
          observedAt: new Date(REAL_NOW.getTime() - 5 * 86_400_000).toISOString(),
        }),
        offer({
          offerId: "an",
          listingStatus: "inactive",
          observedAt: REAL_NOW.toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(true);
  });
});
