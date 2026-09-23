import { formatVnd } from "@/lib/format";
import type { TriggerType } from "@/lib/watch/types";

const pctDown = (from: number | null, to: number) =>
  from != null && from > 0 ? Math.floor(((from - to) / from) * 100) : 0;

/** ctx comes from the alert_events row ITSELF (baseline_price, previous_alert_price) — watches has since been overwritten. */
export function describeTriggers(
  types: TriggerType[],
  ctx: { price: number; targetPrice: number | null; baselinePrice: number | null; lastAlertPrice: number | null; dealScore: number | null },
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
    }
  });
}
