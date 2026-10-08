import { describe, expect, it } from "vitest";
import { isShareToken, newShareToken, shareFolderUrl } from "@/lib/share-folder/token";
import { parseSharedFolder, sharedItemView } from "@/lib/share-folder/view";
import { validateShareSettings } from "@/lib/share-folder/validate";
import { formatVnd } from "@/lib/format";

describe("share token", () => {
  it("43 chars base64url, 1,000 unique", () => {
    const t = new Set(Array.from({ length: 1000 }, newShareToken));
    expect(t.size).toBe(1000);
    for (const x of t) expect(isShareToken(x)).toBe(true);
  });
  it("rejects 42 / 44 chars and + / =", () => {
    const t = newShareToken();
    expect(isShareToken(t.slice(1))).toBe(false);
    expect(isShareToken(t + "a")).toBe(false);
    expect(isShareToken(t.slice(1) + "+")).toBe(false);
    expect(isShareToken(t.slice(1) + "/")).toBe(false);
    expect(isShareToken(t.slice(1) + "=")).toBe(false);
    expect(shareFolderUrl("https://d.vn", t)).toBe(`https://d.vn/shared/${t}`);
  });
});

const now = new Date("2026-10-08T03:00:00Z");
const raw = (o: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  title: "Quà Tết",
  display_name: "An",
  updated_at: "2026-10-07T00:00:00Z",
  show_prices: true,
  show_target: true,
  show_notes: true,
  ...o,
  items: [
    {
      product_name: "Nồi chiên", product_slug: "noi-chien-x", category_slug: "noi-chien", image: null,
      variant_id: "v1", variant_key: "5L", status: "active", price: 900000, in_stock: true,
      observed_at: "2026-10-08T01:00:00Z", score: 80, recommendation: "buy", target_price: 1000000, note: "cho mẹ",
      ...item,
    },
  ],
});

describe("parseSharedFolder", () => {
  it("full view; reached when price ≤ target", () => {
    const v = parseSharedFolder(raw(), now)!;
    expect(v.items[0]).toMatchObject({ price: 900000, reached: true, note: "cho mẹ", href: "/noi-chien/noi-chien-x?variant=v1", isStale: false });
    expect(v.items[0].verdict).toEqual({ score: 80, recommendation: "buy" });
  });
  it("hides price / target / note per flag; reached null when either price hidden", () => {
    const v = parseSharedFolder(raw({ show_prices: false, show_target: true, show_notes: false }), now)!;
    expect(v.items[0]).toMatchObject({ price: null, verdict: null, reached: null, note: null, targetPrice: 1000000 });
    const w = parseSharedFolder(raw({ show_target: false }), now)!;
    expect(w.items[0]).toMatchObject({ targetPrice: null, reached: null });
  });
  it("no score for the shown price → insufficient; stale > 48 h", () => {
    const v = parseSharedFolder(raw({}, { score: null, recommendation: null, observed_at: "2026-10-05T00:00:00Z" }), now)!;
    expect(v.items[0].verdict).toEqual({ insufficient: true });
    expect(v.items[0].isStale).toBe(true);
    expect(sharedItemView(v.items[0], now, formatVnd).staleLine).toBe("Giá ghi nhận 3 ngày trước");
  });
  it("junk → null", () => {
    expect(parseSharedFolder(null)).toBeNull();
    expect(parseSharedFolder({ items: [] })).toBeNull();
  });
});

describe("sharedItemView", () => {
  it("strings only for shown data", () => {
    const v = parseSharedFolder(raw({ show_prices: false, show_target: false }, { status: "done" }), now)!;
    expect(sharedItemView(v.items[0], now, formatVnd)).toEqual({ priceLine: null, targetLine: null, reachedLine: null, statusChip: "Đã mua", staleLine: null });
  });
});

describe("validateShareSettings", () => {
  it("trims, empty → null, defaults", () => {
    expect(validateShareSettings({ title: "  Quà   Tết ", displayName: "" })).toEqual({
      ok: true,
      value: { title: "Quà Tết", displayName: null, showPrices: true, showTarget: false, showNotes: false, includeDone: false },
    });
  });
  it("rejects @ and phone-like display names, too long titles", () => {
    expect(validateShareSettings({ displayName: "an@gmail.com" }).ok).toBe(false);
    expect(validateShareSettings({ displayName: "An 0912 345 678" }).ok).toBe(false);
    expect(validateShareSettings({ title: "x".repeat(61) }).ok).toBe(false);
    expect(validateShareSettings({ displayName: "Chị An" }).ok).toBe(true);
  });
});
