import { describe, expect, it } from "vitest";
import { addDays, blackFriday, nextSeasonWindow, seasonWindows, TET_DATES } from "@/lib/seasons/events";
import { productSeason, seasonOccurrences, seasonRowCopy, upcomingCopy } from "@/lib/seasons/calendar";
import { aggregateCategorySeason, categorySeasonRowCopy, categorySeasonView } from "@/lib/seasons/category";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import type { SeasonOccurrence } from "@/lib/seasons/calendar";

const row = (day: string, price: number | null): DailyPriceRow => ({
  day, min_price: price, median_price: price, max_price: price, obs_count: 1, offer_count: 1, has_flash_sale: false, flash_min_price: null,
});
/** Daily rows from `from` for `n` days at 100k, dipping to 80k inside every completed sale window. */
function history(from: string, n: number, dip = 80_000): DailyPriceRow[] {
  const end = addDays(from, n - 1);
  const windows = seasonWindows(from, end);
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(from, i);
    return row(d, windows.some((w) => d >= w.start && d <= w.end) ? dip : 100_000);
  });
}

describe("events", () => {
  it("Black Friday 2025-11-28 / 2026-11-27", () => {
    expect(blackFriday(2025)).toBe("2025-11-28");
    expect(blackFriday(2026)).toBe("2026-11-27");
  });
  it("Tết from TET_DATES; a year without an entry has none; windows across the year end", () => {
    const w = seasonWindows("2025-12-01", "2026-02-28");
    const tet = w.find((x) => x.key === "tet")!;
    expect(tet).toMatchObject({ year: 2026, start: addDays(TET_DATES[2026], -21), end: addDays(TET_DATES[2026], -2) });
    expect(w.map((x) => x.key)).toEqual(["black_friday", "12.12", "tet"]); // BF 2025 runs 28.11–01.12
    expect(seasonWindows("2030-01-01", "2030-03-01").filter((x) => x.key === "tet")).toEqual([]);
  });
  it("upcoming on 2026-10-07 → 10.10 in 2 days (window starts 10.09)", () => {
    const u = nextSeasonWindow("2026-10-07", 45)!;
    expect(u).toMatchObject({ key: "10.10", start: "2026-10-09", startsInDays: 2 });
    expect(upcomingCopy(u)).toBe("Đợt 10.10 tiếp theo: 09/10/2026 (2 ngày nữa).");
  });
});

describe("seasonOccurrences", () => {
  const w = seasonWindows("2026-09-01", "2026-09-30").filter((x) => x.key === "9.9");
  it("needs ≥ 50% window data and 14 baseline days", () => {
    const base = Array.from({ length: 30 }, (_, i) => row(addDays("2026-07-25", i), 100_000));
    expect(seasonOccurrences([...base, row("2026-09-09", 80_000)], w)).toEqual([]); // 1/3 window days
    const full = [...base, row("2026-09-08", 85_000), row("2026-09-09", 80_000)];
    expect(seasonOccurrences(full, w)).toEqual([{ key: "9.9", year: 2026, eventLow: 80_000, baseline: 100_000, ratio: 0.8 }]);
    expect(seasonOccurrences([...base.slice(0, 10), row("2026-09-08", 85_000), row("2026-09-09", 80_000)], w)).toEqual([]);
  });
  it("the 7 gap days before the window do not move the baseline (a pre-sale hike)", () => {
    const base = Array.from({ length: 30 }, (_, i) => row(addDays("2026-07-25", i), 100_000));
    const hike = Array.from({ length: 7 }, (_, i) => row(addDays("2026-09-01", i), 150_000));
    const o = seasonOccurrences([...base, ...hike, row("2026-09-08", 90_000), row("2026-09-09", 90_000)], w);
    expect(o[0].baseline).toBe(100_000);
  });
});

describe("productSeason", () => {
  it("a window ending today is not an occurrence; 120 days → partial", () => {
    const now = new Date("2026-10-11T03:00:00Z"); // 10.10 window ends today (10.11)
    const s = productSeason(history("2026-06-13", 121), now);
    expect(s.status).toBe("partial");
    if (s.status === "insufficient") return;
    expect(s.events.map((e) => e.key)).not.toContain("10.10");
    expect(s.ranked).toBeNull();
  });
  it("no occurrence → insufficient, upcoming still shown", () => {
    const s = productSeason(history("2026-09-20", 18), new Date("2026-10-07T03:00:00Z"));
    expect(s).toMatchObject({ status: "insufficient", coveredDays: 18, minDays: 300 });
    expect(s.upcoming?.key).toBe("10.10");
  });
  it("400 days → ok, ranked by median ratio", () => {
    const s = productSeason(history("2025-09-03", 400), new Date("2026-10-07T03:00:00Z"));
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect(s.ranked!.length).toBeGreaterThanOrEqual(3);
    expect(seasonRowCopy(s.events[0])).toMatchObject({ lower: true, neutral: false });
    expect(seasonRowCopy(s.events[0]).text).toContain("thấp hơn 20% so với trung vị 30 ngày trước đợt");
  });
});

describe("category", () => {
  const occ = (ratio: number): SeasonOccurrence[] => [{ key: "11.11", year: 2025, eventLow: 1, baseline: 1, ratio }];
  it("7 variants → insufficient; 8 → ok with share lower", () => {
    expect(categorySeasonView(aggregateCategorySeason(Array.from({ length: 7 }, () => occ(0.9))))).toEqual({ status: "insufficient", best: 7, min: 8 });
    const rows = aggregateCategorySeason([...Array.from({ length: 6 }, () => occ(0.9)), occ(1), occ(1.02)]);
    const v = categorySeasonView(rows)!;
    expect(v.status).toBe("ok");
    expect(rows[0]).toMatchObject({ key: "11.11", variantsCounted: 8, shareLower: 0.75 });
    expect(categorySeasonRowCopy(rows[0])).toBe("11.11: trung bình thấp hơn 10% · 75% sản phẩm giảm ≥ 5% (8 sản phẩm)");
    expect(categorySeasonView([])).toBeNull();
  });

  it("m13: a ratio that rounds to 0% reads \"bằng trung vị\", never \"cao hơn 0%\"", () => {
    const occ = { year: 2025, eventLow: 100_000, ratio: 1 } as unknown as SeasonOccurrence;
    const e = { key: "11.11" as const, label: "11.11", occurrences: [occ], medianRatio: 1 };
    expect(seasonRowCopy(e).text).toBe("2025: thấp nhất 100.000đ, bằng trung vị 30 ngày trước đợt");
    expect(seasonRowCopy({ ...e, occurrences: [{ ...occ, ratio: 1.004 }] }).text).toContain("bằng trung vị");
    expect(categorySeasonRowCopy({ key: "11.11", variantsCounted: 8, occurrences: 8, medianRatio: 0.998, shareLower: 0 })).toBe(
      "11.11: trung bình bằng trung vị · 0% sản phẩm giảm ≥ 5% (8 sản phẩm)",
    );
  });
});
