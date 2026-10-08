import { formatVnd } from "@/lib/format";
import type { PushPayload } from "@/lib/alerts/dispatch";

/**
 * `discoveries` (roadmap P4 E/F): saved-search / demand-found notifications, `{ title: discoveryTitle, url:
 * discoveryLink }`. Absent or empty → exactly the watch-only payload of before.
 */
export function buildPushPayload(
  items: Array<{ productName: string; price: number; url: string; priceHikeOnly?: boolean }>,
  siteUrl: string,
  discoveries?: Array<{ title: string; url: string }>,
): PushPayload {
  const disc = discoveries ?? [];
  if (disc.length > 0) {
    if (disc.length === 1 && items.length === 0) {
      return { title: disc[0].title, body: "Xem trên DealScore", url: disc[0].url, tag: "dealscore-alert" };
    }
    return {
      title: `${items.length + disc.length} tin mới từ DealScore`,
      body: "Xem trên DealScore",
      url: items.length > 0 ? `${siteUrl}/account/watch` : `${siteUrl}/account/searches`,
      tag: "dealscore-alert",
    };
  }
  if (items.length === 1) {
    if (items[0].priceHikeOnly) {
      return {
        title: `${items[0].productName} đang cao hơn mức thường thấy`,
        body: `${formatVnd(items[0].price)} — chưa nên mua lúc này`,
        url: items[0].url,
        tag: "dealscore-alert",
      };
    }
    return { title: items[0].productName, body: `Còn ${formatVnd(items[0].price)}`, url: items[0].url, tag: "dealscore-alert" };
  }
  return {
    title: `${items.length} sản phẩm có tin mới`,
    body: `${items.slice(0, 2).map((i) => i.productName).join(", ")}…`,
    url: `${siteUrl}/account/watch`,
    tag: "dealscore-alert",
  };
}
