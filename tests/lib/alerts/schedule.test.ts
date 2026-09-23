import { describe, expect, it } from "vitest";
import { computeDeliverAfter } from "@/lib/alerts/schedule";
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
