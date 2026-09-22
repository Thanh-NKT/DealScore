import {
  computeDealScore,
  detectFakeSale,
  type DealScoreResult,
} from "@/lib/deal-score";
import { discountPercent } from "@/lib/format";
import {
  expandRollup,
  medianWindow,
  type DailyPriceRow,
} from "@/lib/price-history";

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
  observedAt: string;
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
  /** Điểm hiển thị đầu trang. Gọi KHÔNG truyền bestOffer (Quyết định Đ7). */
  headline: DealScoreResult | null;
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

  // 5. Tính Deal Score đầu trang (Đ7: KHÔNG truyền bestOffer)
  let headline: DealScoreResult | null = null;
  if (cheapest && cheapest.price != null) {
    headline = computeDealScore({
      price: cheapest.price,
      history: historyObs,
    });
  }

  // 6. Tính Deal Score riêng cho từng offer (so với offer rẻ nhất)
  for (const offer of mappedOffers) {
    if (offer.price != null && offer.price > 0) {
      offer.dealScore = computeDealScore({
        price: offer.price,
        history: historyObs,
        bestOffer: cheapest?.price ?? undefined,
      });
    }
  }

  // 7. Fake Sale Detection
  let fakeSaleMessage: string | null = null;
  if (cheapest && cheapest.price != null) {
    const m30 = medianWindow(history, 30, 0, now);
    const m14 = medianWindow(history, 14, 0, now);
    const m60 = medianWindow(history, 74, 14, now);

    // Heuristic #1 chỉ chạy khi m30.dayCount >= 14
    if (m30.dayCount >= 14) {
      fakeSaleMessage = detectFakeSale({
        currentPrice: cheapest.price,
        listedPrice: cheapest.originalPrice ?? 0,
        median30d: m30.value ?? 0,
        median14dBeforeSale:
          m14.dayCount >= 10 && m60.dayCount >= 30 ? m14.value ?? undefined : undefined,
        median60dBefore:
          m14.dayCount >= 10 && m60.dayCount >= 30 ? m60.value ?? undefined : undefined,
      });
    }
  }

  // 8. Thời điểm cập nhật & Cảnh báo dữ liệu cũ (> 48h)
  let latestObservedAt: string | null = null;
  for (const o of offers) {
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
    headline,
    fakeSaleMessage,
    trackingSince,
    updatedAt: latestObservedAt,
    isStale,
  };
}
