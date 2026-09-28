import type { Database } from "@/lib/database.types";

export type Channel = "email" | "push";
export type Frequency = "instant" | "daily_digest" | "weekly_digest";
export const FREQUENCIES: readonly Frequency[] = ["instant", "daily_digest", "weekly_digest"];

/** ISO weekday, Vietnam time: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** UI copy (Vietnamese) for each ISO weekday. */
export const WEEKDAY_LABELS: Record<IsoWeekday, string> = {
  1: "Thứ Hai",
  2: "Thứ Ba",
  3: "Thứ Tư",
  4: "Thứ Năm",
  5: "Thứ Sáu",
  6: "Thứ Bảy",
  7: "Chủ nhật",
};
export const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export function isIsoWeekday(n: unknown): n is IsoWeekday {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 7;
}

export interface NotificationSettings {
  emailEnabled: boolean;
  pushEnabled: boolean;
  frequency: Frequency;
  digestHour: number; // 0–23, Vietnam time
  digestWeekday: IsoWeekday; // weekly digest only
  quietStart: number | null; // 0–23, Vietnam time; both null or both set
  quietEnd: number | null;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailEnabled: true,
  pushEnabled: false,
  frequency: "instant",
  digestHour: 8,
  digestWeekday: 1,
  quietStart: null,
  quietEnd: null,
};

export type SettingsField = keyof NotificationSettings;

type NotificationSettingsRow = Database["public"]["Tables"]["notification_settings"]["Row"];
type NotificationSettingsUpdate = Database["public"]["Tables"]["notification_settings"]["Update"];

export function fromRow(row: NotificationSettingsRow): NotificationSettings {
  return {
    emailEnabled: row.email_enabled,
    pushEnabled: row.push_enabled,
    frequency: row.frequency as Frequency,
    digestHour: row.digest_hour,
    digestWeekday: isIsoWeekday(row.digest_weekday) ? row.digest_weekday : 1,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
  };
}

export function toRow(s: NotificationSettings): NotificationSettingsUpdate {
  return {
    email_enabled: s.emailEnabled,
    push_enabled: s.pushEnabled,
    frequency: s.frequency,
    digest_hour: s.digestHour,
    digest_weekday: s.digestWeekday,
    quiet_start: s.quietStart,
    quiet_end: s.quietEnd,
    updated_at: new Date().toISOString(),
  };
}

export function parseNotificationSettings(
  form: FormData | Record<string, string | undefined>,
):
  | { ok: true; value: NotificationSettings }
  | { ok: false; errors: Partial<Record<SettingsField, string>> } {
  const get = (key: string): string | undefined => {
    if (form instanceof FormData) {
      const val = form.get(key);
      return typeof val === "string" ? val : undefined;
    }
    return form[key];
  };

  const errors: Partial<Record<SettingsField, string>> = {};

  // Checkbox: "on" or "true" → true, absent → false
  const emailVal = get("emailEnabled");
  const emailEnabled = emailVal === "on" || emailVal === "true";

  const pushVal = get("pushEnabled");
  const pushEnabled = pushVal === "on" || pushVal === "true";

  // Frequency
  const freqRaw = get("frequency") ?? "instant";
  let frequency: Frequency = "instant";
  if ((FREQUENCIES as readonly string[]).includes(freqRaw)) {
    frequency = freqRaw as Frequency;
  } else {
    errors.frequency =
      "Tần suất không hợp lệ (chọn Ngay khi có, Tóm tắt mỗi ngày hoặc Tóm tắt mỗi tuần).";
  }

  // Digest weekday (ISO 1–7). Absent → Monday; only used by the weekly digest.
  const weekdayRaw = get("digestWeekday");
  let digestWeekday: IsoWeekday = 1;
  if (weekdayRaw !== undefined && weekdayRaw.trim() !== "") {
    const parsed = Number(weekdayRaw);
    if (isIsoWeekday(parsed)) {
      digestWeekday = parsed;
    } else {
      errors.digestWeekday = "Ngày nhận tóm tắt không hợp lệ (chọn từ Thứ Hai đến Chủ nhật).";
    }
  }

  // Digest hour (0-23)
  const digestHourRaw = get("digestHour");
  let digestHour = 8;
  if (digestHourRaw !== undefined && digestHourRaw.trim() !== "") {
    const parsed = Number(digestHourRaw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
      errors.digestHour = "Giờ nhận tóm tắt phải từ 0 đến 23.";
    } else {
      digestHour = parsed;
    }
  }

  // Quiet hours (quietStart, quietEnd)
  const quietStartRaw = get("quietStart")?.trim() ?? "";
  const quietEndRaw = get("quietEnd")?.trim() ?? "";

  let quietStart: number | null = null;
  let quietEnd: number | null = null;

  const hasStart = quietStartRaw !== "";
  const hasEnd = quietEndRaw !== "";

  if (hasStart && !hasEnd) {
    errors.quietEnd = "Vui lòng chọn cả giờ kết thúc im lặng.";
  } else if (!hasStart && hasEnd) {
    errors.quietStart = "Vui lòng chọn cả giờ bắt đầu im lặng.";
  } else if (hasStart && hasEnd) {
    const sParsed = Number(quietStartRaw);
    const eParsed = Number(quietEndRaw);

    let startValid = true;
    let endValid = true;

    if (!Number.isInteger(sParsed) || sParsed < 0 || sParsed > 23) {
      errors.quietStart = "Giờ bắt đầu im lặng phải từ 0 đến 23.";
      startValid = false;
    }
    if (!Number.isInteger(eParsed) || eParsed < 0 || eParsed > 23) {
      errors.quietEnd = "Giờ kết thúc im lặng phải từ 0 đến 23.";
      endValid = false;
    }

    if (startValid && endValid) {
      if (sParsed === eParsed) {
        errors.quietEnd = "Giờ bắt đầu và kết thúc phải khác nhau.";
      } else {
        quietStart = sParsed;
        quietEnd = eParsed;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      emailEnabled,
      pushEnabled,
      frequency,
      digestHour,
      digestWeekday,
      quietStart,
      quietEnd,
    },
  };
}

/** Settings → the form fields parseNotificationSettings reads (round-trips exactly). */
export function toFormFields(s: NotificationSettings): Record<string, string> {
  const f: Record<string, string> = {
    frequency: s.frequency,
    digestHour: String(s.digestHour),
    digestWeekday: String(s.digestWeekday),
    quietStart: s.quietStart === null ? "" : String(s.quietStart),
    quietEnd: s.quietEnd === null ? "" : String(s.quietEnd),
  };
  if (s.emailEnabled) f.emailEnabled = "on";
  if (s.pushEnabled) f.pushEnabled = "on";
  return f;
}

/**
 * Resolve the channels that actually receive notifications for a Watch.
 * The account switch is the master switch: a Watch can only narrow it, never re-enable a disabled channel.
 * Result order is fixed: email first, then push.
 */
export function resolveChannels(
  settings: NotificationSettings,
  watchChannels: Channel[] | null,
): Channel[] {
  const candidates: Channel[] = watchChannels ?? ["email", "push"];
  const resolved: Channel[] = [];

  if (candidates.includes("email") && settings.emailEnabled) {
    resolved.push("email");
  }
  if (candidates.includes("push") && settings.pushEnabled) {
    resolved.push("push");
  }

  return resolved;
}

/**
 * Whether the current moment falls inside quiet hours (Vietnam time, UTC+7).
 */
export function isQuietHour(settings: NotificationSettings, now: Date): boolean {
  if (settings.quietStart === null || settings.quietEnd === null) {
    return false;
  }

  // Convert `now` to Vietnam time (UTC+7)
  const vnTimeString = now.toLocaleString("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "numeric",
    hourCycle: "h23",
  });
  const h = parseInt(vnTimeString, 10);

  const { quietStart: s, quietEnd: e } = settings;

  if (s < e) {
    return h >= s && h < e;
  } else {
    // Wraps past midnight (e.g. 22:00 to 07:00)
    return h >= s || h < e;
  }
}
