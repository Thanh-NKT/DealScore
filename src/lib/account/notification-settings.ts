import type { Database } from "@/lib/database.types";

export type Channel = "email" | "push";
export type Frequency = "instant" | "daily_digest";

export interface NotificationSettings {
  emailEnabled: boolean;
  pushEnabled: boolean;
  frequency: Frequency;
  digestHour: number; // 0–23, Vietnam time
  quietStart: number | null; // 0–23, Vietnam time; both null or both set
  quietEnd: number | null;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailEnabled: true,
  pushEnabled: false,
  frequency: "instant",
  digestHour: 8,
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
  if (freqRaw === "instant" || freqRaw === "daily_digest") {
    frequency = freqRaw;
  } else {
    errors.frequency = "Tần suất không hợp lệ (chọn Tức thì hoặc Tóm tắt hằng ngày).";
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
      quietStart,
      quietEnd,
    },
  };
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
