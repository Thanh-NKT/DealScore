import { describe, expect, it } from "vitest";
import { discoveryLink, discoveryTitle, parseEventItems, type DiscoveryEventDetail } from "@/lib/alerts/discovery";
import { latestPerWatch, type ClaimedDelivery } from "@/lib/alerts/group";
import { discoveryEmailBlock, discoverySkipReason, mergeDiscoveryEvents } from "@/lib/alerts/dispatch";
import { renderAlertEmail, type AlertEmailItem } from "@/lib/email/templates/alert";
import { buildPushPayload } from "@/lib/push/payload";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/account/notification-settings";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const SITE = "https://dealscore.vn";

const item = (id: string, price: number) => ({
  productId: id,
  variantId: null,
  price,
  recommendation: "buy" as const,
  score: 80,
  name: `SP ${price}`,
  slug: `sp-${price}`,
  categorySlug: "noi-chien",
  image: null,
});

const savedEvent = (o: Partial<DiscoveryEventDetail> = {}): DiscoveryEventDetail => ({
  id: "e1",
  createdAt: "2026-10-08T01:00:00Z",
  trigger: "saved_search",
  userId: "u1",
  source: { kind: "saved_search", id: "s1", name: "Nồi chiên dưới 1,5 triệu", status: "active", channels: null, params: { q: "nồi chiên", maxPrice: 1_500_000, onlyBuy: true } },
  items: [item(P1, 1_200_000)],
  totalNew: 7,
  user: { email: "a@b.c", deletedAt: null, settings: DEFAULT_NOTIFICATION_SETTINGS },
  ...o,
});
const demandEvent = (): DiscoveryEventDetail => ({
  ...savedEvent(),
  id: "e2",
  trigger: "demand_found",
  source: { kind: "demand_found", id: "f1", keyword: "máy hút bụi xiaomi g10", status: "found" },
  totalNew: 1,
});

describe("parseEventItems", () => {
  it("keeps valid entries and drops malformed ones", () => {
    expect(
      parseEventItems([
        { product_id: P1, variant_id: null, price: 1000, recommendation: "buy", score: 70 },
        { product_id: "nope", price: 1 },
        null,
        "x",
        { product_id: P2, price: -5, recommendation: "maybe" },
      ]),
    ).toEqual([
      { productId: P1, variantId: null, price: 1000, recommendation: "buy", score: 70 },
      { productId: P2, variantId: null, price: null, recommendation: null, score: null },
    ]);
    expect(parseEventItems({})).toEqual([]);
  });
});

describe("titles and links", () => {
  it("saved search / demand titles", () => {
    expect(discoveryTitle(savedEvent())).toBe("Có 7 sản phẩm mới khớp “Nồi chiên dưới 1,5 triệu”");
    expect(discoveryTitle(demandEvent())).toBe("DealScore đã có “máy hút bụi xiaomi g10”");
  });
  it("links go to the search page, intent off for a saved search", () => {
    expect(discoveryLink(SITE, savedEvent())).toBe(`${SITE}/search?q=n%E1%BB%93i+chi%C3%AAn&max=1500000&buy=1&intent=0`);
    expect(discoveryLink(SITE, demandEvent())).toBe(`${SITE}/search?q=m%C3%A1y+h%C3%BAt+b%E1%BB%A5i+xiaomi+g10`);
  });
});

describe("email", () => {
  const watchItem: AlertEmailItem = {
    productName: "SSD", variantKey: "1TB", imageUrl: null, price: 1_000_000, baselinePrice: null, dealScore: null,
    recommendation: null, triggerTexts: [], scoreReasons: [], buyUrl: "b", manageUrl: "m", pauseUrl: "p",
  };
  const base = { unsubscribeAllUrl: `${SITE}/unsubscribe?t=all`, siteUrl: SITE };
  it("one saved-search block: subject, lead, product link (no /go), more count", () => {
    const block = discoveryEmailBlock(SITE, savedEvent(), `${SITE}/unsubscribe?t=s`);
    const mail = renderAlertEmail({ items: [], discoveries: [block], ...base });
    expect(mail.subject).toBe("Có sản phẩm mới khớp “Nồi chiên dưới 1,5 triệu”");
    expect(mail.html).toContain("7 sản phẩm vừa khớp điều kiện của bạn · Nên mua");
    expect(mail.html).toContain("và 6 sản phẩm khác");
    expect(mail.html).toContain(`${SITE}/noi-chien/sp-1200000`);
    expect(mail.html).not.toContain("/go/");
    expect(mail.html).toContain("Tạm dừng tìm kiếm này");
    expect(mail.text).toContain("và 6 sản phẩm khác");
  });
  it("one demand block subject", () => {
    const mail = renderAlertEmail({ items: [], discoveries: [discoveryEmailBlock(SITE, demandEvent(), "u")], ...base });
    expect(mail.subject).toBe("DealScore đã có “máy hút bụi xiaomi g10”");
    expect(mail.html).toContain("Không báo nữa");
  });
  it("mixed watch item + discovery block: one email, both inside, generic subject", () => {
    const mail = renderAlertEmail({ items: [watchItem], discoveries: [discoveryEmailBlock(SITE, savedEvent(), "u")], ...base });
    expect(mail.subject).toBe("2 tin mới từ DealScore");
    expect(mail.html).toContain("SSD");
    expect(mail.html).toContain("Nồi chiên dưới 1,5 triệu");
    expect(mail.html.match(/<body/g)).toHaveLength(1);
    expect(mail.html).toContain("Tắt toàn bộ email thông báo");
  });
  it("empty discoveries = watch-only output", () => {
    expect(renderAlertEmail({ items: [watchItem], discoveries: [], ...base })).toEqual(renderAlertEmail({ items: [watchItem], ...base }));
  });
});

describe("push", () => {
  it("one discovery → its title, generic body, its link; mixed → a count", () => {
    expect(buildPushPayload([], SITE, [{ title: "T", url: "U" }])).toEqual({ title: "T", body: "Xem trên DealScore", url: "U", tag: "dealscore-alert" });
    expect(buildPushPayload([{ productName: "A", price: 1, url: "x" }], SITE, [{ title: "T", url: "U" }]).title).toBe("2 tin mới từ DealScore");
  });
});

describe("latestPerWatch with sources", () => {
  const d = (id: string, o: Partial<ClaimedDelivery>): ClaimedDelivery => ({
    deliveryId: id, channel: "email", attempts: 0, alertEventId: id, watchId: null, userId: "u", ...o,
  });
  it("two events of one saved search → newest kept; different sources are separate", () => {
    const created: Record<string, string> = { a: "2026-10-01T00:00:00Z", b: "2026-10-02T00:00:00Z", c: "2026-10-01T00:00:00Z" };
    const out = latestPerWatch(
      [d("a", { sourceKey: "s:1" }), d("b", { sourceKey: "s:1" }), d("c", { sourceKey: "d:1" })],
      (id) => created[id],
    );
    expect(out.map((g) => [g.keep.deliveryId, g.older.map((o) => o.deliveryId)])).toEqual([["b", ["a"]], ["c", []]]);
  });
  it("rows without sourceKey group by watch as before", () => {
    const out = latestPerWatch([d("a", { watchId: "w" }), d("b", { watchId: "w" })], () => "2026-10-01T00:00:00Z");
    expect(out).toHaveLength(1);
  });
});

describe("discoverySkipReason / merge", () => {
  it("paused search → source_inactive; deleted user → account_deleted; channel off → channel_disabled", () => {
    const paused = savedEvent();
    paused.source.status = "paused";
    expect(discoverySkipReason(paused, "email")).toBe("source_inactive");
    expect(discoverySkipReason(savedEvent({ user: { ...savedEvent().user, deletedAt: "x" } }), "email")).toBe("account_deleted");
    expect(discoverySkipReason(savedEvent(), "push")).toBe("channel_disabled");
    expect(discoverySkipReason(savedEvent({ items: [] }), "email")).toBe("source_inactive");
    expect(discoverySkipReason(savedEvent(), "email")).toBeNull();
  });
  it("older events of the same search fold their products in", () => {
    const merged = mergeDiscoveryEvents(savedEvent({ totalNew: 1 }), [savedEvent({ items: [item(P2, 900_000)], totalNew: 1 })]);
    expect(merged.items.map((i) => i.productId)).toEqual([P2, P1]);
    expect(merged.totalNew).toBe(2);
  });
});

describe("unsubscribe scopes", () => {
  it("round-trips saved_search and demand_follow", () => {
    const a = { kind: "saved_search" as const, userId: "u", savedSearchId: "s" };
    const b = { kind: "demand_follow" as const, userId: "u", followId: "f" };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(a, "k"), "k")).toEqual(a);
    expect(verifyUnsubscribeToken(signUnsubscribeToken(b, "k"), "k")).toEqual(b);
  });
});
