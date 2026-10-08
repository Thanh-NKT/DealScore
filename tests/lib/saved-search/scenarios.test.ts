import { describe, expect, it } from "vitest";
import {
  decideSavedSearch,
  type HitWrite,
  type SavedSearchMatch,
  type SavedSearchState,
} from "@/lib/saved-search/decide";

// "No spam" commitment for saved-search alerts (spec §2.2 S1–S4). Each step applies the decision's hit writes
// the way record_saved_search_evaluation does, so the scenarios run the real state machine end to end.
const H = 3_600_000;
const T0 = Date.parse("2026-10-01T02:00:00Z");
const at = (hours: number) => new Date(T0 + hours * H);

function m(id: string, price: number, observedHoursAgo = 1, now = at(0)): SavedSearchMatch {
  return {
    productId: id,
    variantId: `v-${id}`,
    price,
    recommendation: "buy",
    score: 80,
    lastObservedAt: new Date(now.getTime() - observedHoursAgo * H).toISOString(),
  };
}

class Sim {
  state: SavedSearchState = { initializedAt: null, lastAlertedAt: null, hits: [] };
  alerts: Array<{ at: Date; items: string[]; totalNew: number }> = [];
  run(now: Date, ids: Array<[string, number] | [string, number, number]>) {
    const matches = ids.map(([id, price, ago]) => m(id, price, ago ?? 1, now));
    const d = decideSavedSearch(this.state, matches, now);
    this.apply(d.hits, now, d.kind === "alert");
    if (!this.state.initializedAt) this.state.initializedAt = now.toISOString();
    if (d.kind === "alert") {
      this.state.lastAlertedAt = now.toISOString();
      this.alerts.push({ at: now, items: d.items.map((i) => i.productId), totalNew: d.totalNew });
    }
    return d;
  }
  private apply(writes: HitWrite[], now: Date, alerting: boolean) {
    for (const w of writes) {
      if (w.alerted && !alerting) continue;
      const h = this.state.hits.find((x) => x.productId === w.productId);
      if (h) {
        h.inSet = w.inSet;
        if (w.alerted) h.alertedAt = now.toISOString();
      } else {
        this.state.hits.push({ productId: w.productId, inSet: w.inSet, alertedAt: w.alerted ? now.toISOString() : null });
      }
    }
  }
}

describe("saved search scenarios (no spam)", () => {
  it("S1: 3 matches at save → baseline, no alert; a 4th entering next day → exactly one alert with it", () => {
    const s = new Sim();
    expect(s.run(at(0), [["a", 100], ["b", 200], ["c", 300]]).kind).toBe("baseline");
    expect(s.run(at(6), [["a", 100], ["b", 200], ["c", 300]]).kind).toBe("quiet");
    expect(s.run(at(24), [["a", 100], ["b", 200], ["c", 300], ["d", 150]]).kind).toBe("alert");
    expect(s.run(at(30), [["a", 100], ["b", 200], ["c", 300], ["d", 150]]).kind).toBe("quiet");
    expect(s.alerts).toEqual([{ at: at(24), items: ["d"], totalNew: 1 }]);
  });

  it("S2: two entries 3 h apart → 1 alert, the 2nd held by the 24 h cooldown and sent after it", () => {
    const s = new Sim();
    s.run(at(0), [["a", 100]]);
    s.run(at(24), [["a", 100], ["b", 90]]);
    expect(s.run(at(27), [["a", 100], ["b", 90], ["c", 80]]).kind).toBe("suppressed_cooldown");
    expect(s.run(at(40), [["a", 100], ["b", 90], ["c", 80]]).kind).toBe("suppressed_cooldown");
    expect(s.run(at(49), [["a", 100], ["b", 90], ["c", 80]]).kind).toBe("alert");
    expect(s.alerts.map((a) => a.items)).toEqual([["b"], ["c"]]);
    expect(s.alerts[1].at).toEqual(at(49));
  });

  it("S3: a product oscillating in/out daily for 30 days → 1 alert; re-entry on day 31 → 2nd alert", () => {
    const s = new Sim();
    s.run(at(0), [["a", 100]]);
    for (let day = 1; day <= 30; day++) {
      s.run(at(day * 24), day % 2 === 1 ? [["a", 100], ["x", 50]] : [["a", 100]]);
    }
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].at).toEqual(at(24));
    s.run(at(31 * 24 + 1), [["a", 100]]);
    s.run(at(31 * 24 + 2), [["a", 100], ["x", 50]]);
    expect(s.alerts).toHaveLength(2);
  });

  it("S4: a stale match neither enters nor leaves; 8 entering at once → 1 alert, 5 items, totalNew 8", () => {
    const s = new Sim();
    s.run(at(0), [["a", 100], ["old", 10, 60]]);
    expect(s.state.hits.map((h) => h.productId)).toEqual(["a"]);
    // "a" goes stale: it does not leave.
    expect(s.run(at(10), [["a", 100, 60]]).hits).toEqual([]);
    const many: Array<[string, number]> = Array.from({ length: 8 }, (_, i) => [`n${i}`, 1000 - i * 10]);
    const d = s.run(at(24), [["a", 100], ["old", 10, 60], ...many]);
    expect(d.kind).toBe("alert");
    expect(s.alerts[0].totalNew).toBe(8);
    expect(s.alerts[0].items).toEqual(["n7", "n6", "n5", "n4", "n3"]);
    // all 8 marked alerted: none re-announced next day
    s.run(at(48), [["a", 100], ...many]);
    expect(s.alerts).toHaveLength(1);
  });

  it("a product leaving and re-entering inside 30 days is not re-announced", () => {
    const s = new Sim();
    s.run(at(0), [["a", 100]]);
    s.run(at(24), [["a", 100], ["b", 50]]);
    s.run(at(48), [["a", 100]]);
    s.run(at(72), [["a", 100], ["b", 50]]);
    expect(s.alerts).toHaveLength(1);
  });
});
