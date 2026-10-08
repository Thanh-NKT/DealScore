import { describe, expect, it } from "vitest";
import { decideSavedSearch, type SavedSearchMatch } from "@/lib/saved-search/decide";

const now = new Date("2026-10-08T03:00:00Z");
const fresh = new Date(now.getTime() - 3_600_000).toISOString();
const match = (id: string, price = 100, lastObservedAt: string | null = fresh): SavedSearchMatch => ({
  productId: id, variantId: null, price, recommendation: null, score: null, lastObservedAt,
});

describe("decideSavedSearch", () => {
  it("not initialised → baseline of every match, stale ones included (P4 review I2)", () => {
    const d = decideSavedSearch({ initializedAt: null, lastAlertedAt: null, hits: [] }, [match("a"), match("b", 1, null)], now);
    expect(d).toEqual({
      kind: "baseline",
      hits: [
        { productId: "a", inSet: true, alerted: false, price: 100 },
        { productId: "b", inSet: true, alerted: false, price: 1 },
      ],
    });
  });
  it("truncated scan: no leaving, a never-seen product joins quietly, a seen-leaving one may alert", () => {
    const d = decideSavedSearch(
      {
        initializedAt: fresh,
        lastAlertedAt: null,
        hits: [
          { productId: "gone", inSet: true, alertedAt: null },
          { productId: "back", inSet: false, alertedAt: null },
        ],
      },
      [match("new", 50), match("back", 60)],
      now,
      { complete: false },
    );
    expect(d.kind).toBe("alert");
    if (d.kind !== "alert") return;
    expect(d.items.map((i) => i.productId)).toEqual(["back"]);
    expect(d.totalNew).toBe(1);
    expect(d.hits).toEqual([
      { productId: "new", inSet: true, alerted: false, price: 50 },
      { productId: "back", inSet: true, alerted: true, price: 60 },
    ]);
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
