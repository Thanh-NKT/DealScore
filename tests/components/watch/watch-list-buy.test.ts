import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), unstable_rethrow: () => undefined }));
vi.mock("@/actions/watch", () => ({ setWatchStatus: vi.fn(), deleteWatch: vi.fn() }));
vi.mock("@/components/watch/watch-notify-box", () => ({ WatchNotifyBox: () => null }));
vi.mock("@/components/watch/watch-modal", () => ({ WatchModal: () => null }));

const { WatchList } = await import("@/components/watch/watch-list");
const { DEFAULT_NOTIFICATION_SETTINGS } = await import("@/lib/account/notification-settings");
import type { MyWatchItem } from "@/lib/watch/queries";

const item = (o: Partial<MyWatchItem> = {}, view: Partial<MyWatchItem["view"]> = {}): MyWatchItem => ({
  id: "w1",
  status: "active",
  product: { slug: "p", categorySlug: "c", name: "Tai nghe", image: null },
  variant: { id: "v1", key: "Đen" },
  config: { targetPrice: 1_000_000, dropPct: null, notifyLow: false, minDealScore: null, notifyBackInStock: false, channels: null },
  view: {
    price: 900_000, inStock: true, isStale: false, observedAt: null, deal: null,
    target: { amount: 1_000_000, gap: 0, gapPct: -0.1, reached: true },
    changeSinceStart: null,
    change7d: { amount: -200_000, pct: -0.18, refPrice: 1_100_000, days: 7 },
    conditions: [], alertStatus: { kind: "none" }, sortKey: 0, ...view,
  },
  createdAt: "2026-09-01T00:00:00Z",
  folderId: null,
  buy: { offerId: "o1", marketplace: "shopee", affiliate: true },
  ...o,
});
const render = (items: MyWatchItem[]) =>
  renderToStaticMarkup(createElement(WatchList, { initialItems: items, folders: [], settings: DEFAULT_NOTIFICATION_SETTINGS }));

describe("WatchList rows", () => {
  it("'Đến Shopee' through /go with the affiliate label, and still a way to the product page", () => {
    const html = render([item()]);
    expect(html).toContain('href="/go/shopee/o1?src=web&amp;watch=w1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow sponsored noopener"');
    expect(html).toContain("Đến Shopee");
    expect(html).toContain("Liên kết tiếp thị");
    expect(html).toContain('aria-label="Xem chi tiết giá Tai nghe"');
    expect(html).not.toContain("Xem giá mới");
    expect(html).toContain("↓ 200.000đ · 7 ngày");
    expect(html).toMatch(/>1<\/span><span[^>]*>sản phẩm giảm giá trong 7 ngày qua/);
  });

  it("no buy target → the old 'Xem giá mới' / 'Xem giá' button, no affiliate label", () => {
    const html = render([item({ buy: null }), item({ id: "w2", buy: null }, { target: null, change7d: null })]);
    expect(html).not.toContain("/go/");
    expect(html).toContain("Xem giá mới");
    expect(html).toContain(">Xem giá<");
    expect(html).not.toContain("Liên kết tiếp thị");
    expect(html).toContain("Chưa có giá để so");
  });
});
