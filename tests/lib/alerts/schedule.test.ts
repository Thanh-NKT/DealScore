import { describe, expect, it } from "vitest";
import { computeDeliverAfter } from "@/lib/alerts/schedule";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/notification-settings";

const vn = (s: string) => new Date(`${s}+07:00`);
const iso = (d: Date) => d.toISOString();

describe("computeDeliverAfter", () => {
  it("instant ngoài giờ im lặng → now", () => {
    const now = vn("2026-09-23T12:00:00");
    expect(iso(computeDeliverAfter(DEFAULT_NOTIFICATION_SETTINGS, now))).toBe(iso(now));
  });

  const quiet = { ...DEFAULT_NOTIFICATION_SETTINGS, quietStart: 22, quietEnd: 7 };
  it("trong giờ im lặng 22→7 lúc 23:30 → 07:00 hôm sau", () => {
    expect(iso(computeDeliverAfter(quiet, vn("2026-09-23T23:30:00")))).toBe(iso(vn("2026-09-24T07:00:00")));
  });
  it("lúc 06:59 → 07:00 cùng ngày", () => {
    expect(iso(computeDeliverAfter(quiet, vn("2026-09-24T06:59:00")))).toBe(iso(vn("2026-09-24T07:00:00")));
  });

  const digest = { ...DEFAULT_NOTIFICATION_SETTINGS, frequency: "daily_digest" as const, digestHour: 8 };
  it("digest 8h lúc 07:00 → 08:00 hôm nay", () => {
    expect(iso(computeDeliverAfter(digest, vn("2026-09-23T07:00:00")))).toBe(iso(vn("2026-09-23T08:00:00")));
  });
  it("digest 8h lúc 09:00 → 08:00 mai", () => {
    expect(iso(computeDeliverAfter(digest, vn("2026-09-23T09:00:00")))).toBe(iso(vn("2026-09-24T08:00:00")));
  });
  it("digest đúng 08:00 → now", () => {
    const now = vn("2026-09-23T08:00:00");
    expect(iso(computeDeliverAfter(digest, now))).toBe(iso(now));
  });
  it("digest không áp giờ im lặng", () => {
    const s = { ...digest, quietStart: 6, quietEnd: 10 };
    expect(iso(computeDeliverAfter(s, vn("2026-09-23T07:00:00")))).toBe(iso(vn("2026-09-23T08:00:00")));
  });
});
