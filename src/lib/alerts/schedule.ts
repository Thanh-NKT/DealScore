import { isQuietHour, type NotificationSettings } from "@/lib/account/notification-settings";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const VN_OFFSET_MS = 7 * HOUR_MS;

/** The most recent `hour`:00 Vietnam time at or after `now`. */
export function nextVnHour(now: Date, hour: number): Date {
  const vnWall = new Date(now.getTime() + VN_OFFSET_MS); // its UTC fields = Vietnam wall time
  let target =
    Date.UTC(vnWall.getUTCFullYear(), vnWall.getUTCMonth(), vnWall.getUTCDate(), hour) - VN_OFFSET_MS;
  if (target < now.getTime()) target += DAY_MS;
  return new Date(target);
}

/** When sending is allowed. */
export function computeDeliverAfter(settings: NotificationSettings, now: Date): Date {
  // Quiet hours do not apply to the digest: the user picked that hour themselves.
  if (settings.frequency === "daily_digest") return nextVnHour(now, settings.digestHour);
  if (isQuietHour(settings, now)) return nextVnHour(now, settings.quietEnd!);
  return now;
}
