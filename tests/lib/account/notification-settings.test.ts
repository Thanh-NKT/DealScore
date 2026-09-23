import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  fromRow,
  isQuietHour,
  parseNotificationSettings,
  resolveChannels,
  toRow,
  type NotificationSettings,
} from "@/lib/account/notification-settings";

const base: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS;

describe("parseNotificationSettings", () => {
  it("checkbox vắng mặt → false; đủ trường hợp lệ", () => {
    const r = parseNotificationSettings({ frequency: "daily_digest", digestHour: "20", quietStart: "", quietEnd: "" });
    expect(r).toEqual({
      ok: true,
      value: {
        emailEnabled: false,
        pushEnabled: false,
        frequency: "daily_digest",
        digestHour: 20,
        quietStart: null,
        quietEnd: null,
      },
    });
  });

  it("nhận FormData", () => {
    const f = new FormData();
    f.set("emailEnabled", "on");
    f.set("frequency", "instant");
    f.set("digestHour", "8");
    f.set("quietStart", "22");
    f.set("quietEnd", "7");
    const r = parseNotificationSettings(f);
    expect(r.ok && r.value).toMatchObject({ emailEnabled: true, quietStart: 22, quietEnd: 7 });
  });

  it("gom mọi lỗi cùng lúc", () => {
    const r = parseNotificationSettings({ frequency: "weekly", digestHour: "24", quietStart: "22", quietEnd: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["digestHour", "frequency", "quietEnd"]);
    }
  });

  it("giờ im lặng bằng nhau → lỗi", () => {
    const r = parseNotificationSettings({ frequency: "instant", digestHour: "8", quietStart: "5", quietEnd: "5" });
    expect(r.ok).toBe(false);
  });

  it.each(["-1", "abc", "7.5"])("giờ %s không hợp lệ", (h) => {
    const r = parseNotificationSettings({ frequency: "instant", digestHour: h });
    expect(r.ok).toBe(false);
  });
});

describe("fromRow / toRow", () => {
  it("khứ hồi", () => {
    const row = {
      user_id: "u",
      email_enabled: true,
      push_enabled: true,
      frequency: "daily_digest",
      digest_hour: 9,
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
      quietStart: 23,
      quietEnd: 6,
    });
    expect(toRow(s)).toMatchObject({ email_enabled: true, digest_hour: 9, quiet_start: 23, quiet_end: 6 });
  });
});

describe("resolveChannels", () => {
  it("null → theo tài khoản", () => {
    expect(resolveChannels({ ...base, emailEnabled: true, pushEnabled: true }, null)).toEqual(["email", "push"]);
  });
  it("ghi đè thu hẹp được", () => {
    expect(resolveChannels({ ...base, emailEnabled: true, pushEnabled: true }, ["push"])).toEqual(["push"]);
  });
  it("ghi đè KHÔNG mở lại kênh tài khoản đã tắt", () => {
    expect(resolveChannels({ ...base, emailEnabled: false, pushEnabled: true }, ["email"])).toEqual([]);
  });
  it("tắt hết → rỗng", () => {
    expect(resolveChannels({ ...base, emailEnabled: false, pushEnabled: false }, null)).toEqual([]);
  });
  it("thứ tự cố định email trước push", () => {
    expect(resolveChannels({ ...base, emailEnabled: true, pushEnabled: true }, ["push", "email"])).toEqual([
      "email",
      "push",
    ]);
  });
});

describe("isQuietHour (giờ VN = UTC+7)", () => {
  // 15:00Z = 22:00 VN, 23:59Z = 06:59 VN, 00:00Z = 07:00 VN
  const at = (iso: string) => new Date(iso);

  it("không đặt → false", () => {
    expect(isQuietHour(base, at("2026-09-23T15:00:00Z"))).toBe(false);
  });
  it("khoảng thường 13 → 15", () => {
    const s = { ...base, quietStart: 13, quietEnd: 15 };
    expect(isQuietHour(s, at("2026-09-23T06:00:00Z"))).toBe(true); // 13:00 VN
    expect(isQuietHour(s, at("2026-09-23T08:00:00Z"))).toBe(false); // 15:00 VN
  });
  it("vắt qua nửa đêm 22 → 7", () => {
    const s = { ...base, quietStart: 22, quietEnd: 7 };
    expect(isQuietHour(s, at("2026-09-23T15:00:00Z"))).toBe(true); // 22:00 VN — biên start
    expect(isQuietHour(s, at("2026-09-23T23:59:00Z"))).toBe(true); // 06:59 VN
    expect(isQuietHour(s, at("2026-09-24T00:00:00Z"))).toBe(false); // 07:00 VN — biên end
    expect(isQuietHour(s, at("2026-09-23T05:00:00Z"))).toBe(false); // 12:00 VN
  });
});
