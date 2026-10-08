import { describe, expect, it } from "vitest";
import { decideSavedSearch, type SavedSearchMatch } from "@/lib/saved-search/decide";

const now = new Date("2026-10-08T03:00:00Z");
const fresh = new Date(now.getTime() - 3_600_000).toISOString();
const match = (id: string, price = 100, lastObservedAt: string | null = fresh): SavedSearchMatch => ({
  productId: id, variantId: null, price, recommendation: null, score: null, lastObservedAt,
});

describe("decideSavedSearch", () => {
  it("not initialised → baseline of the fresh matches only", () => {
    const d = decideSavedSearch({ initializedAt: null, lastAlertedAt: null, hits: [] }, [match("a"), match("b", 1, null)], now);
    expect(d).toEqual({ kind: "baseline", hits: [{ productId: "a", inSet: true, alerted: false, price: 100 }] });
  });
  it("leaving products are written out of the set", () => {
    const d = decideSavedSearch(
      { initializedAt: fresh, lastAlertedAt: null, hits: [{ productId: "a", inSet: true, alertedAt: null }] },
      [],
      now,
    );
    expect(d).toEqual({ kind: "quiet", hits: [{ productId: "a", inSet: false, alerted: false, price: null }] });
  });
  it("cooldown keeps the entering edge (not written) but records leaving", () => {
    const d = decideSavedSearch(
      { initializedAt: fresh, lastAlertedAt: fresh, hits: [{ productId: "a", inSet: true, alertedAt: null }] },
      [match("b")],
      now,
    );
    expect(d).toEqual({ kind: "suppressed_cooldown", hits: [{ productId: "a", inSet: false, alerted: false, price: null }] });
  });
  it("an entering product alerted 10 days ago enters quietly", () => {
    const ten = new Date(now.getTime() - 10 * 86_400_000).toISOString();
    const d = decideSavedSearch(
      { initializedAt: ten, lastAlertedAt: ten, hits: [{ productId: "a", inSet: false, alertedAt: ten }] },
      [match("a")],
      now,
    );
    expect(d.kind).toBe("quiet");
  });
});
