import { formatVnd } from "@/lib/format";
import type { TriggerType } from "@/lib/watch/types";

const pctDown = (from: number | null, to: number) =>
  from != null && from > 0 ? Math.floor(((from - to) / from) * 100) : 0;

const pctUp = (from: number | null, to: number) =>
  from != null && from > 0 ? Math.max(Math.floor(((to - from) / from) * 100), 0) : 0;

/** True when every trigger is "price_hike": the message is "don't buy now", not a deal. */
export const isPriceHikeOnly = (types: readonly TriggerType[]) => types.length > 0 && types.every((t) => t === "price_hike");

/** ctx comes from the alert_events row ITSELF (baseline_price, previous_alert_price) — watches has since been overwritten. */
export function describeTriggers(
  types: TriggerType[],
  ctx: {
    price: number;
    targetPrice: number | null;
    baselinePrice: number | null;
    lastAlertPrice: number | null;
    dealScore: number | null;
    /** price_hike only: the prior 60-day median (alert_events.reference_price). */
    referencePrice?: number | null;
  },
): string[] {
  return types.map((t) => {
    switch (t) {
      case "target_price":
        return `Giá đã xuống dưới mức bạn đặt (${formatVnd(ctx.targetPrice)})`;
      case "drop_pct":
        return `Giảm ${pctDown(ctx.baselinePrice, ctx.price)}% so với lúc bạn bắt đầu theo dõi`;
      case "low":
        return "Đang ở mức đáy 90 ngày";
      case "deal_score":
        return `Deal Score đạt ${ctx.dealScore ?? "—"}/100`;
      case "back_in_stock":
        return "Đã có hàng trở lại";
      case "deeper_drop":
        return `Giảm thêm ${pctDown(ctx.lastAlertPrice, ctx.price)}% so với lần báo trước`;
      case "price_hike":
        return `Giá đang cao hơn ${pctUp(ctx.referencePrice ?? null, ctx.price)}% so với 60 ngày trước — chưa nên mua lúc này`;
    }
  });
}
