import {
  computeDealScore,
  detectFakeSale,
  type DealScoreResult,
} from "@/lib/deal-score";
import { discountPercent } from "@/lib/format";
import {
  expandRollup,
  historyStats,
  medianWindow,
  type DailyPriceRow,
  type HistoryStats,
} from "@/lib/price-history";

export const FLASH_SALE_REASON =
  "⚠ Giá hiện tại là giá flash sale, chỉ kéo dài trong thời gian ngắn";

export interface OfferRow {
  offerId: string;
  marketplace: string;
  listingUrl: string | null;
  listingStatus: string;
  matchStatus: "auto" | "manual" | "rejected" | "pending";
  sellerName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | null;
  sellerIsOfficial: boolean;
  affiliateEligible: boolean;
  price: number | null;
  originalPrice: number | null;
  stock: number | null;
  isFlashSale: boolean;
  /** null = chưa có quan sát nào. KHÔNG thay bằng "bây giờ": dữ liệu sẽ trông tươi hơn thực tế. */
  observedAt: string | null;
}

export interface PricedOffer extends OfferRow {
  inStock: boolean;
  discountPercent: number | null;
  /** Điểm riêng của offer này so với offer rẻ nhất. null nếu thiếu dữ liệu hoặc không tính được. */
  dealScore: DealScoreResult | null;
}

export interface VariantPricing {
  offers: PricedOffer[]; // còn hàng theo giá tăng dần, rồi hết hàng
  cheapest: PricedOffer | null; // offer còn hàng rẻ nhất
  /**
   * Khi KHÔNG còn offer nào còn hàng: offer có giá ghi nhận gần nhất, để hiện
   * "Tạm hết hàng" + giá lần cuối (1.2.a.4). null khi còn hàng, hoặc chưa có giá.
   */
  lastKnown: PricedOffer | null;
  /** true khi có offer có giá nhưng tất cả đều hết hàng — không chấm điểm (1.2.e). */
  allOutOfStock: boolean;
  /** Điểm hiển thị đầu trang. Gọi KHÔNG truyền bestOffer (Quyết định Đ7). */
  headline: DealScoreResult | null;
  /**
   * Đáy / trung vị / đỉnh 90 ngày cho StatsRow. Luôn tính, kể cả khi Deal
   * Score chưa đủ ngưỡng (1.2.d.3: "vẫn hiện các số đã có").
   */
  stats: HistoryStats;
  fakeSaleMessage: string | null;
  trackingSince: string | null; // 'YYYY-MM-DD'
  updatedAt: string | null;
  isStale: boolean; // updatedAt cũ hơn 48 giờ
}

export function isOfferVisible(offer: OfferRow, isDraftProduct: boolean): boolean {
  if (offer.listingStatus !== "active") return false;
  if (offer.matchStatus === "auto" || offer.matchStatus === "manual") return true;
  // Product draft do ingest sinh ra có offer 'pending' trỏ vào chính variant draft đó (Đ6).
  if (offer.matchStatus === "pending" && isDraftProduct) return true;
  return false;
}

export function buildVariantPricing(input: {
  offers: OfferRow[];
  history: DailyPriceRow[];
  trackingSince: string | null;
  isDraftProduct: boolean;
  now?: Date;
}): VariantPricing {
  const { offers, history, trackingSince, isDraftProduct, now = new Date() } = input;
  const historyObs = expandRollup(history);

  // 1. Lọc các offer hiển thị được
  const visibleOffers = offers.filter((o) => isOfferVisible(o, isDraftProduct));

  // 2. Phân loại tồn kho và tính toán cơ bản
  const mappedOffers: PricedOffer[] = visibleOffers.map((o) => {
    const inStock = o.stock == null || o.stock > 0;
    const disc = discountPercent(o.price, o.originalPrice);
    return {
      ...o,
      inStock,
      discountPercent: disc,
      dealScore: null,
    };
  });

  // 3. Sắp xếp: Còn hàng lên trước (giá tăng dần), rồi đến hết hàng (giá tăng dần). Giá null xếp cuối.
  mappedOffers.sort((a, b) => {
    if (a.inStock && !b.inStock) return -1;
    if (!a.inStock && b.inStock) return 1;

    if (a.price != null && b.price != null) return a.price - b.price;
    if (a.price != null && b.price == null) return -1;
    if (a.price == null && b.price != null) return 1;
    return 0;
  });

  // 4. Offer rẻ nhất còn hàng
  const cheapest = mappedOffers.find((o) => o.inStock && o.price != null && o.price > 0) ?? null;

  // Hết hàng ở mọi người bán: giá lần cuối lấy từ quan sát MỚI nhất.
  const pricedOffers = mappedOffers.filter((o) => o.price != null && o.price > 0);
  const lastKnown =
    cheapest == null
      ? ([...pricedOffers].sort(
          (a, b) =>
            (b.observedAt ? Date.parse(b.observedAt) : 0) -
            (a.observedAt ? Date.parse(a.observedAt) : 0),
        )[0] ?? null)
      : null;

  // 5. Tính Deal Score đầu trang (Đ7: KHÔNG truyền bestOffer)
  let headline: DealScoreResult | null = null;
  if (cheapest && cheapest.price != null) {
    headline = computeDealScore({
      price: cheapest.price,
      history: historyObs,
      now,
    });
    // Lịch sử đã loại flash sale nên giá flash hiện tại gần như luôn "Nên mua".
    // Không đổi điểm, nhưng phải nói rõ giá này chỉ tạm thời.
    if (cheapest.isFlashSale && headline.score != null) {
      headline = {
        ...headline,
        reasons: [FLASH_SALE_REASON, ...headline.reasons].slice(0, 4),
      };
    }
  }

  // 6. Tính Deal Score riêng cho từng offer (so với offer rẻ nhất).
  //
  // Với CHÍNH offer rẻ nhất thì phép so sánh này là so với chính nó: cBetween
  // luôn bằng 100 và dòng đó sẽ hiện cao hơn điểm đầu trang tới 20 điểm.
  // Người dùng nhìn thấy hai con số mâu thuẫn trên cùng một màn hình.
  // Vì vậy offer rẻ nhất dùng lại đúng điểm đầu trang (nhánh reweight 62.5/37.5).
  for (const offer of mappedOffers) {
    if (offer.price == null || offer.price <= 0) continue;

    offer.dealScore =
      cheapest != null && offer.offerId === cheapest.offerId
        ? headline
        : computeDealScore({
            price: offer.price,
            history: historyObs,
            bestOffer: cheapest?.price ?? undefined,
            now,
          });
  }

  // 7. Fake Sale Detection
  let fakeSaleMessage: string | null = null;
  if (cheapest && cheapest.price != null) {
    const m30 = medianWindow(history, 30, 0, now);
    const m14 = medianWindow(history, 14, 0, now);
    const m60 = medianWindow(history, 74, 14, now);

    // Heuristic #2 ("tăng giá trước đợt giảm") chỉ có nghĩa khi ĐANG có đợt
    // giảm: có giá niêm yết gạch ngang, hoặc giá hiện tại thấp hơn trung vị 14
    // ngày. Không thì một sản phẩm chỉ vừa tăng giá cũng bị gắn nhãn — một phát
    // ngôn về người bán mà "thà bỏ sót" (design §13) không cho phép.
    const onSale =
      cheapest.discountPercent != null ||
      (m14.value != null && cheapest.price < m14.value);
    const priceHikeCheckable = onSale && m14.dayCount >= 10 && m60.dayCount >= 30;

    // Heuristic #1 chỉ chạy khi m30.dayCount >= 14
    if (m30.dayCount >= 14) {
      fakeSaleMessage = detectFakeSale({
        currentPrice: cheapest.price,
        listedPrice: cheapest.originalPrice ?? 0,
        median30d: m30.value ?? 0,
        median14dBeforeSale: priceHikeCheckable ? m14.value ?? undefined : undefined,
        median60dBefore: priceHikeCheckable ? m60.value ?? undefined : undefined,
      });
    }
  }

  // 8. Thời điểm cập nhật & Cảnh báo dữ liệu cũ (> 48h)
  // Chỉ tính trên offer hiển thị được: một offer đã bị ẩn (listing inactive,
  // matching chưa chắc) không được làm dữ liệu trông tươi hơn thực tế.
  let latestObservedAt: string | null = null;
  for (const o of mappedOffers) {
    if (o.observedAt) {
      if (!latestObservedAt || new Date(o.observedAt).getTime() > new Date(latestObservedAt).getTime()) {
        latestObservedAt = o.observedAt;
      }
    }
  }

  const ms48Hours = 48 * 3600 * 1000;
  const isStale = latestObservedAt
    ? now.getTime() - new Date(latestObservedAt).getTime() > ms48Hours
    : false;

  return {
    offers: mappedOffers,
    cheapest,
    lastKnown,
    allOutOfStock: cheapest == null && lastKnown != null,
    headline,
    stats: historyStats(history, now),
    fakeSaleMessage,
    trackingSince,
    updatedAt: latestObservedAt,
    isStale,
  };
}
