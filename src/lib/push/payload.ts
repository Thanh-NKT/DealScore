import { formatVnd } from "@/lib/format";
import type { PushPayload } from "@/lib/alerts/dispatch";

export function buildPushPayload(
  items: Array<{ productName: string; price: number; url: string }>,
  siteUrl: string,
): PushPayload {
  if (items.length === 1) {
    return { title: items[0].productName, body: `Còn ${formatVnd(items[0].price)}`, url: items[0].url, tag: "dealscore-alert" };
  }
  return {
    title: `${items.length} sản phẩm có tin mới`,
    body: `${items.slice(0, 2).map((i) => i.productName).join(", ")}…`,
    url: `${siteUrl}/account/watch`,
    tag: "dealscore-alert",
  };
}
