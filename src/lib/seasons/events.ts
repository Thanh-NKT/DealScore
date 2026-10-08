/**
 * Vietnam sale-event calendar (roadmap P4 A). Calendar facts only. Pure.
 * Double days: [d−1, d+1]; Black Friday: the Friday after the 4th Thursday of November, [BF, BF+3];
 * Tết: [tết−21, tết−2]. A year missing from TET_DATES has no Tết window (never guessed).
 */
export type SeasonEventKey = "6.6" | "7.7" | "8.8" | "9.9" | "10.10" | "11.11" | "12.12" | "black_friday" | "tet";
export interface SeasonWindow {
  key: SeasonEventKey;
  label: string;
  year: number;
  /** Vietnam days, inclusive. */
  start: string;
  end: string;
}
export type UpcomingEvent = SeasonWindow & { startsInDays: number };

/** Lunar New Year's Day — extend yearly. */
export const TET_DATES: Record<number, string> = {
  2024: "2024-02-10",
  2025: "2025-01-29",
  2026: "2026-02-17",
  2027: "2027-02-06",
  2028: "2028-01-26",
};

export const SEASON_LABEL: Record<SeasonEventKey, string> = {
  "6.6": "6.6",
  "7.7": "7.7",
  "8.8": "8.8",
  "9.9": "9.9",
  "10.10": "10.10",
  "11.11": "11.11",
  "12.12": "12.12",
  black_friday: "Black Friday",
  tet: "Tết",
};
export const SEASON_KEYS = Object.keys(SEASON_LABEL) as SeasonEventKey[];

const DAY = 86_400_000;
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => toDay(parse(d) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY);

/** The Friday after the 4th Thursday of November. */
export function blackFriday(year: number): string {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstThu = 1 + ((4 - nov1.getUTCDay() + 7) % 7);
  return toDay(Date.UTC(year, 10, firstThu + 21 + 1));
}

function windowsOfYear(year: number): SeasonWindow[] {
  const out: SeasonWindow[] = [];
  for (let m = 6; m <= 12; m++) {
    const d = toDay(Date.UTC(year, m - 1, m));
    const key = `${m}.${m}` as SeasonEventKey;
    out.push({ key, label: SEASON_LABEL[key], year, start: addDays(d, -1), end: addDays(d, 1) });
  }
  const bf = blackFriday(year);
  out.push({ key: "black_friday", label: SEASON_LABEL.black_friday, year, start: bf, end: addDays(bf, 3) });
  const tet = TET_DATES[year];
  if (tet) out.push({ key: "tet", label: SEASON_LABEL.tet, year, start: addDays(tet, -21), end: addDays(tet, -2) });
  return out;
}

/** Every window overlapping [fromDay, toDay], ordered by start. */
export function seasonWindows(fromDay: string, toDayStr: string): SeasonWindow[] {
  const y0 = Number(fromDay.slice(0, 4));
  const y1 = Number(toDayStr.slice(0, 4));
  const out: SeasonWindow[] = [];
  // Tết of year y+1 can start in December of year y: look one year ahead.
  for (let y = y0; y <= y1 + 1; y++) out.push(...windowsOfYear(y));
  return out.filter((w) => w.end >= fromDay && w.start <= toDayStr).sort((a, b) => a.start.localeCompare(b.start));
}

/** The next window starting today or later, within `withinDays`. A calendar fact, shown in every state. */
export function nextSeasonWindow(today: string, withinDays: number): UpcomingEvent | null {
  const next = seasonWindows(today, addDays(today, withinDays)).find((w) => w.start >= today);
  return next ? { ...next, startsInDays: daysBetween(today, next.start) } : null;
}

/** Vietnam calendar day of an instant. */
export const vnDay = (now: Date) => toDay(now.getTime() + 7 * 3_600_000);
