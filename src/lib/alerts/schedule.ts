import { isQuietHour, type NotificationSettings } from "@/lib/account/notification-settings";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// Vietnam has no DST, so a fixed +7h offset is exact all year round.
const VN_OFFSET_MS = 7 * HOUR_MS;

/** The most recent `hour`:00 Vietnam time at or after `now`. */
export function nextVnHour(now: Date, hour: number): Date {
  const vnWall = new Date(now.getTime() + VN_OFFSET_MS); // its UTC fields = Vietnam wall time
  let target =
    Date.UTC(vnWall.getUTCFullYear(), vnWall.getUTCMonth(), vnWall.getUTCDate(), hour) - VN_OFFSET_MS;
  if (target < now.getTime()) target += DAY_MS;
  return new Date(target);
}

/**
 * The first `hour`:00 Vietnam time on ISO `weekday` (1 = Monday … 7 = Sunday) at or after `now`.
 * Exactly `hour`:00 on that day → `now` itself (same rule as nextVnHour).
 */
export function nextVnWeekdayHour(now: Date, weekday: number, hour: number): Date {
  const vnWall = new Date(now.getTime() + VN_OFFSET_MS);
  const todayIso = ((vnWall.getUTCDay() + 6) % 7) + 1; // getUTCDay: 0 = Sunday
  const daysAhead = (weekday - todayIso + 7) % 7;
  let target =
    Date.UTC(vnWall.getUTCFullYear(), vnWall.getUTCMonth(), vnWall.getUTCDate() + daysAhead, hour) -
    VN_OFFSET_MS;
  if (target < now.getTime()) target += WEEK_MS;
  return new Date(target);
}

/** When sending is allowed. */
export function computeDeliverAfter(settings: NotificationSettings, now: Date): Date {
  // Quiet hours do not apply to digests: the user picked that day and hour themselves.
  if (settings.frequency === "daily_digest") return nextVnHour(now, settings.digestHour);
  if (settings.frequency === "weekly_digest") {
    return nextVnWeekdayHour(now, settings.digestWeekday, settings.digestHour);
  }
  if (isQuietHour(settings, now)) return nextVnHour(now, settings.quietEnd!);
  return now;
}
