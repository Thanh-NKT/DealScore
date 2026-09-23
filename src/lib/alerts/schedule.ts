import { isQuietHour, type NotificationSettings } from "@/lib/notification-settings";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const VN_OFFSET_MS = 7 * HOUR_MS;

/** Lần gần nhất của `hour`:00 giờ VN tại hoặc sau `now`. */
export function nextVnHour(now: Date, hour: number): Date {
  const vnWall = new Date(now.getTime() + VN_OFFSET_MS); // các trường UTC của nó = giờ VN
  let target =
    Date.UTC(vnWall.getUTCFullYear(), vnWall.getUTCMonth(), vnWall.getUTCDate(), hour) - VN_OFFSET_MS;
  if (target < now.getTime()) target += DAY_MS;
  return new Date(target);
}

/** Thời điểm được phép gửi. */
export function computeDeliverAfter(settings: NotificationSettings, now: Date): Date {
  // Giờ im lặng không áp cho bản tóm tắt: người dùng tự chọn giờ đó.
  if (settings.frequency === "daily_digest") return nextVnHour(now, settings.digestHour);
  if (isQuietHour(settings, now)) return nextVnHour(now, settings.quietEnd!);
  return now;
}
