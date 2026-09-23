import type { Channel } from "@/lib/notification-settings";
import { MAX_DELIVERY_ATTEMPTS, RETRY_DELAYS_MINUTES } from "@/lib/watch/constants";

export interface ClaimedDelivery {
  deliveryId: string;
  channel: Channel;
  attempts: number;
  alertEventId: string;
  watchId: string;
  userId: string;
}

/** Gom theo (userId, channel), theo thứ tự xuất hiện. */
export function groupDeliveries(
  rows: ClaimedDelivery[],
): Array<{ userId: string; channel: Channel; deliveries: ClaimedDelivery[] }> {
  const map = new Map<string, { userId: string; channel: Channel; deliveries: ClaimedDelivery[] }>();
  for (const r of rows) {
    const key = `${r.channel}:${r.userId}`;
    const g = map.get(key) ?? { userId: r.userId, channel: r.channel, deliveries: [] };
    g.deliveries.push(r);
    map.set(key, g);
  }
  // email trước push: một lượt thiếu thời gian thì email — kênh chắc chắn tới — được ưu tiên.
  return [...map.values()].sort((a, b) => (a.channel === b.channel ? 0 : a.channel === "email" ? -1 : 1));
}

/** Sau lần thất bại thứ `attempts` (1-based). null = hết lượt → failed. */
export function nextRetryAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(now.getTime() + minutes * 60_000);
}
