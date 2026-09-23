import { describe, expect, it } from "vitest";
import { computeDealScore } from "@/lib/deal-score";
import { expandRollup, type DailyPriceRow } from "@/lib/price-history";
import {
  buildVariantPricing,
  FLASH_SALE_REASON,
  isOfferVisible,
  type OfferRow,
} from "@/lib/variant-pricing";

/** Đồng hồ cố định (10:00 giờ VN), truyền vào qua `now`. */
const NOW = new Date("2026-06-15T03:00:00Z");

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
    observedAt: NOW.toISOString(),
    ...over,
  };
}

function history(days: number, price: (i: number) => number): DailyPriceRow[] {
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i;
    const p = price(i);
    return {
      day: new Date(NOW.getTime() - daysAgo * 86_400_000)
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
    now: NOW,
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
    now: NOW,
  };

  it("KHÔNG truyền bestOffer, nên điểm thấp hơn khi truyền bestOffer = chính nó", () => {
    // Giá phải nằm GIỮA dải lịch sử (1000–1180). Giá dưới đáy sẽ làm cả hai
    // cách tính chạm trần 100 điểm và test không phân biệt được gì.
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1100 })] });

    const inflated = computeDealScore({
      price: 1100,
      history: expandRollup(HIST),
      bestOffer: 1100, // cBetween luôn = 100 → cộng khống +20
      now: NOW,
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
  const base = { trackingSince: null, isDraftProduct: false, now: NOW };

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
    now: NOW,
  };

  it("đánh dấu cũ khi quan sát mới nhất quá 48 giờ", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          observedAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
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
          observedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
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
          observedAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
        }),
        offer({
          offerId: "an",
          listingStatus: "inactive",
          observedAt: NOW.toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(true);
  });
});

describe("buildVariantPricing — hết hàng ở mọi người bán (1.2.a.4, 1.2.e)", () => {
  const base = { history: HIST, trackingSince: null, isDraftProduct: false, now: NOW };

  it("không chấm điểm, nhưng giữ giá ghi nhận gần nhất để hiện 'Tạm hết hàng'", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({ offerId: "a", price: 900, stock: 0, observedAt: "2026-06-10T00:00:00Z" }),
        offer({ offerId: "b", price: 950, stock: 0, observedAt: "2026-06-14T00:00:00Z" }),
      ],
    });
    expect(out.cheapest).toBeNull();
    expect(out.headline).toBeNull();
    expect(out.allOutOfStock).toBe(true);
    expect(out.lastKnown?.offerId).toBe("b");
    expect(out.lastKnown?.inStock).toBe(false);
  });

  it("còn hàng thì không có lastKnown", () => {
    const out = buildVariantPricing({ ...base, offers: [offer()] });
    expect(out.allOutOfStock).toBe(false);
    expect(out.lastKnown).toBeNull();
  });

  it("chưa có giá nào thì không phải trạng thái hết hàng", () => {
    const out = buildVariantPricing({ ...base, offers: [offer({ price: null, stock: 0 })] });
    expect(out.allOutOfStock).toBe(false);
  });
});

describe("buildVariantPricing — số liệu StatsRow (1.2.d.3)", () => {
  it("vẫn có đáy / trung vị / đỉnh khi Deal Score chưa đủ ngưỡng", () => {
    const short = history(5, (i) => 1000 + i * 100);
    const out = buildVariantPricing({
      offers: [offer({ price: 1000 })],
      history: short,
      trackingSince: short[0].day,
      isDraftProduct: false,
      now: NOW,
    });
    expect(out.headline?.recommendation).toBe("insufficient_data");
    expect(out.stats).toEqual({ low: 1000, median: 1200, high: 1400, dayCount: 5 });
  });

  it("khi đủ ngưỡng thì trùng với stats của Deal Score", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 1100 })],
      history: HIST,
      trackingSince: null,
      isDraftProduct: false,
      now: NOW,
    });
    const { low, median, high } = out.headline!.stats;
    expect(out.stats).toMatchObject({ low, median, high });
  });
});

describe("buildVariantPricing — flash sale", () => {
  it("giá flash hiện tại thêm lý do cảnh báo lên đầu, không đổi điểm", () => {
    const base = { history: HIST, trackingSince: null, isDraftProduct: false, now: NOW };
    const normal = buildVariantPricing({ ...base, offers: [offer({ price: 900 })] });
    const flash = buildVariantPricing({ ...base, offers: [offer({ price: 900, isFlashSale: true })] });
    expect(flash.headline!.score).toBe(normal.headline!.score);
    expect(flash.headline!.reasons[0]).toBe(FLASH_SALE_REASON);
    expect(flash.headline!.reasons.length).toBeLessThanOrEqual(4);
    expect(normal.headline!.reasons).not.toContain(FLASH_SALE_REASON);
  });
});

describe("buildVariantPricing — heuristic tăng giá trước sale", () => {
  // 60 ngày ở 1000, rồi 14 ngày gần nhất ở 1300: trung vị 14 ngày > 60 ngày × 1.15.
  const raised = history(75, (i) => (i >= 60 ? 1300 : 1000));
  const base = { history: raised, trackingSince: null, isDraftProduct: false, now: NOW };

  it("chỉ tăng giá, KHÔNG có đợt giảm → không gắn nhãn", () => {
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1300 })] });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("tăng giá rồi 'giảm' về đúng mức cũ → gắn nhãn", () => {
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1150 })] });
    expect(out.fakeSaleMessage).toBe("Giá tăng gần đây trước đợt giảm.");
  });
});
