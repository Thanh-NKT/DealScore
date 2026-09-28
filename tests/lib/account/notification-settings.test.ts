import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  fromRow,
  isQuietHour,
  parseNotificationSettings,
  resolveChannels,
  toFormFields,
  toRow,
  type NotificationSettings,
} from "@/lib/account/notification-settings";

const base: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS;

describe("parseNotificationSettings", () => {
  it("absent checkbox → false; all fields valid", () => {
    const r = parseNotificationSettings({ frequency: "daily_digest", digestHour: "20", quietStart: "", quietEnd: "" });
    expect(r).toEqual({
      ok: true,
      value: {
        emailEnabled: false,
        pushEnabled: false,
        frequency: "daily_digest",
        digestHour: 20,
        digestWeekday: 1,
        quietStart: null,
        quietEnd: null,
      },
    });
  });

  it("accepts FormData", () => {
    const f = new FormData();
    f.set("emailEnabled", "on");
    f.set("frequency", "instant");
    f.set("digestHour", "8");
    f.set("quietStart", "22");
    f.set("quietEnd", "7");
    const r = parseNotificationSettings(f);
    expect(r.ok && r.value).toMatchObject({ emailEnabled: true, quietStart: 22, quietEnd: 7 });
  });

  it("collects every error at once", () => {
    const r = parseNotificationSettings({ frequency: "weekly", digestHour: "24", quietStart: "22", quietEnd: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["digestHour", "frequency", "quietEnd"]);
    }
  });

  it("equal quiet hours → error", () => {
    const r = parseNotificationSettings({ frequency: "instant", digestHour: "8", quietStart: "5", quietEnd: "5" });
    expect(r.ok).toBe(false);
  });

  it.each(["-1", "abc", "7.5"])("hour %s is invalid", (h) => {
    const r = parseNotificationSettings({ frequency: "instant", digestHour: h });
    expect(r.ok).toBe(false);
  });
});

describe("parseNotificationSettings — weekly digest", () => {
  it("weekly_digest with a weekday", () => {
    const r = parseNotificationSettings({ frequency: "weekly_digest", digestHour: "19", digestWeekday: "7" });
    expect(r.ok && r.value).toMatchObject({ frequency: "weekly_digest", digestHour: 19, digestWeekday: 7 });
  });

  it("weekday absent → Monday (1)", () => {
    const r = parseNotificationSettings({ frequency: "weekly_digest", digestHour: "8" });
    expect(r.ok && r.value.digestWeekday).toBe(1);
  });

  it.each(["0", "8", "1.5", "thu-hai", "-1"])("weekday %s → Vietnamese error on digestWeekday", (w) => {
    const r = parseNotificationSettings({ frequency: "weekly_digest", digestHour: "8", digestWeekday: w });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors)).toEqual(["digestWeekday"]);
      expect(r.errors.digestWeekday).toMatch(/Thứ Hai/);
    }
  });

  it("unknown frequency error names all three options", () => {
    const r = parseNotificationSettings({ frequency: "monthly" });
    expect(!r.ok && r.errors.frequency).toMatch(/mỗi tuần/);
  });
});

describe("toFormFields", () => {
  it.each<NotificationSettings>([
    base,
    { ...base, emailEnabled: false, pushEnabled: true, frequency: "weekly_digest", digestHour: 20, digestWeekday: 6 },
    { ...base, frequency: "daily_digest", quietStart: 22, quietEnd: 7 },
  ])("round-trips through parseNotificationSettings (%#)", (s) => {
    expect(parseNotificationSettings(toFormFields(s))).toEqual({ ok: true, value: s });
  });
});

describe("fromRow / toRow", () => {
  it("round trip", () => {
    const row = {
      user_id: "u",
      email_enabled: true,
      push_enabled: true,
      frequency: "daily_digest",
      digest_hour: 9,
      digest_weekday: 5,
      quiet_start: 23,
      quiet_end: 6,
      updated_at: "2026-09-23T00:00:00Z",
    };
    const s = fromRow(row);
    expect(s).toEqual({
      emailEnabled: true,
      pushEnabled: true,
      frequency: "daily_digest",
      digestHour: 9,
      digestWeekday: 5,
      quietStart: 23,
      quietEnd: 6,
    });
    expect(toRow(s)).toMatchObject({ email_enabled: true, digest_hour: 9, digest_weekday: 5, quiet_start: 23, quiet_end: 6 });
  });
});

describe("resolveChannels", () => {
  it("null → follow the account", () => {
    expect(resolveChannels({ ...base, emailEnabled: true, pushEnabled: true }, null)).toEqual(["email", "push"]);
  });
  it("override can narrow", () => {
    expect(resolveChannels({ ...base, emailEnabled: true, pushEnabled: true }, ["push"])).toEqual(["push"]);
  });
  it("override does NOT re-enable a channel disabled on the account", () => {
    expect(resolveChannels({ ...base, emailEnabled: false, pushEnabled: true }, ["email"])).toEqual([]);
  });
  it("all off → empty", () => {
    expect(resolveChannels({ ...base, emailEnabled: false, pushEnabled: false }, null)).toEqual([]);
  });
  it("fixed order: email before push", () => {
    expect(resolveChannels({ ...base, emailEnabled: true, pushEnabled: true }, ["push", "email"])).toEqual([
      "email",
      "push",
    ]);
  });
});

describe("isQuietHour (Vietnam time = UTC+7)", () => {
  // 15:00Z = 22:00 VN, 23:59Z = 06:59 VN, 00:00Z = 07:00 VN
  const at = (iso: string) => new Date(iso);

  it("not set → false", () => {
    expect(isQuietHour(base, at("2026-09-23T15:00:00Z"))).toBe(false);
  });
  it("normal range 13 → 15", () => {
    const s = { ...base, quietStart: 13, quietEnd: 15 };
    expect(isQuietHour(s, at("2026-09-23T06:00:00Z"))).toBe(true); // 13:00 VN
    expect(isQuietHour(s, at("2026-09-23T08:00:00Z"))).toBe(false); // 15:00 VN
  });
  it("wraps past midnight 22 → 7", () => {
    const s = { ...base, quietStart: 22, quietEnd: 7 };
    expect(isQuietHour(s, at("2026-09-23T15:00:00Z"))).toBe(true); // 22:00 Vietnam time — start boundary
    expect(isQuietHour(s, at("2026-09-23T23:59:00Z"))).toBe(true); // 06:59 VN
    expect(isQuietHour(s, at("2026-09-24T00:00:00Z"))).toBe(false); // 07:00 Vietnam time — end boundary
    expect(isQuietHour(s, at("2026-09-23T05:00:00Z"))).toBe(false); // 12:00 VN
  });
});
