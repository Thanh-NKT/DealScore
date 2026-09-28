import { describe, expect, it } from "vitest";
import { computeDeliverAfter, nextVnWeekdayHour } from "@/lib/alerts/schedule";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/account/notification-settings";

const vn = (s: string) => new Date(`${s}+07:00`);
const iso = (d: Date) => d.toISOString();

describe("computeDeliverAfter", () => {
  it("instant outside quiet hours → now", () => {
    const now = vn("2026-09-23T12:00:00");
    expect(iso(computeDeliverAfter(DEFAULT_NOTIFICATION_SETTINGS, now))).toBe(iso(now));
  });

  const quiet = { ...DEFAULT_NOTIFICATION_SETTINGS, quietStart: 22, quietEnd: 7 };
  it("inside quiet hours 22→7 at 23:30 → 07:00 next day", () => {
    expect(iso(computeDeliverAfter(quiet, vn("2026-09-23T23:30:00")))).toBe(iso(vn("2026-09-24T07:00:00")));
  });
  it("at 06:59 → 07:00 same day", () => {
    expect(iso(computeDeliverAfter(quiet, vn("2026-09-24T06:59:00")))).toBe(iso(vn("2026-09-24T07:00:00")));
  });

  const digest = { ...DEFAULT_NOTIFICATION_SETTINGS, frequency: "daily_digest" as const, digestHour: 8 };
  it("8am digest at 07:00 → 08:00 today", () => {
    expect(iso(computeDeliverAfter(digest, vn("2026-09-23T07:00:00")))).toBe(iso(vn("2026-09-23T08:00:00")));
  });
  it("8am digest at 09:00 → 08:00 tomorrow", () => {
    expect(iso(computeDeliverAfter(digest, vn("2026-09-23T09:00:00")))).toBe(iso(vn("2026-09-24T08:00:00")));
  });
  it("digest exactly at 08:00 → now", () => {
    const now = vn("2026-09-23T08:00:00");
    expect(iso(computeDeliverAfter(digest, now))).toBe(iso(now));
  });
  it("digest ignores quiet hours", () => {
    const s = { ...digest, quietStart: 6, quietEnd: 10 };
    expect(iso(computeDeliverAfter(s, vn("2026-09-23T07:00:00")))).toBe(iso(vn("2026-09-23T08:00:00")));
  });
});

// 2026-09-23 is a Wednesday (ISO 3).
describe("nextVnWeekdayHour", () => {
  it("same weekday, before the hour → today at that hour", () => {
    expect(iso(nextVnWeekdayHour(vn("2026-09-23T07:59:00"), 3, 8))).toBe(iso(vn("2026-09-23T08:00:00")));
  });
  it("same weekday, exactly at the hour → now", () => {
    const now = vn("2026-09-23T08:00:00");
    expect(iso(nextVnWeekdayHour(now, 3, 8))).toBe(iso(now));
  });
  it("same weekday, after the hour → same weekday next week", () => {
    expect(iso(nextVnWeekdayHour(vn("2026-09-23T08:00:01"), 3, 8))).toBe(iso(vn("2026-09-30T08:00:00")));
  });
  it("later weekday this week", () => {
    expect(iso(nextVnWeekdayHour(vn("2026-09-23T12:00:00"), 5, 8))).toBe(iso(vn("2026-09-25T08:00:00")));
  });
  it("earlier weekday → wraps to next week (Monday)", () => {
    expect(iso(nextVnWeekdayHour(vn("2026-09-23T12:00:00"), 1, 8))).toBe(iso(vn("2026-09-28T08:00:00")));
  });
  it("Sunday (7) from Saturday night → next day", () => {
    expect(iso(nextVnWeekdayHour(vn("2026-09-26T23:30:00"), 7, 9))).toBe(iso(vn("2026-09-27T09:00:00")));
  });
  it("uses the Vietnam date, not UTC: Monday 01:00 VN is still Sunday in UTC", () => {
    // 2026-09-28T01:00+07 = 2026-09-27T18:00Z (a Sunday in UTC).
    expect(iso(nextVnWeekdayHour(vn("2026-09-28T01:00:00"), 1, 8))).toBe(iso(vn("2026-09-28T08:00:00")));
  });
  it("wraps across a month and year end", () => {
    // 2026-12-31 is a Thursday → next Monday is 2027-01-04.
    expect(iso(nextVnWeekdayHour(vn("2026-12-31T10:00:00"), 1, 0))).toBe(iso(vn("2027-01-04T00:00:00")));
  });
  it("no DST: always a fixed +07:00 offset, even across Western DST changes", () => {
    // 2027-03-28 is when Europe switches to summer time; Vietnam does not change.
    const r = nextVnWeekdayHour(vn("2027-03-27T12:00:00"), 1, 8); // Saturday → Monday 29th
    expect(iso(r)).toBe("2027-03-29T01:00:00.000Z");
  });
});

describe("computeDeliverAfter — weekly digest", () => {
  const weekly = { ...DEFAULT_NOTIFICATION_SETTINGS, frequency: "weekly_digest" as const, digestHour: 8, digestWeekday: 1 as const };
  it("Wednesday → next Monday at the digest hour", () => {
    expect(iso(computeDeliverAfter(weekly, vn("2026-09-23T12:00:00")))).toBe(iso(vn("2026-09-28T08:00:00")));
  });
  it("ignores quiet hours, like the daily digest", () => {
    const s = { ...weekly, quietStart: 6, quietEnd: 10 };
    expect(iso(computeDeliverAfter(s, vn("2026-09-28T07:00:00")))).toBe(iso(vn("2026-09-28T08:00:00")));
  });
});
