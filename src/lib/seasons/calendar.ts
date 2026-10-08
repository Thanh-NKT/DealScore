import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { addDays, nextSeasonWindow, seasonWindows, SEASON_LABEL, vnDay, type SeasonEventKey, type SeasonWindow, type UpcomingEvent } from "@/lib/seasons/events";
import {
  SEASON_BASELINE_DAYS,
  SEASON_BASELINE_GAP_DAYS,
  SEASON_BASELINE_MIN_DAYS,
  SEASON_HISTORY_DAYS,
  SEASON_LOWER_RATIO,
  SEASON_MIN_COVERAGE_DAYS,
  SEASON_MIN_EVENTS_RANKED,
  SEASON_UPCOMING_DAYS,
  SEASON_WINDOW_MIN_SHARE,
} from "@/lib/seasons/constants";
import { formatVnd } from "@/lib/format";

/**
 * What recorded prices did around past sale windows (spec §8.1): the window's lowest daily low (flash already
 * excluded by the rollup) against the median of the 30 days before it, skipping the 7 days right before (a
 * pre-sale hike stays out). Recorded history only — never a prediction. Never feeds Deal Score / search /
 * alerts. Pure.
 */
export interface SeasonOccurrence {
  key: SeasonEventKey;
  year: number;
  eventLow: number;
  baseline: number;
  ratio: number;
}
export interface SeasonEventStat {
  key: SeasonEventKey;
  label: string;
  occurrences: SeasonOccurrence[];
  medianRatio: number;
}
export type ProductSeason =
  | { status: "insufficient"; coveredDays: number; minDays: number; upcoming: UpcomingEvent | null }
  | {
      status: "partial" | "ok";
      coveredDays: number;
      minDays: number;
      events: SeasonEventStat[];
      ranked: SeasonEventStat[] | null;
      upcoming: UpcomingEvent | null;
    };

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const valid = (r: DailyPriceRow) => r.min_price != null && Number.isFinite(r.min_price) && r.min_price > 0;

export function seasonOccurrences(rows: DailyPriceRow[], windows: SeasonWindow[]): SeasonOccurrence[] {
  const byDay = new Map(rows.filter(valid).map((r) => [r.day, r.min_price as number]));
  const out: SeasonOccurrence[] = [];
  for (const w of windows) {
    const windowDays: number[] = [];
    let length = 0;
    for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
      length++;
      const p = byDay.get(d);
      if (p != null) windowDays.push(p);
    }
    if (windowDays.length < Math.ceil(length * SEASON_WINDOW_MIN_SHARE)) continue;
    const baseEnd = addDays(w.start, -SEASON_BASELINE_GAP_DAYS); // exclusive
    const baseStart = addDays(baseEnd, -SEASON_BASELINE_DAYS);
    const base: number[] = [];
    for (let d = baseStart; d < baseEnd; d = addDays(d, 1)) {
      const p = byDay.get(d);
      if (p != null) base.push(p);
    }
    if (base.length < SEASON_BASELINE_MIN_DAYS) continue;
    const baseline = median(base)!;
    const eventLow = Math.min(...windowDays);
    out.push({ key: w.key, year: w.year, eventLow, baseline, ratio: Math.round((eventLow / baseline) * 10_000) / 10_000 });
  }
  return out;
}

export function productSeason(rows: DailyPriceRow[], now: Date): ProductSeason {
  const today = vnDay(now);
  const from = addDays(today, -SEASON_HISTORY_DAYS);
  const upcoming = nextSeasonWindow(today, SEASON_UPCOMING_DAYS);
  const inRange = rows.filter((r) => r.day >= from && r.day <= today);
  const coveredDays = inRange.filter(valid).length;
  // Only completed windows: one still open (or in the future) is not history yet.
  const windows = seasonWindows(from, today).filter((w) => w.end < today && w.start >= from);
  const occ = seasonOccurrences(inRange, windows);
  if (occ.length === 0) return { status: "insufficient", coveredDays, minDays: SEASON_MIN_COVERAGE_DAYS, upcoming };
  const byKey = new Map<SeasonEventKey, SeasonOccurrence[]>();
  for (const o of occ) byKey.set(o.key, [...(byKey.get(o.key) ?? []), o]);
  const events: SeasonEventStat[] = [...byKey.entries()].map(([key, list]) => ({
    key,
    label: SEASON_LABEL[key],
    occurrences: list.sort((a, b) => a.year - b.year),
    medianRatio: median(list.map((o) => o.ratio))!,
  }));
  if (coveredDays < SEASON_MIN_COVERAGE_DAYS) {
    return { status: "partial", coveredDays, minDays: SEASON_MIN_COVERAGE_DAYS, events, ranked: null, upcoming };
  }
  const ranked = events.length >= SEASON_MIN_EVENTS_RANKED ? [...events].sort((a, b) => a.medianRatio - b.medianRatio) : null;
  return { status: "ok", coveredDays, minDays: SEASON_MIN_COVERAGE_DAYS, events, ranked, upcoming };
}

/** One row of the product season list (UI spec §5.1), from the event's latest occurrence. Pure. */
export function seasonRowCopy(e: SeasonEventStat): { label: string; text: string; lower: boolean; neutral: boolean; count: string } {
  const last = e.occurrences[e.occurrences.length - 1];
  const pct = Math.round(Math.abs(1 - last.ratio) * 100);
  const dir = last.ratio < 1 ? "thấp hơn" : "cao hơn";
  return {
    label: e.label,
    // m13: a ratio that rounds to 0% is "bằng", never "cao hơn 0%".
    text: `${last.year}: thấp nhất ${formatVnd(last.eventLow)}, ${pct === 0 ? "bằng trung vị" : `${dir} ${pct}% so với trung vị`} 30 ngày trước đợt`,
    lower: last.ratio <= SEASON_LOWER_RATIO,
    neutral: last.ratio >= 1,
    count: `${e.occurrences.length} lần ghi nhận`,
  };
}

/** "Đợt 10.10 tiếp theo: 09/10 (2 ngày nữa)." */
export function upcomingCopy(u: UpcomingEvent): string {
  const [y, m, d] = u.start.split("-");
  return `Đợt ${u.label} tiếp theo: ${d}/${m}/${y} (${u.startsInDays === 0 ? "bắt đầu hôm nay" : `${u.startsInDays} ngày nữa`}).`;
}
