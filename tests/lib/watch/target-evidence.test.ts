import { describe, expect, it } from "vitest";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { targetEvidence, typicalTarget } from "@/lib/watch/target-evidence";

/** 10:00 VN on 2026-06-15. */
const NOW = new Date("2026-06-15T03:00:00Z");
const dayAgo = (n: number, now = NOW) => new Date(now.getTime() + 7 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
const row = (day: string, p: number): DailyPriceRow => ({
  day,
  min_price: p,
  median_price: p,
  max_price: p,
  obs_count: 1,
  offer_count: 1,
  has_flash_sale: false,
  flash_min_price: null,
});
/** prices[i] = price i days ago (null = no row). */
const series = (prices: Array<number | null>, now = NOW) =>
  prices.flatMap((p, i) => (p == null ? [] : [row(dayAgo(i, now), p)]));

describe("targetEvidence", () => {
  it("13 data days → null; target ≤ 0 → null", () => {
    expect(targetEvidence(series(Array(13).fill(1000)), 1000, NOW)).toBeNull();
    expect(targetEvidence(series(Array(20).fill(1000)), 0, NOW)).toBeNull();
  });

  it("two runs separated by a day above target → 2 episodes", () => {
    // index = days ago: today 900 (hit), 1 above, 2–3 hits, rest above.
    const prices = [900, 1200, 900, 900, ...Array(16).fill(1200)];
    expect(targetEvidence(series(prices), 1000, NOW)).toMatchObject({
      dataDays: 20,
      hitDays: 3,
      episodes: 2,
      lastHitDay: dayAgo(0),
      daysSinceLastHit: 0,
      low: 900,
    });
  });

  it("a missing day inside a run does not break it → 1 episode", () => {
    const prices = [1200, 900, null, 900, ...Array(16).fill(1200)];
    expect(targetEvidence(series(prices), 1000, NOW)).toMatchObject({ episodes: 1, hitDays: 2, daysSinceLastHit: 1 });
  });

  it("daysSinceLastHit counts VN calendar days across midnight", () => {
    // 00:30 VN on 2026-06-15 = 17:30Z on the 14th; a hit on VN day 2026-06-14 is 1 day ago.
    const now = new Date("2026-06-14T17:30:00Z");
    const rows = [row("2026-06-14", 900), ...series(Array(20).fill(1200), new Date("2026-06-13T03:00:00Z"))];
    expect(targetEvidence(rows, 1000, now)?.daysSinceLastHit).toBe(1);
  });

  it("target below the 90-day low → hitDays 0, low returned", () => {
    expect(targetEvidence(series(Array(30).fill(1000)), 500, NOW)).toMatchObject({ hitDays: 0, episodes: 0, lastHitDay: null, daysSinceLastHit: null, low: 1000 });
  });

  it("rows older than 90 days are ignored", () => {
    const prices = [...Array(20).fill(1200), ...Array(75).fill(null), 500];
    const ev = targetEvidence(series(prices), 1000, NOW)!;
    expect(ev.hitDays).toBe(0);
    expect(ev.low).toBe(1200);
  });
});

describe("typicalTarget", () => {
  it("rounds down to 10,000 and is ≤ the percentile", () => {
    const prices = Array.from({ length: 20 }, (_, i) => 1_000_000 + i * 7_777);
    const t = typicalTarget(series(prices), NOW)!;
    expect(t % 10_000).toBe(0);
    const sorted = [...prices].sort((a, b) => a - b);
    const p25 = sorted[4] + (sorted[5] - sorted[4]) * 0.75;
    expect(t).toBeLessThanOrEqual(p25);
    expect(p25 - t).toBeLessThan(10_000);
  });
  it("under 14 data days → null", () => {
    expect(typicalTarget(series(Array(13).fill(1_000_000)), NOW)).toBeNull();
  });
});
