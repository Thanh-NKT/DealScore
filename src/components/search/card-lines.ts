import { OFFER_COUNT_MIN_SHOWN } from "@/lib/search/card-constants";
import type { FakeSaleKind } from "@/lib/pricing/deal-score";

/**
 * Bottom line of the card's price capsule (UI spec §1): "Rẻ nhất ở {sàn} · {N} nơi bán" from
 * OFFER_COUNT_MIN_SHOWN offers, otherwise "Ghi nhận trên {sàn}". `count` is rendered with `num`.
 */
export function cardSourceLine(
  offerCount: number | null,
  where: string | null,
): { lead: string; count: number | null; tail: string } | null {
  if (offerCount != null && offerCount >= OFFER_COUNT_MIN_SHOWN) {
    return { lead: where ? `Rẻ nhất ở ${where} · ` : "", count: offerCount, tail: " nơi bán" };
  }
  return where ? { lead: `Ghi nhận trên ${where}`, count: null, tail: "" } : null;
}

/** "Giảm giá chưa thực chất" note for a cached fake-sale kind; `off` = the list-price discount shown nowhere else. */
export function fakeSaleNote(kind: FakeSaleKind, off: number | null): string {
  if (kind === "pre_sale_hike") return "Giá vừa được nâng lên trước đợt giảm này.";
  return off != null && off > 0
    ? `Giá hiện tại chưa thấp hơn đáng kể so với giá DealScore ghi nhận, dù giá niêm yết ghi giảm ${off}%.`
    : "Giá hiện tại chưa thấp hơn đáng kể so với giá DealScore ghi nhận.";
}
